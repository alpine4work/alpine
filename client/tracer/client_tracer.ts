import {
    CallbackNode,
    unstable_IdlePriority,
    unstable_LowPriority,
    unstable_cancelCallback,
    unstable_scheduleCallback,
} from "scheduler";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

/**
 * Creates a tracer to be used in a web browser.
 */
export function createClientTracer() {
    assert(typeof document !== "undefined");

    const initialDateNow = Date.now();
    const initialPerformanceNow = Math.floor(performance.now());

    const getTime = () => {
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
    };

    let queuedEvents: Array<TracerEvent> = [];
    let scheduledFlushEventsCallbackNode: CallbackNode | null = null;

    let serverTimeOffsetMs = 0;
    let serverTimePromiseResolver: PromiseResolver<void> | null = null;

    const tracer = TracerRoot.new({
        serviceName: "AppClient",
        jsHost: "Web",
        // Events from our client tracer are untrusted because any bad actor could get
        // ahold of our client tracer and send whatever event they want to the server.
        //
        // We can filter out events with this untrusted flag on the server to get
        // clean data.
        untrusted: true,
        getTime,
        sendEvent: event => {
            queuedEvents.push(event);
            scheduleFlushEventsIfNeeded();
        },
    });

    function scheduleFlushEventsIfNeeded() {
        // Don't schedule a flush if there are no queued events.
        if (queuedEvents.length === 0) return;

        // If we have not yet received a time from the server, don't flush events
        // because we don't have our server time offset.
        if (!serverTimePromiseResolver || !serverTimePromiseResolver.isSettled()) return;

        // Don't schedule a flush if we have a flush already scheduled.
        if (scheduledFlushEventsCallbackNode) return;

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

        // Use the `sendBeacon()` API since it is designed for asynchronously sending
        // analytics data to the server.
        // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
        navigator.sendBeacon(
            "/api/tracer",
            JSON.stringify(
                events.map(event => {
                    // Send our events to the server with the server time, not client time. We
                    // compute the server time from our client time by applying our server
                    // time offset.
                    const time = event.time + serverTimeOffsetMs;

                    const data = event.getFlatData();

                    // Record the time offset for this event. `time + clientTimeOffsetMs` should
                    // give you the client time so we need to flip the sign.
                    data["meta.client_time_offset_ms"] = serverTimeOffsetMs * -1;

                    return {time, data};
                }),
            ),
        );
    }

    document.addEventListener("visibilitychange", () => {
        // Flush events immediately when the page is hidden. This handles the case
        // where the user closes their browser which cancels asynchronous scheduled
        // work. This also handles the case where the user navigates away from the
        // browser tab and later closes their browser with their application manager.
        //
        // MDN has guidance on how to send analytics at the end of a session here:
        // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon#sending_analytics_at_the_end_of_a_session
        if (document.visibilityState === "hidden") {
            flushEvents();
        }

        // When the document goes from hidden to visible,
        if (document.visibilityState === "visible") {
            scheduleServerTimeOffsetUpdate();
        }
    });

    function scheduleServerTimeOffsetUpdate() {
        // If we are waiting on an existing server time offset update task to resolve
        // then don't start a new server time offset update task.
        if (serverTimePromiseResolver && !serverTimePromiseResolver.isSettled()) return;

        const promiseResolver = createPromiseResolver();
        serverTimePromiseResolver = promiseResolver;

        unstable_scheduleCallback(unstable_LowPriority, () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    const clientStartTime = getTime();
                    // eslint-disable-next-line no-global-fetch
                    const response = await fetch("/api/time");
                    const body: {time: number} = await response.json();
                    const serverTime = body.time;
                    const clientEndTime = getTime();

                    // Use the [NTP clock synchronization algorithm][1] to determine what the offset
                    // between our client clock and the server clock is within a few milliseconds of
                    // accuracy.
                    //
                    // [1]: https://en.wikipedia.org/wiki/Network_Time_Protocol
                    serverTimeOffsetMs = Math.round(
                        (serverTime - clientStartTime + (serverTime - clientEndTime)) / 2,
                    );
                } catch (error) {
                    // If we get an error, throw it as an uncaught error and pretend like our
                    // client clock (with the last `serverTimeOffsetMs`) is in sync with
                    // the server.
                    scheduleUncaughtError(error);
                }

                promiseResolver.resolve();

                // We wait to flush events until a server time has been received. If we have
                // some events but no flush scheduled then schedule a flush now.
                scheduleFlushEventsIfNeeded();
            });
        });
    }

    // Schedule a task to get the server time offset immediately on tracer
    // construction.
    scheduleServerTimeOffsetUpdate();

    return tracer;
}
