import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

const ingressTrafficShutdownListeners = new Set<(signal: "SIGINT" | "SIGTERM") => Promise<void>>();
const shutdownListeners = new Set<(signal: "SIGINT" | "SIGTERM") => Promise<void>>();

// Perform a graceful shutdown when requested. Any code in our system can
// schedule a callback for graceful shutdown with `registerShutdownListener()`.
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

let isShuttingDown = false;

// TODO(calebmer, #tracer): Trace the shutdown? Span around each listener,
// easier to see errors. With this setup we just need some kind of global
// tracer.
function handleShutdown(signal: "SIGINT" | "SIGTERM") {
    isShuttingDown = true;

    if (ingressTrafficShutdownListeners.size === 0 && shutdownListeners.size === 0) {
        process.exit(0);
    } else {
        const ingressTrafficShutdownPromise = runAllPromises(
            Array.from(ingressTrafficShutdownListeners, listener => listener(signal)),
        );

        const shutdownPromise = runAllPromises([
            ingressTrafficShutdownPromise,
            ingressTrafficShutdownPromise
                // If an ingress traffic shutdown listener failed, we still want to run our
                // other shutdown listeners.
                .catch(() => {})
                .then(() =>
                    runAllPromises(Array.from(shutdownListeners, listener => listener(signal))),
                ),
        ]);

        shutdownPromise.then(
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
 * These callbacks are for shutting down sources of ingress traffic like HTTP
 * servers. For an HTTP server you want to register a listener that closes the
 * server from accepting new connections, finish processing existing
 * connections, and return when done.
 *
 * Ingress traffic shutdown listeners will run before all our other shutdown
 * listeners. Since resources may still be used until ingress traffic shuts
 * down.
 */
export function registerShutdownListenerForIngressTraffic(
    listener: (signal: "SIGINT" | "SIGTERM") => Promise<void>,
) {
    assert(!isShuttingDown);
    ingressTrafficShutdownListeners.add(listener);
    return () => {
        ingressTrafficShutdownListeners.delete(listener);
    };
}

/**
 * Register a function that will be called when the process is shutting down.
 * This lets you keep the process alive while you finish processing requests or
 * perform any other cleanup.
 *
 * These shutdown listeners run after listeners registered with
 * `registerShutdownListenerForIngressTraffic()`. That way we don't close
 * resources being actively used by traffic.
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
