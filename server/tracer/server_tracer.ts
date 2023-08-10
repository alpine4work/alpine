import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {writeTracerEventToFileInDev} from "~/server/tracer/write_tracer_event_to_file_in_dev.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
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
}: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    honeycombApiKey: string | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
}): TracerRoot {
    const tracer = TracerRoot.new({
        serviceName,
        jsHost,
        untrusted: false,
        clock: unsynchronizedSystemClock,
        sendEvent: event => {
            honeycombClient?.sendEvent(event);

            if (process.env.NODE_ENV !== "production") {
                writeTracerEventToFileInDev(event);
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
