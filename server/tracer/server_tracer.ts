import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {writeTracerEventToFileInDev} from "~/shared/tracer/dev/write_tracer_event_to_file_in_dev.js";
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
            // Don't send events to tracer when running tests. To detect whether we're
            // running a Playwright integration test we must check `PLAYWRIGHT_TEST_PATH`.
            //
            // This mirrors the behavior in `test_tracer.ts`. See `test_tracer.ts` for more
            // information on why we don't log tracer events in tests. We need to check
            // whether we're running in a test here because integration tests will create a
            // server tracer for test services.
            if (process.env.NODE_ENV === "test" || process.env.PLAYWRIGHT_TEST_PATH) return;

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
