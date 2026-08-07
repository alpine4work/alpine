import {Clock} from "~/shared/helpers/clock/clock.open_source.js";

/**
 * Use the system clock. The system clock may go backwards in time or leap ahead
 * due to user clock adjustments, clock skew, and leap seconds.
 *
 * Calls [`Date.now()`][1] directly under the hood.
 *
 * On client devices what you probably want is a synchronized system clock (see
 * `synchronized_system_clock.ts`). A synchronized clock will communicate with a
 * server to determine the actual time which is not affected by user clock
 * adjustments.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now
 */
export const unsynchronizedSystemClock: Clock = Date;
