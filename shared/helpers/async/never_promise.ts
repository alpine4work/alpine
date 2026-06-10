/**
 * A promise that never resolves or never rejects. It hangs indefinitely.
 */
export const neverPromise: Promise<never> = new Promise(() => {});
