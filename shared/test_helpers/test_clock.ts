import {Clock} from "~/shared/helpers/clock/clock.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";

// Can only use the test clock in tests.
assert(process.env.NODE_ENV === "test");

const clock = new HybridLogicalClock(unsynchronizedSystemClock);

/**
 * Returns the current time. Never returns the same time and never returns a
 * decreasing time (aka this function is monotonic).
 *
 * Based on a `HybridLogicalClock` but returns the time in milliseconds without
 * a ticks property.
 */
function now() {
    const [time, ticks] = clock.now();
    if (ticks === 0) return time;

    clock.tick([time + 1, 0]);
    return time + 1;
}

/**
 * Returns the current time. Never returns the same time and never returns a
 * decreasing time (aka this function is monotonic).
 *
 * Based on a `HybridLogicalClock` but returns a `Date` without a ticks
 * property.
 */
function nowDate() {
    return new Date(now());
}

/**
 * Returns the current time. Never returns the same time and never returns a
 * decreasing time (aka this function is monotonic).
 *
 * Returns a `HybridLogicalTime` based on an underlying `HybridLogicalClock`.
 */
function nowLogical() {
    return clock.now();
}

/**
 * Provides monotonically increasing time for tests based on the system clock.
 * Allows the caller to get that time in different forms.
 *
 * Uses `Date.now` under the hood for the system time so times are affected by
 * Jest's time mocking.
 */
export const testClock = {
    now,
    nowDate,
    nowLogical,
};

// Check that our `testClock` is a valid `Clock` object.
cast<Clock>(testClock);
