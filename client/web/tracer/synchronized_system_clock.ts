import {isValid as isValidDate} from "date-fns/isValid";
import {parseISO} from "date-fns/parseISO";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Clock} from "~/shared/helpers/clock/clock.js";
import {assert} from "~/shared/helpers/control/assert.js";

let synchronizedSystemClockPromise: PromiseImmediate<SynchronizedSystemClock> | null = null;

/**
 * Get the synchronized system clock. The synchronized system clock uses the
 * device's system clock but adds communication with our servers to get the
 * real time unaffected by the user's local device's clock adjustments.
 *
 * If you are getting a time on the client you want to use for ordering events
 * on the server relative to other clients then you should be using this clock.
 *
 * Uses [NTP clock synchronization][1] to determine the right time.
 *
 * [1]: https://en.wikipedia.org/wiki/Network_Time_Protocol
 */
export function getSynchronizedSystemClock(): PromiseImmediate<SynchronizedSystemClock> {
    if (synchronizedSystemClockPromise === null) {
        synchronizedSystemClockPromise = SynchronizedSystemClock.new();
    }
    return synchronizedSystemClockPromise;
}

class SynchronizedSystemClock implements Clock {
    private _clientTimeOffsetMs: number;

    constructor(clientTimeOffsetMs: number) {
        this._clientTimeOffsetMs = clientTimeOffsetMs;

        // When running in a web browser, occasionally refresh the client time offset
        // to make sure our clock is still synchronized with the server.
        //
        // Outside of web browser environments, we assume the system clock is
        // synchronized for us. (e.g. AWS Linux 2 AMIs use the AWS Time Sync service.)
        if (typeof window !== "undefined") {
            const listener = () => {
                // When the document is made visible, immediately go and update our client
                // time offset.
                if (document.visibilityState === "visible") {
                    fetchClientTimeOffsetMs()
                        .then(clientTimeOffsetMs => (this._clientTimeOffsetMs = clientTimeOffsetMs))
                        .catch(scheduleUncaughtError);
                }
            };

            document.addEventListener("visibilitychange", listener);
        }
    }

    /**
     * Returns a `PromiseImmediate` so if the clock is available synchronously we
     * return it synchronously.
     */
    public static new(): PromiseImmediate<SynchronizedSystemClock> {
        // If we are running on the server then assume our system clock is
        // synchronized for us. (e.g. AWS Linux 2 AMIs use the AWS Time Sync service.)
        if (typeof window === "undefined") {
            return PromiseImmediate.resolve(new SynchronizedSystemClock(0));
        }

        // Try to get the client time offset from the HTTP `Server-Timing` header. If
        // it doesn't exist then we need to make a network request.
        //
        // If it does exist then yay! We can use time immediately without needing to
        // wait for a network roundtrip.
        let clientTimeOffsetMs = getClientTimeOffsetMsFromServerTimingIfAvailable();
        if (clientTimeOffsetMs !== null) {
            return PromiseImmediate.resolve(new SynchronizedSystemClock(clientTimeOffsetMs));
        }

        return PromiseImmediate.resolve(
            (async () => {
                // It's essential that we load the client time offset from our server. So in
                // case we there's a transient network error, keep retrying until we get the
                // client time offset.
                clientTimeOffsetMs = await retryWithExponentialBackoff(async retry => {
                    try {
                        const clientTimeOffsetMs = await fetchClientTimeOffsetMs();
                        return clientTimeOffsetMs;
                    } catch (error) {
                        throw retry(error);
                    }
                });

                return new SynchronizedSystemClock(clientTimeOffsetMs);
            })(),
        );
    }

    /**
     * Get the client time offset as determined by this clock. You can add this to
     * `unsynchronizedSystemClock.now()` to get the same time our synchronized
     * system clock would return.
     */
    public getClientTimeOffsetMs() {
        return this._clientTimeOffsetMs;
    }

    /**
     * Get the system time. Calls `Date.now()` and adds the client time offset.
     */
    public now() {
        return Date.now() + this._clientTimeOffsetMs;
    }
}

/**
 * Gets the client's time offset using the HTTP `Server-Timing` header if
 * available. Once we parse information from the `Server-Timing` header we use
 * the [NTP algorithm][1] to determine the client offset.
 *
 * You add the returned offset to client times to get the synced time.
 *
 * [1]: https://stackoverflow.com/a/8478288/1568890
 */
function getClientTimeOffsetMsFromServerTimingIfAvailable(): number | null {
    // Avoid error in Safari 10 and other old browsers.
    //
    // TODO(calebmer): Our mobile wrapper runs WebKit on iOS and our desktop
    // wrapper may run WebKit on MacOS. We should inject an implementation of
    // `Server-Timing` in these environments since a synchronized system clock
    // being immediately available is important for monitoring and for our
    // task system.
    if (!window.performance || !performance.getEntriesByType) return null;

    const navigationTimings = performance.getEntriesByType(
        "navigation",
    ) as Array<PerformanceNavigationTiming>;

    // Still not supported as of Safari 14...
    if (!navigationTimings[0]) return null;

    const navigationTiming = navigationTimings[0];

    // Request was read from the cache. Cached server timing header won't be
    // accurate here.
    if (navigationTiming.requestStart === 0) return null;

    const edgeServerTiming = navigationTiming.serverTiming?.find(entry => entry.name === "edge");
    if (!edgeServerTiming) return null;

    const serverStartTimeMatch = edgeServerTiming.description.match(/\(start time: (.+?)\)/);
    assert(serverStartTimeMatch);
    const serverStartTimeDate = parseISO(serverStartTimeMatch[1]!);
    assert(isValidDate(serverStartTimeDate));
    const serverStartTime = serverStartTimeDate.getTime();
    const serverEndTime = serverStartTime + edgeServerTiming.duration;

    // Get an anchor time that allows us to turn `DOMHighResTimeStamp`s into system
    // time measured in milliseconds since the Unix epoch.
    const [highResTime1, anchorTime, highResTime2] = [
        performance.now(),
        Date.now(),
        performance.now(),
    ];
    const anchorHighResTime = highResTime1 + (highResTime2 - highResTime1) / 2;

    const clientStartTime = anchorTime + (navigationTiming.requestStart - anchorHighResTime);
    const clientEndTime = anchorTime + (navigationTiming.responseStart - anchorHighResTime);

    const sendingDuration = serverStartTime - clientStartTime;
    const receivingDuration = clientEndTime - serverEndTime;
    const roundtripDuration = sendingDuration + receivingDuration;

    const clientTimeOffsetMs = sendingDuration - roundtripDuration / 2;

    return clientTimeOffsetMs;
}

let timeApiCallCount = 1;

/**
 * Get the current client time offset by making a network request to our
 * servers. We then use the [NTP algorithm][1] to determine the client offset.
 *
 * You add the returned offset to client times to get the synced time.
 *
 * [1]: https://stackoverflow.com/a/8478288/1568890
 */
async function fetchClientTimeOffsetMs() {
    // Add a unique key query parameter so we can find the associated performance
    // entry later.
    const url = new URL(`/api/time?n=${timeApiCallCount++}`, window.location.href);

    const clientStartHighResTime = performance.now();
    // eslint-disable-next-line cyberworlds/no-global-fetch
    const response = await fetch(url);
    const body: {startTime: number; endTime: number} = await response.json();
    const serverStartTime = body.startTime;
    const serverEndTime = body.endTime;
    const clientEndHighResTime = performance.now();

    // Get an anchor time that allows us to turn `DOMHighResTimeStamp`s into system
    // time measured in milliseconds since the Unix epoch.
    const [highResTime1, anchorTime, highResTime2] = [
        performance.now(),
        Date.now(),
        performance.now(),
    ];
    const anchorHighResTime = highResTime1 + (highResTime2 - highResTime1) / 2;

    // Ideally we have a resource timing entry which excludes any unessential time
    // like DNS connection time or response streaming time which closely matches
    // our server timing.
    const resourceTiming = performance.getEntriesByName(url.toString())[0] as
        | PerformanceResourceTiming
        | undefined;

    const clientStartTime =
        anchorTime + ((resourceTiming?.requestStart ?? clientStartHighResTime) - anchorHighResTime);
    const clientEndTime =
        anchorTime + ((resourceTiming?.responseStart ?? clientEndHighResTime) - anchorHighResTime);

    const sendingDuration = serverStartTime - clientStartTime;
    const receivingDuration = clientEndTime - serverEndTime;
    const roundtripDuration = sendingDuration + receivingDuration;

    const clientTimeOffsetMs = sendingDuration - roundtripDuration / 2;

    return clientTimeOffsetMs;
}
