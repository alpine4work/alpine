import {spawn} from "child_process";
import {fileURLToPath} from "url";
import {InternalError} from "~/shared/error/error.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export function createCliTracer({
    baseUrl,
    dataDirectoryPath,
}: {
    baseUrl: URL;
    dataDirectoryPath: string;
}): {
    tracer: TracerRoot;
    flushTracer: () => void;
} {
    let queuedEvents: Array<TracerEvent> | null = [];

    const tracer = TracerRoot.new({
        serviceName: "CliClient",
        jsHost: "Node",
        // Events from our client tracer are untrusted because any bad actor could get
        // ahold of our client tracer and send whatever event they want to the server.
        //
        // We can filter out events with this untrusted flag on the server to get clean
        // data.
        untrusted: true,
        // We use the unsynchronized system clock with our tracer even though it's subject
        // to user clock adjustments! That way the tracer object can be available
        // immediately.
        //
        // Then when we send events to the server, we adjust times using the client offset
        // from our synchronized system clock.
        clock: unsynchronizedSystemClock,
        sendEvent: event => {
            if (queuedEvents !== null) {
                queuedEvents.push(event);
            } else {
                actuallySendEvent(event);
            }
        },
    });

    const actuallySendEvent = (event: TracerEvent) => {
        if (!subprocess.stdin.writable) return;

        subprocess.stdin.write(
            JSON.stringify({
                type: "Event",
                time: event.time,
                data: event.getFlatData(),
            }) + "\n",
        );
    };

    const backgroundProcessMainPath = fileURLToPath(
        new URL("./cli_tracer_background_main.js", import.meta.url),
    );

    const subprocess = spawn(
        process.execPath,
        [backgroundProcessMainPath, baseUrl.toString(), dataDirectoryPath],
        {
            // Allow the current process to exit without exiting the background process which
            // may need to finish sending some tracer events.
            detached: true,
            stdio: ["pipe", "ignore", "ignore"],
        },
    );

    // Allow the current process to exit without waiting for the background process to
    // exit.
    subprocess.unref();

    subprocess.on("spawn", () => {
        assert(queuedEvents !== null);

        const events = queuedEvents;
        queuedEvents = null;

        for (const event of events) {
            actuallySendEvent(event);
        }
    });

    let subprocessError: {hasError: true; error: unknown} | null = null;
    let subprocessStdinError: {hasError: true; error: unknown} | null = null;

    subprocess.on("error", error => {
        subprocessError = {hasError: true, error};
    });

    subprocess.stdin.on("error", error => {
        subprocessStdinError = {hasError: true, error};
    });

    return {
        tracer,
        flushTracer: () => {
            if (subprocessError !== null) {
                throw InternalError.from(
                    subprocessError.error,
                    "Couldn\u2019t spawn tracer background process",
                );
            }

            if (subprocessStdinError !== null) {
                throw InternalError.from(
                    subprocessStdinError.error,
                    "Couldn\u2019t write to tracer background process stdin",
                );
            }

            subprocess.stdin.end(JSON.stringify({type: "Flush"}) + "\n");
        },
    };
}
