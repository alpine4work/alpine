/**
 * An object that measures time.
 */
export interface Clock {
    /**
     * Returns the number of milliseconds elapsed since the Unix epoch.
     *
     * May return a fractional value where the fraction contains nanoseconds when more
     * precision is available.
     *
     * There is no guarantee that the time monotonically increases. We may use a system
     * clock that's subject to user clock adjustments and clock skew.
     *
     * The simplest implementation is [`Date.now()`][1].
     *
     * [1]:
     *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now
     */
    now(): number;
}
