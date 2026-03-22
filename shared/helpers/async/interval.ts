export type Interval = {
    readonly clear: () => void;

    // Node.js-specific methods which let Node.js know whether this internal should
    // keep the event loop active until it finishes.
    readonly ref?: () => void;
    readonly unref?: () => void;
};

/**
 * A convenience wrapper around `setInterval()` and `clearInterval()` that lets you
 * avoid dealing with intermediate timeout ids.
 */
export function createInterval(callback: () => void, ms: number): Interval {
    // TypeScript `setInterval()` typing is weird. In Node.js environments it's an
    // object. In browser environments it's a number. That's the reason we have this
    // helper is the TypeScript type is weird and changes based on the environment. Use
    // `any` so we can use the `intervalId` however we need.
    const intervalId: any = setInterval(callback, ms);

    return {
        clear: () => clearInterval(intervalId),
        ref: typeof intervalId === "object" ? intervalId.ref.bind(intervalId) : undefined,
        unref: typeof intervalId === "object" ? intervalId.unref.bind(intervalId) : undefined,
    };
}
