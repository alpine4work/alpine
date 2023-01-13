import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client";
import {InternalError} from "~/shared/error/error";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root";

/**
 * Create a tracer for a service running in a server Cloudflare
 * Workers environment.
 */
export function createServerTracer({
    serviceName,
    env,
    waitUntil,
}: {
    serviceName: TracerServiceName;
    env: {DEV_SERVER_PORT?: string; HONEYCOMB_API_KEY?: string};
    waitUntil: (promise: Promise<unknown>) => void;
}): TracerRoot {
    let lastTime: number | null = null;

    const tracer = TracerRoot.new({
        serviceName,
        jsHost: "CloudflareWorker",
        untrusted: false,
        // In Cloudflare Workers, `Date.now()` only moves forward on I/O as a part of
        // their security model. This means timers won't be perfectly accurate.
        //
        // Also, time only increases within a given async request. (Rough
        // implementation: Each request sets a timer via Node.js `AsyncLocalStorage`.)
        // We want time to increase monotonically across all concurrently running
        // requests for correct analysis.
        //
        // https://developers.cloudflare.com/workers/learning/security-model
        getTime: () => {
            const nextTime = Date.now();
            const time = lastTime !== null ? Math.max(lastTime, nextTime) : nextTime;
            lastTime = time;
            return time;
        },
        sendEvent: event => {
            honeycombClient?.sendEvent(event);

            // In development, send every event to our dev server so that we can write it
            // to a log file.
            if (process.env.NODE_ENV !== "production" && env.DEV_SERVER_PORT) {
                waitUntil(
                    // Being lazy and not writing error handling since this is dev only.
                    // eslint-disable-next-line no-global-fetch
                    fetch(`http://localhost:${env.DEV_SERVER_PORT}/tracer`, {
                        method: "POST",
                        headers: {"content-type": "application/json"},
                        body: JSON.stringify({
                            time: event.time,
                            data: event.getFlatData(),
                        }),
                    }).catch(error => {
                        // If there is an error, log it but don't crash the process.
                        // eslint-disable-next-line no-console
                        console.error(
                            InternalError.from(error, "Failed to send dev server events"),
                        );
                    }),
                );
            }
        },
    });

    const honeycombClient = env.HONEYCOMB_API_KEY
        ? new HoneycombTracerClient({
              apiKey: env.HONEYCOMB_API_KEY,
              tracer,
              waitUntil,
          })
        : null;

    return tracer;
}
