import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {writeTracerEventToFileInDev} from "~/shared/tracer/dev/write_tracer_event_to_file_in_dev.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Create a tracer for a service running in a server Cloudflare
 * Workers environment.
 */
export function createServerTracer(options: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    honeycombApiKey: string | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
}): TracerRoot {
    return createServerTracerAndHoneycombClient(options)[0];
}

export function createServerTracerAndHoneycombClient({
    serviceName,
    jsHost,
    awsEc2InstanceId,
    awsEcsTaskId,
    honeycombApiKey,
    waitUntil,
}: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    awsEc2InstanceId?: string;
    awsEcsTaskId?: string;
    honeycombApiKey: string | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
}): [TracerRoot, HoneycombTracerClient | null] {
    const tracer = TracerRoot.new({
        serviceName,
        jsHost,
        untrusted: false,
        awsEc2InstanceId,
        awsEcsTaskId,
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

    return [tracer, honeycombClient];
}
