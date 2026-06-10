/**
 * Creates a promise that waits for the `AbortSignal` to fire. This promise will
 * only ever reject, it will never resolve. If the `AbortSignal` is never fired
 * then the promise never resolves.
 */
export function waitForAbort(signal: AbortSignal): Promise<never> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
        } else {
            const handleAbort = () => {
                signal.removeEventListener("abort", handleAbort);
                reject(signal.reason);
            };
            signal.addEventListener("abort", handleAbort);
        }
    });
}
