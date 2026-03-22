export type Timeout = {
    readonly clear: () => void;

    // Node.js-specific methods which let Node.js know whether this internal should
    // keep the event loop active until it finishes.
    readonly ref?: () => void;
    readonly unref?: () => void;
};

/**
 * A convenience wrapper around `setTimeout()` and `clearTimeout()` that lets you
 * avoid dealing with intermediate timeout ids.
 */
export function createTimeout(callback: () => void, ms: number): Timeout {
    // TypeScript `setTimeout()` typing is weird. In Node.js environments it's an
    // object. In browser environments it's a number. That's the reason we have this
    // helper is the TypeScript type is weird and changes based on the environment. Use
    // `any` so we can use the `timeoutId` however we need.
    const timeoutId: any = setTimeout(callback, ms);

    return {
        clear: () => clearTimeout(timeoutId),
        ref: typeof timeoutId === "object" ? timeoutId.ref.bind(timeoutId) : undefined,
        unref: typeof timeoutId === "object" ? timeoutId.unref.bind(timeoutId) : undefined,
    };
}
