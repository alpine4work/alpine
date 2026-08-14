import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";

export function createClaudeAgentServiceTracer() {
    let pending: {
        timeout: Timeout;
        events: Array<{time: number; data: TracerEventFlatData}>;
    } | null = null;

    const promiseWaiter = new PromiseWaiter();

    const flushPendingEvents = () => {
        promiseWaiter.waitUntil(async () => {
            assert(pending !== null);
            const {events} = pending;
            pending = null;

            // eslint-disable-next-line cyberworlds/no-global-fetch
            await fetch("http://tracer.cyberworlds.dev", {
                method: "POST",
                body: JSON.stringify(events),
            });
        });
    };

    const tracer = TracerRoot.new({
        serviceName: "ClaudeAgentService",
        jsHost: "Node",
        // Events from `ClaudeAgentService` are untrusted because if Claude figures out how
        // to send events within the sandbox then it can go nuts and send all kinds of
        // trash events.
        //
        // We can filter out events with this untrusted flag on the server to get clean,
        // trusted, data.
        untrusted: true,
        clock: unsynchronizedSystemClock,
        sendEvent: event => {
            if (pending === null) {
                pending = {
                    events: [],
                    timeout: createTimeout(flushPendingEvents, 1000),
                };
            }

            pending.events.push({
                time: event.time,
                data: event.getFlatData(),
            });
        },
    });

    return {
        tracer,
        flushTracerEvents: async () => {
            if (pending !== null) {
                pending.timeout.clear();
                flushPendingEvents();
            }

            await promiseWaiter.wait();
        },
    };
}
