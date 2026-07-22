import {ChildProcessByStdio, spawn} from "child_process";
import {readFile, stat, writeFile} from "fs/promises";
import {join as joinPath} from "path";
import {Writable as WritableStream} from "stream";
import {fileURLToPath} from "url";
import {UnknownError} from "~/shared/error/error.js";
import {SynchronizedSystemClock} from "~/shared/helpers/clock/synchronized_system_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";

export type AgentsCliTracerEvent = {
    readonly time: number;
    readonly data: TracerEventFlatData;
};

export type AgentsCliTracerEventSenderMessage =
    | {readonly type: "Event"; readonly event: AgentsCliTracerEvent}
    | {readonly type: "Flush"};

/**
 * Sends CLI tracer events through a detached subprocess so network requests do not
 * block the CLI command from completing.
 */
export function createAgentsCliTracerEventSender() {
    let subprocess: ChildProcessByStdio<WritableStream, null, null> | null = null;
    let queuedEvents: Array<AgentsCliTracerEvent> = [];
    let flushPromise: Promise<void> | null = null;

    const sendEvent = (event: TracerEvent) => {
        if (flushPromise !== null) return;

        const agentsCliTracerEvent = {
            time: event.time,
            data: event.getFlatData(),
        };

        if (subprocess === null) {
            queuedEvents.push(agentsCliTracerEvent);
        } else {
            sendMessage(subprocess.stdin, {type: "Event", event: agentsCliTracerEvent});
        }
    };

    const start = ({baseUrl, dataDirectoryPath}: {baseUrl: URL; dataDirectoryPath: string}) => {
        if (subprocess !== null || flushPromise !== null) return;

        try {
            subprocess = spawn(
                process.execPath,
                [
                    fileURLToPath(
                        new URL("./run_agents_cli_tracer_event_sender_process.js", import.meta.url),
                    ),
                    baseUrl.toString(),
                    dataDirectoryPath,
                ],
                {
                    detached: true,
                    stdio: ["pipe", "ignore", "ignore"],
                },
            );
        } catch {
            queuedEvents = [];
            return;
        }

        // The subprocess must be allowed to finish sending events after the CLI exits.
        subprocess.unref();
        subprocess.on("error", () => {});
        subprocess.stdin.on("error", () => {});

        for (const event of queuedEvents) {
            sendMessage(subprocess.stdin, {type: "Event", event});
        }
        queuedEvents = [];
    };

    const flush = (): Promise<void> => {
        flushPromise ??= new Promise(resolve => {
            queuedEvents = [];

            const flushingSubprocess = subprocess;
            subprocess = null;

            if (flushingSubprocess === null) {
                resolve();
                return;
            }

            const finish = () => {
                flushingSubprocess.off("error", finish);
                flushingSubprocess.off("exit", finish);
                resolve();
            };

            flushingSubprocess.once("error", finish);
            flushingSubprocess.once("exit", finish);
            sendMessage(flushingSubprocess.stdin, {type: "Flush"}, () => {
                try {
                    flushingSubprocess.stdin.end(finish);
                } catch {
                    finish();
                }
            });
        });

        return flushPromise;
    };

    return {sendEvent, start, flush};
}

function sendMessage(
    stdin: WritableStream,
    message: AgentsCliTracerEventSenderMessage,
    callback: () => void = () => {},
) {
    try {
        stdin.write(`${JSON.stringify(message)}\n`, callback);
    } catch {
        callback();
    }
}

export async function runAgentsCliTracerEventSenderProcess({
    baseUrl,
    dataDirectoryPath,
    messages,
}: {
    baseUrl: URL;
    dataDirectoryPath: string;
    messages: AsyncIterable<string>;
}) {
    const clientTimeOffsetMsPromise = getAgentsCliTracerClientTimeOffset({
        baseUrl,
        dataDirectoryPath,
    }).catch(() => null);

    let queuedEvents: Array<AgentsCliTracerEvent> = [];
    let shouldFlush = false;

    for await (const messageString of messages) {
        let messageUnknown: unknown;
        try {
            messageUnknown = JSON.parse(messageString);
        } catch {
            continue;
        }

        if (!isAgentsCliTracerEventSenderMessage(messageUnknown)) continue;

        switch (messageUnknown.type) {
            case "Event": {
                queuedEvents.push(messageUnknown.event);
                break;
            }
            case "Flush": {
                shouldFlush = true;
                break;
            }
            default:
                throw exhaustive(messageUnknown);
        }

        if (shouldFlush) break;
    }

    if (!shouldFlush || queuedEvents.length === 0) return;

    const clientTimeOffsetMs = await clientTimeOffsetMsPromise;
    if (clientTimeOffsetMs === null) return;

    const events = queuedEvents;
    queuedEvents = [];

    // eslint-disable-next-line cyberworlds/no-global-fetch
    await fetch(new URL("/api/tracer", baseUrl), {
        method: "POST",
        body: JSON.stringify(
            events.map(event => ({
                time: event.time + clientTimeOffsetMs,
                data: {
                    ...event.data,
                    "meta.client_time_offset_ms": clientTimeOffsetMs,
                },
            })),
        ),
    });
}

export async function getAgentsCliTracerClientTimeOffset({
    baseUrl,
    dataDirectoryPath,
}: {
    baseUrl: URL;
    dataDirectoryPath: string;
}): Promise<number> {
    const clockOffsetPath = joinPath(dataDirectoryPath, "clock-offset.json");
    let cachedOffset: number | null = null;
    let cachedOffsetModificationTime: number | null = null;

    try {
        const cachedOffsetUnknown: unknown = JSON.parse(await readFile(clockOffsetPath, "utf8"));
        const cachedOffsetStats = await stat(clockOffsetPath);

        if (typeof cachedOffsetUnknown === "number" && Number.isFinite(cachedOffsetUnknown)) {
            cachedOffset = cachedOffsetUnknown;
            cachedOffsetModificationTime = cachedOffsetStats.mtimeMs;
        }
    } catch {
        // A missing or malformed cache will be replaced after synchronizing below.
    }

    const clockOffsetRefreshDuration = 1000 * 60 * 10;
    const cachedOffsetAge =
        cachedOffsetModificationTime === null ? null : Date.now() - cachedOffsetModificationTime;
    if (
        cachedOffset !== null &&
        cachedOffsetAge !== null &&
        cachedOffsetAge >= 0 &&
        cachedOffsetAge < clockOffsetRefreshDuration
    ) {
        return cachedOffset;
    }

    try {
        const synchronizedSystemClock = await SynchronizedSystemClock.new(async () => {
            // eslint-disable-next-line cyberworlds/no-global-fetch
            const response = await fetch(new URL("/api/time", baseUrl), {cache: "no-store"});
            if (!response.ok) throw new UnknownError("Unsuccessful `/api/time` response");

            const responseData: unknown = await response.json();

            if (!isObject(responseData)) {
                throw new UnknownError("Invalid `/api/time` response");
            }

            const {startTime, endTime} = responseData;
            if (
                typeof startTime !== "number" ||
                !Number.isFinite(startTime) ||
                typeof endTime !== "number" ||
                !Number.isFinite(endTime)
            ) {
                throw new UnknownError("Invalid `/api/time` response");
            }

            return startTime + (endTime - startTime) / 2;
        });

        try {
            await writeFile(clockOffsetPath, JSON.stringify(synchronizedSystemClock.offset));
        } catch {
            // The synchronized offset is still usable when caching it fails.
        }

        return synchronizedSystemClock.offset;
    } catch (error) {
        if (cachedOffset !== null) return cachedOffset;
        throw error;
    }
}

function isAgentsCliTracerEventSenderMessage(
    message: unknown,
): message is AgentsCliTracerEventSenderMessage {
    if (!isObject(message) || typeof message.type !== "string") return false;

    switch (message.type) {
        case "Event":
            return (
                isObject(message.event) &&
                typeof message.event.time === "number" &&
                isObject(message.event.data)
            );
        case "Flush":
            return true;
        default:
            return false;
    }
}
