import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {writeTracerEventToFileInDev} from "~/shared/tracer/dev/write_tracer_event_to_file_in_dev.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data.js";

export function createLambdaTracerAndHoneycombClient({
    serviceName,
    jsHost,
    promiseWaiter,
    honeycombApiKey,
}: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    promiseWaiter: PromiseWaiter;
    honeycombApiKey?: string;
}): [TracerRoot, HoneycombTracerClient | null] {
    // If a Honeycomb API key is not provided in production then we get no logging
    // from our service.
    if (!honeycombApiKey && process.env.NODE_ENV === "production")
        throw new InternalError(
            "Must provide `honeycombApiKey` environment variable in production",
        );

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
              waitUntil: promise => {
                  promiseWaiter.waitUntil(
                      promise.catch(error => {
                          // eslint-disable-next-line no-console
                          console.error("Exception from server tracer:");
                          // eslint-disable-next-line no-console
                          console.error(error);
                      }),
                  );
              },
          })
        : null;

    return [tracer, honeycombClient];
}
