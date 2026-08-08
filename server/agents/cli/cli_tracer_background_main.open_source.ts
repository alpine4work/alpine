import {WriteStream, createWriteStream} from "fs";
import {join} from "path";
import {inspect} from "util";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {SynchronizedSystemClock} from "~/shared/helpers/clock/synchronized_system_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {EventQueue} from "~/shared/helpers/control/event_queue.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";

process.title = "alpine-background";

const [baseUrl = "", dataDirectoryPath = ""] = process.argv.slice(2);

let logStream: WriteStream | null = null;

function log(...args: Array<unknown>) {
    logStream ??= createWriteStream(join(dataDirectoryPath, "tracer-background.log"), {
        flags: "a",
    });

    logStream.write(args.map(arg => inspect(arg)).join(" "));
}

main().then(
    () => {
        process.exit(0);
    },
    error => {
        log("Couldn\u2019t run tracer background process:", error);
        process.exit(1);
    },
);

async function main() {
    const eventQueue = new EventQueue<
        {type: "Event"; time: number; data: TracerEventFlatData} | {type: "Flush"}
    >();

    let pendingStdinData = "";

    process.stdin.on("data", data => {
        pendingStdinData += data.toString("utf8");

        let newlineIndex = pendingStdinData.indexOf("\n");
        while (newlineIndex !== -1) {
            const eventString = pendingStdinData.slice(0, newlineIndex);
            pendingStdinData = pendingStdinData.slice(newlineIndex + 1);
            newlineIndex = pendingStdinData.indexOf("\n");

            eventQueue.enqueue(JSON.parse(eventString));
        }
    });

    const clock = await SynchronizedSystemClock.new(async () => {
        // eslint-disable-next-line cyberworlds/no-global-fetch
        const response = await fetch(new URL("/api/time", baseUrl), {cache: "no-store"});
        const {startTime, endTime}: {startTime: number; endTime: number} = await response.json();
        return startTime + (endTime - startTime) / 2;
    });

    let pending: {
        timeout: Timeout;
        events: Array<{time: number; data: TracerEventFlatData}>;
    } | null = null;

    const promiseWaiter = new PromiseWaiter();

    const flushPendingEvents = () => {
        promiseWaiter.waitUntil(async () => {
            assert(pending !== null);
            const {events} = pending;
            pending = null;

            // eslint-disable-next-line cyberworlds/no-global-fetch
            await fetch(new URL("/api/tracer", baseUrl), {
                method: "POST",
                body: JSON.stringify(
                    events.map(event => {
                        const clientTimeOffsetMs = clock.offset;

                        // Send our events to the server with the server time, not client time. We compute
                        // the server time from our client time by applying our server time offset.
                        const time = event.time + clientTimeOffsetMs;

                        const {data} = event;

                        // Record the time offset for this event to help debug tracer events.
                        data["meta.client_time_offset_ms"] = clientTimeOffsetMs;

                        return {time, data};
                    }),
                ),
            });
        });
    };

    outer: for await (const event of eventQueue) {
        if (pending === null) {
            pending = {
                events: [],
                timeout: createTimeout(flushPendingEvents, 1000),
            };
        }

        switch (event.type) {
            case "Event": {
                pending.events.push(event);
                break;
            }
            case "Flush": {
                break outer;
            }
            default:
                throw exhaustive(event);
        }
    }

    if (pending !== null) {
        pending.timeout.clear();
        flushPendingEvents();
    }

    await promiseWaiter.wait();
}
