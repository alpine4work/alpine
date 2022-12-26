import {
    CallbackNode,
    unstable_IdlePriority,
    unstable_cancelCallback,
    unstable_scheduleCallback,
} from "scheduler";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing_constants";
import {assert} from "~/shared/helpers/control/assert";
import {TracerRoot} from "~/shared/tracer/tracer_root";
import {TracerEvent} from "~/shared/tracer/tracer_event";

/**
 * Creates a tracer to be used in a web browser.
 */
export function createClientTracer() {
    assert(typeof document !== "undefined");

    const initialDateNow = Date.now();
    const initialPerformanceNow = Math.floor(performance.now());

    let queuedEvents: Array<TracerEvent> = [];
    let scheduledFlushEventsCallbackNode: CallbackNode | null = null;

    const tracer = TracerRoot.new({
        serviceName: "AppClient",
        jsHost: "Web",
        getTime: () => {
            // We use `performance.now()` for measuring time on the client since it is a
            // monotonically increasing clock designed for measuring performance.
            //
            // The user may change their system clock which would give `Date.now()` weird
            // inconsistent values whereas `performance.now()` (to our knowledge) should
            // only move forward.
            //
            // We capture the initial time from `Date.now()` so we get a timestamp since
            // the Unix epoch instead of the window origin.
            return initialDateNow + (Math.floor(performance.now()) - initialPerformanceNow);
        },
        sendEvent: event => {
            queuedEvents.push(event);

            if (!scheduledFlushEventsCallbackNode) {
                // Use the React scheduler to schedule an event flush at idle priority so
                // that work responding to the user can interrupt.
                scheduledFlushEventsCallbackNode = unstable_scheduleCallback(
                    // An idle priority means there is no execution deadline. Any work can interrupt
                    // our flush.
                    unstable_IdlePriority,
                    flushEvents,
                    {
                        // Even if there is no ongoing work, wait a bit before flushing events. That
                        // way if many events happen in quick succession they will all be added to
                        // this flush.
                        delay: uninterruptedThoughtLimitMs,
                    },
                );
            }
        },
    });

    function flushEvents() {
        if (scheduledFlushEventsCallbackNode) {
            unstable_cancelCallback(scheduledFlushEventsCallbackNode);
            scheduledFlushEventsCallbackNode = null;
        }

        const events = queuedEvents;
        queuedEvents = [];

        if (events.length === 0) return;

        // Use the `sendBeacon()` API since it is designed for asynchronously sending
        // analytics data to the server.
        // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
        navigator.sendBeacon(
            "/api/tracer",
            JSON.stringify(events.map(event => ({time: event.time, data: event.getFlatData()}))),
        );
    }

    // Flush events immediately when the page is hidden. This handles the case
    // where the user closes their browser which cancels asynchronous scheduled
    // work. This also handles the case where the user navigates away from the
    // browser tab and later closes their browser with their application manager.
    //
    // MDN has guidance on how to send analytics at the end of a session here:
    // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon#sending_analytics_at_the_end_of_a_session
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushEvents();
        }
    });

    return tracer;
}
