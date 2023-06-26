import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";

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

            // In development, we write every event to a log file. This function is
            // provided to us by `dev_main.ts` setting a global.
            if (
                process.env.NODE_ENV !== "production" &&
                typeof (globalThis as any).__writeDevTracerEvent === "function"
            ) {
                (globalThis as any).__writeDevTracerEvent({
                    time: event.time,
                    data: event.getFlatData(),
                });
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
