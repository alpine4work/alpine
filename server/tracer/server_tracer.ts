import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Create a tracer for a service running in a server Cloudflare
 * Workers environment.
 */
export function createServerTracer({
    serviceName,
    jsHost,
    honeycombApiKey,
    waitUntil,
    writeEventToFileInDev,
}: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    honeycombApiKey: string | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
    writeEventToFileInDev: (event: unknown) => void;
}): TracerRoot {
    let lastTime: number | null = null;

    const tracer = TracerRoot.new({
        serviceName,
        jsHost,
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

            if (process.env.NODE_ENV !== "production") {
                writeEventToFileInDev({
                    time: event.time,
                    data: event.getFlatData(),
                });
            }
        },
    });

    const honeycombClient = honeycombApiKey
        ? new HoneycombTracerClient({
              apiKey: honeycombApiKey,
              tracer,
              waitUntil,
          })
        : null;

    return tracer;
}
