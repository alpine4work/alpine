/**
 * Throws an error without interrupting the current execution.
 *
 * Use this when you have an exception which wasn't handled, but for whatever
 * reason you don't want to throw it in your current context.
 */
export function scheduleUncaughtError(error: unknown) {
    setTimeout(() => {
        throw error;
    }, 0);
}
