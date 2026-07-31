import {
    CallbackNode,
    unstable_IdlePriority,
    unstable_LowPriority,
    unstable_cancelCallback,
    unstable_scheduleCallback,
} from "scheduler";
import {getClientTracerSynchronizedSystemClock} from "~/client/web/tracer/client_tracer_synchronized_system_clock.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

/**
 * Creates a tracer to be used in a web browser.
 */
export function createClientTracer() {
    assert(typeof document !== "undefined");

    let queuedEvents: Array<TracerEvent> = [];
    let scheduledFlushEventsCallbackNode: CallbackNode | null = null;

    const synchronizedSystemClock = new Lazy(() =>
        getClientTracerSynchronizedSystemClock().then(
            clock => clock,
            error => {
                scheduleUncaughtError(error);
                return null;
            },
        ),
    );

    // Initialize our synchronized system clock with low priority so that it's ready
    // when we first go to flush events.
    unstable_scheduleCallback(unstable_LowPriority, () => {
        void synchronizedSystemClock.get();
    });

    const tracer = TracerRoot.new({
        serviceName: "AppClient",
        jsHost: "Web",
        // Events from our client tracer are untrusted because any bad actor could get
        // ahold of our client tracer and send whatever event they want to the server.
        //
        // We can filter out events with this untrusted flag on the server to get clean
        // data.
        untrusted: true,
        // We use the unsynchronized system clock with our tracer even though it's subject
        // to user clock adjustments! That way the tracer object can be available
        // immediately.
        //
        // Then when we send events to the server, we adjust times using the client offset
        // from our synchronized system clock.
        clock: unsynchronizedSystemClock,
        sendEvent: event => {
            queuedEvents.push(event);
            scheduleFlushEventsIfNeeded();
        },
    });

    function scheduleFlushEventsIfNeeded() {
        // Don't schedule a flush if there are no queued events.
        if (queuedEvents.length === 0) return;

        // Don't schedule a flush if we have a flush already scheduled.
        if (scheduledFlushEventsCallbackNode) return;

        // Use the React scheduler to schedule an event flush at idle priority so that work
        // responding to the user can interrupt.
        scheduledFlushEventsCallbackNode = unstable_scheduleCallback(
            // An idle priority means there is no execution deadline. Any work can interrupt
            // our flush.
            unstable_IdlePriority,
            flushEvents,
            {
                // Even if there is no ongoing work, wait a bit before flushing events. That way if
                // many events happen in quick succession they will all be added to this flush.
                delay: 1000,
            },
        );
    }

    function flushEvents() {
        if (scheduledFlushEventsCallbackNode) {
            unstable_cancelCallback(scheduledFlushEventsCallbackNode);
            scheduledFlushEventsCallbackNode = null;
        }

        const events = queuedEvents;
        queuedEvents = [];

        if (events.length === 0) return;

        const synchronizedSystemClockPromise = synchronizedSystemClock.get();
        const synchronizedSystemClockPromiseState =
            synchronizedSystemClockPromise.getStateWithoutListening();

        switch (synchronizedSystemClockPromiseState.status) {
            case "fulfilled": {
                run(synchronizedSystemClockPromiseState.value?.offset ?? 0);
                break;
            }
            case "rejected": {
                run(0);
                break;
            }
            case "pending": {
                synchronizedSystemClockPromise.then(
                    clock => run(clock?.offset ?? 0),
                    () => run(0),
                );
                break;
            }
            default:
                throw exhaustive(synchronizedSystemClockPromiseState);
        }

        function run(clientTimeOffsetMs: number) {
            // Use the `sendBeacon()` API since it is designed for asynchronously sending
            // analytics data to the server.
            // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
            navigator.sendBeacon(
                "/api/tracer",
                JSON.stringify(
                    events.map(event => {
                        // Send our events to the server with the server time, not client time. We compute
                        // the server time from our client time by applying our server time offset.
                        const time = event.time + clientTimeOffsetMs;

                        const data = event.getFlatData();

                        // Record the time offset for this event to help debug tracer events.
                        data["meta.client_time_offset_ms"] = clientTimeOffsetMs;

                        return {time, data};
                    }),
                ),
            );
        }
    }

    document.addEventListener("visibilitychange", () => {
        // Flush events immediately when the page is hidden. This handles the case where
        // the user closes their browser which cancels asynchronous scheduled work. This
        // also handles the case where the user navigates away from the browser tab and
        // later closes their browser with their application manager.
        //
        // MDN has guidance on how to send analytics at the end of a session here:
        // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon#sending_analytics_at_the_end_of_a_session
        if (document.visibilityState === "hidden") {
            flushEvents();
        }
    });

    return tracer;
}
