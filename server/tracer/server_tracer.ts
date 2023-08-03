import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {writeTracerEventToFileInDev} from "~/server/tracer/write_tracer_event_to_file_in_dev.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data.js";

// Use a different implementation of `getServerTracerTime` in Node.js and
// Cloudflare Workers. In Node.js we can use `process.hrtime`. In Cloudflare
// Workers, for security reasons, we have a much less accurate clock.
export const getServerTracerTime: () => number =
    typeof process !== "undefined"
        ? (() => {
              const [hrtime1, startTime, hrtime2] = [
                  process.hrtime.bigint(),
                  Date.now(),
                  process.hrtime.bigint(),
              ];
              const startHrtime = hrtime1 + (hrtime2 - hrtime1) / 2n;

              // `process.hrtime` is relative to an arbitrary time in the past so is not
              // subject to clock drift. We take an hrtime measurement at the start of our
              // process and use that to convert to an absolute time.
              return () => {
                  return startTime + Number(process.hrtime.bigint() - startHrtime) / 1000000;
              };
          })()
        : (() => {
              let lastTime: number | null = null;

              // In Cloudflare Workers, `Date.now()` only moves forward on I/O as a part of
              // their security model. This means timers won't be perfectly accurate.
              //
              // Also, time only increases within a given async request. (Rough
              // implementation: Each request sets a timer via Node.js `AsyncLocalStorage`.)
              // We want time to increase monotonically across all concurrently running
              // requests for correct analysis.
              //
              // https://developers.cloudflare.com/workers/learning/security-model
              return () => {
                  const nextTime = Date.now();

                  // Make sure time is always monotonically increasing. `Date.now()` is based on
                  // the system clock which could change.
                  const time = lastTime !== null ? Math.max(lastTime, nextTime) : nextTime;
                  lastTime = time;

                  return time;
              };
          })();

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
