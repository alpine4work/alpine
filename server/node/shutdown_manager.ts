import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

const shutdownListeners = new Set<(signal: "SIGINT" | "SIGTERM") => Promise<void>>();

// Perform a graceful shutdown when requested. Any code in our system can
// schedule a callback for graceful shutdown with `registerShutdownListener()`.
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

let isShuttingDown = false;

function handleShutdown(signal: "SIGINT" | "SIGTERM") {
    isShuttingDown = true;

    if (shutdownListeners.size === 0) {
        process.exit(0);
    } else {
        runAllPromises(Array.from(shutdownListeners, listener => listener(signal))).then(
            () => {
                process.exit(0);
            },
            error => {
                // eslint-disable-next-line no-console
                console.error(error);
                process.exit(1);
            },
        );
    }
}

/**
 * Register a function that will be called when the process is shutting down.
 * This lets you keep the process alive while you finish processing requests or
 * perform any other cleanup.
 */
export function registerShutdownListener(
    listener: (signal: "SIGINT" | "SIGTERM") => Promise<void>,
): () => void {
    assert(!isShuttingDown);
    shutdownListeners.add(listener);
    return () => {
        shutdownListeners.delete(listener);
    };
}
