export type Interval = {
    readonly clear: () => void;
};

/**
 * A convenience wrapper around `setInterval()` and `clearInterval()` that lets you
 * avoid dealing with intermediate timeout ids.
 */
export function createInterval(callback: () => void, ms: number): Interval {
    const intervalId = setInterval(callback, ms);
    return {clear: () => clearInterval(intervalId)};
}
