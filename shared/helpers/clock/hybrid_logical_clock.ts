import {Clock} from "~/shared/helpers/clock/clock.js";

/**
 * A hybrid logical time is the representation of time from our
 * `HybridLogicalClock`. See that class for more information.
 */
export type HybridLogicalTime = readonly [time: number, ticks: number];

export const zeroHybridLogicalTime: HybridLogicalTime = [0, 0];

/**
 * Compare two hybrid logical times.
 *
 * - If <0 then `time1 < time2`
 * - If >0 then `time1 > time2`
 * - If 0 then `time1 = time2`
 */
export function compareHybridLogicalTimes(
    [time1, ticks1]: HybridLogicalTime,
    [time2, ticks2]: HybridLogicalTime,
): -1 | 0 | 1 {
    if (time1 < time2) return -1;
    if (time2 < time1) return 1;

    if (ticks1 < ticks2) return -1;
    if (ticks2 < ticks1) return 1;

    return 0;
}

/**
 * Is `time1 < time2`?
 */
export function isHybridLogicalTimeLessThan(
    [time1, ticks1]: HybridLogicalTime,
    [time2, ticks2]: HybridLogicalTime,
) {
    if (time1 < time2) return true;
    if (time2 < time1) return false;

    if (ticks1 < ticks2) return true;
    if (ticks2 < ticks1) return false;

    return false;
}

export function areHybridLogicalTimesEqual(
    [time1, ticks1]: HybridLogicalTime,
    [time2, ticks2]: HybridLogicalTime,
) {
    return time1 === time2 && ticks1 === ticks2;
}

export function maxHybridLogicalTime(...times: [HybridLogicalTime, ...Array<HybridLogicalTime>]) {
    let maxTime = times[0];

    for (let i = 1; i < times.length; i++) {
        const time = times[i]!;
        if (compareHybridLogicalTimes(maxTime, time) < 0) {
            maxTime = time;
        }
    }

    return maxTime;
}

/**
 * The hybrid logical clock lets us maintain a monotonically increasing version
 * number across our system which still has some relation to time. We use this for
 * CRDT register versions.
 *
 * Hybrid logical clocks are used by databases like MongoDB and CockroachDB
 * ([source][1]). For more information read this explainer on [hybrid logical
 * clocks][1].
 *
 * Alternatives:
 *
 * - System time: The problem with using system time as a version is that clients
 *   will never have perfectly in-sync clocks. Some clients may have faster clocks,
 *   others slower clocks, and some clocks may have wild user time adjustments
 *   (e.g. when you're playing Animal Crossing and set the Nintendo's time to some
 *   point in the future to see a time based event immediately).
 *
 *     In addition, thanks to leap seconds, some times will repeat. See "[Keeping
 *     Time in Real Systems][2]" for a breakdown of all the problems with using
 *     system time in distributed systems. This talk also only considers machines
 *     under our control, it doesn't consider client machines.
 *
 * - Lamport timestamps: A [Lamport timestamp][3] is an integer that only ever
 *   monotonically increases. In CRDT scenarios it comes with a client ID for
 *   resolving conflicts between users. Lamport timestamps have no relation to
 *   time, which is fine for some applications. In our case, though, we want to be
 *   able to add elements to the end of a list of unknown data (so we don't need to
 *   load that data). Having some notion of time is necessary for this.
 *
 * Hence we use a hybrid logical clock which combines system time with a lamport
 * timestamp-like version conflict number.
 *
 * [1]:
 *     https://martinfowler.com/articles/patterns-of-distributed-systems/hybrid-clock.html
 * [2]: https://www.youtube.com/watch?v=BRvj8PykSc4
 * [3]: https://en.wikipedia.org/wiki/Lamport_timestamp
 */
export class HybridLogicalClock {
    private readonly _clock: Clock;
    private _latestTime: HybridLogicalTime;

    constructor(clock: Clock) {
        this._clock = clock;

        // Clock may return decimal values but `HybridLogicalTime` should be an integer.
        this._latestTime = [Math.floor(this._clock.now()), 0];
    }

    /**
     * Get the current logical time. This function is monotonically increasing which
     * means it always increases and never returns the same value.
     */
    public now(): HybridLogicalTime {
        // Clock may return decimal values but `HybridLogicalTime` should be an integer.
        const currentTime = Math.floor(this._clock.now());

        if (currentTime <= this._latestTime[0]) {
            this._latestTime = [this._latestTime[0], this._latestTime[1] + 1];
        } else {
            this._latestTime = [currentTime, 0];
        }

        return this._latestTime;
    }

    /**
     * Ensures that the next time you call `now()` you'll get a time greater than the
     * provided time.
     *
     * Used to establish a causal relationship between times. In other words future
     * times returned by `now()` are definitely after the provided time and clients can
     * interpret actions associated with these times appropriately.
     *
     * If our system time is less than the provided time then we consider our logical
     * clock's latest time to now be the provided time and increment the `ticks`
     * property of that timestamp until our system time catches up.
     */
    public tick(time: HybridLogicalTime): void {
        if (compareHybridLogicalTimes(this._latestTime, time) < 0) {
            this._latestTime = time;
        }
    }

    /**
     * Gets a time after the provided time.
     *
     * Used to establish a causal relationship between times. In other words the
     * returned time is definitely after the provided time and clients can interpret
     * actions associated with these times appropriately.
     *
     * If our system time is less than the provided time then we consider our logical
     * clock's latest time to now be the provided time and increment the `ticks`
     * property of that timestamp until our system time catches up.
     */
    public tickNow(time: HybridLogicalTime): HybridLogicalTime {
        const currentTime = this.now();

        if (compareHybridLogicalTimes(currentTime, time) > 0) {
            return currentTime;
        }

        this._latestTime = time;
        return this._latestTime;
    }
}
