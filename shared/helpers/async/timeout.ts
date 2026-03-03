export type Timeout = {
    readonly clear: () => void;
};

/**
 * A convenience wrapper around `setTimeout()` and `clearTimeout()` that lets you
 * avoid dealing with intermediate timeout ids.
 */
export function createTimeout(callback: () => void, ms: number): Timeout {
    const timeoutId = setTimeout(callback, ms);
    return {clear: () => clearTimeout(timeoutId)};
}
