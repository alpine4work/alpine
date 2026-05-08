import {assert} from "~/shared/helpers/control/assert.js";

export type Interval = {
    readonly clear: () => void;

    // Node.js-specific methods which let Node.js know whether this internal should
    // keep the event loop active until it finishes.
    readonly ref?: () => void;
    readonly unref?: () => void;
};

const maxDelayMs = 2 ** 31 - 1;

/**
 * A convenience wrapper around `setInterval()` and `clearInterval()` that lets you
 * avoid dealing with intermediate timeout ids.
 */
export function createInterval(callback: () => void, delayMs: number): Interval {
    // Interval `delayMs` is [converted to a 32-bit integer][1] so delays above that
    // have weird behavior.
    //
    // [1]:
    //     https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval#delay_restrictions
    assert(delayMs <= maxDelayMs);

    // TypeScript `setInterval()` typing is weird. In Node.js environments it's an
    // object. In browser environments it's a number. That's the reason we have this
    // helper is the TypeScript type is weird and changes based on the environment. Use
    // `any` so we can use the `intervalId` however we need.
    const intervalId: any = setInterval(callback, delayMs);

    return {
        clear: () => clearInterval(intervalId),
        ref: typeof intervalId === "object" ? intervalId.ref.bind(intervalId) : undefined,
        unref: typeof intervalId === "object" ? intervalId.unref.bind(intervalId) : undefined,
    };
}
