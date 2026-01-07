import {Clock} from "~/shared/helpers/clock/clock.js";

declare const process: {hrtime: {bigint: () => bigint}} | undefined;

/**
 * A clock that never decreases. Not subject to system clock adjustments that
 * put the time in the past.
 *
 * The clock may repeat the time if there is no change.
 *
 * When you call `new MonotonicClock(clock)` we call `clock.now()` once and use
 * that as the base of all future times.
 *
 * This is a good clock for measuring durations for performance. It uses
 * `process.hrtime.bigint()` in Node.js and `performance.now()` in the browser.
 * In the browser `performance.now()` loses some granularity for security.
 *
 * When using this clock for performance, we recommend constructing a new
 * monotonic clock at the beginning of the operation you want to measure. That
 * way your start time will be based on the system clock (a real time) and your
 * durations will be based on the monotonic clock.
 *
 * If neither `process.hrtime.bigint()` or `performance.now()` are available
 * (e.g. in Cloudflare Workers) we have a fallback `Date.now()` implementation.
 * This implementation is subject to system clock adjustments. If the clock is
 * adjusted backwards we continue to return the last time until the clock
 * catches up. Ideally this clock doesn't have to be used.
 */
export class MonotonicClock implements Clock {
    // Make sure TypeScript doesn't allow any `Clock` object to be a monotonic
    // clock.
    declare private readonly _isMonotonic: true;

    public readonly now: () => number;

    constructor(clock: Clock) {
        // We are running in Node.js and have access to high resolution, monotonic,
        // time with `process.hrtime.bigint()`.
        if (typeof process !== "undefined" && process.hrtime) {
            const [hrtime1, startTime, hrtime2] = [
                process.hrtime.bigint(),
                clock.now(),
                process.hrtime.bigint(),
            ];
            const startHrtime = hrtime1 + (hrtime2 - hrtime1) / 2n;

            this.now = () => {
                return startTime + Number(process.hrtime.bigint() - startHrtime) / 1000000;
            };
        }
        // We are running in the browser and have access to high resolution, monotonic,
        // time with `performance.now()`.
        else if (typeof performance !== "undefined") {
            const [highResTime1, startTime, highResTime2] = [
                performance.now(),
                clock.now(),
                performance.now(),
            ];
            const startHighResTime = highResTime1 + (highResTime2 - highResTime1) / 2;

            this.now = () => {
                return startTime + (performance.now() - startHighResTime);
            };
        }
        // If we do not have access to high resolution, monotonic, time (e.g.
        // Cloudflare Workers) then use `clock.now()` but guarantee the time is
        // monotonic by never returning a value less than our previous time.
        //
        // Learn about the Cloudflare Workers security model here:
        // https://developers.cloudflare.com/workers/learning/security-model
        else {
            let lastTime = clock.now();

            this.now = () => {
                // Make sure time is always monotonically increasing. If the time did not
                // increase then we will repeat the last time until it does.
                const time = Math.max(clock.now(), lastTime);
                lastTime = time;

                return time;
            };
        }
    }
}
