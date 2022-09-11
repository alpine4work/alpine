/**
 * Wait for the provided number of milliseconds.
 *
 * Uses `setTimeout()` under the hood. Convenient async function for calling
 * `setTimeout()`.
 */
export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
