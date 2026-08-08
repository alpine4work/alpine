export type Timeout = {
    readonly clear: () => void;

    // Node.js-specific methods which let Node.js know whether this internal should
    // keep the event loop active until it finishes.
    readonly ref?: () => void;
    readonly unref?: () => void;
};

const maxDelayMs = 2 ** 31 - 1;

/**
 * A convenience wrapper around `setTimeout()` and `clearTimeout()` that lets you
 * avoid dealing with intermediate timeout ids.
 */
export function createTimeout(callback: () => void, delayMs: number): Timeout {
    // The [delay argument is convert to a signed 32-bit integer][1]. Values above that
    // cause an integer overflow which means the delay becomes a negative number and is
    // executed immediately! Which is the exact opposite of what the developer expected
    // when scheduling a timeout 30+ days in the future.
    //
    // While there's not really a good use case for 30+ day timeouts (browsers
    // JavaScript environments get reloaded frequently and Node.js environments are
    // restarted at least every deploy which happens most days) we still have
    // implemented support for long timeouts by falling back to a recursive timeout.
    //
    // We've seen 30+ day timeouts specifically in `forum_screenshot_test.ts` where the
    // browser time is fixed to October 17, 2025 but server time still proceeds as
    // normal. So signed file URLs get an expiration time in the present and we try to
    // set a timeout with `expirationTime - currentTime` (in
    // `FileRegistry._startMaintainingFile()`) to mark the file in the browser as
    // expired and fetch a new signed URL but since the delay is way more than 30 days
    // we end up with 32-bit integer overflow and mark the signed URL as expired
    // immediately. In practice, this test never needs to run the timeout, we could
    // choose to never expire the file if the delay is too long, but figure it's better
    // to fallback to an implementation that technically works and maintains the
    // contract of this function (hence why we've prefixed the function with
    // "reluctantly").
    //
    // [1]:
    //     https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
    if (delayMs > maxDelayMs) return reluctantlyCreateRecursiveLongTimeout(callback, delayMs);

    // TypeScript `setTimeout()` typing is weird. In Node.js environments it's an
    // object. In browser environments it's a number. That's the reason we have this
    // helper is the TypeScript type is weird and changes based on the environment. Use
    // `any` so we can use the `timeoutId` however we need.
    const timeoutId: any = setTimeout(callback, delayMs);

    return {
        clear: () => clearTimeout(timeoutId),
        ref: typeof timeoutId === "object" ? timeoutId.ref.bind(timeoutId) : undefined,
        unref: typeof timeoutId === "object" ? timeoutId.unref.bind(timeoutId) : undefined,
    };
}

function reluctantlyCreateRecursiveLongTimeout(callback: () => void, delayMs: number): Timeout {
    let hasRef = true;
    let remainingDelayMs = delayMs;
    let currentTimeoutId: any;

    const loop = () => {
        if (remainingDelayMs <= maxDelayMs) {
            currentTimeoutId = setTimeout(callback, remainingDelayMs);
        } else {
            remainingDelayMs -= maxDelayMs;
            currentTimeoutId = setTimeout(loop, maxDelayMs);
        }

        if (!hasRef && typeof currentTimeoutId === "object") {
            currentTimeoutId.unref();
        }
    };

    loop();

    return {
        clear: () => {
            clearTimeout(currentTimeoutId);
        },
        ref:
            typeof currentTimeoutId === "object"
                ? () => {
                      hasRef = true;
                      currentTimeoutId.ref();
                  }
                : undefined,
        unref:
            typeof currentTimeoutId === "object"
                ? () => {
                      hasRef = false;
                      currentTimeoutId.unref();
                  }
                : undefined,
    };
}
