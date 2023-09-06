import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

export let storeUpdatesBatch: {
    readonly listeners: Set<() => void>;
} | null = null;

/**
 * Batches the calling of listeners on stores until the end of the `action`
 * function.
 *
 * If a listener would have been called multiple times due to multiple updates,
 * it will only be called once at the end of the batch.
 */
export function batchStoreUpdates<Value>(action: () => Value) {
    // If we're already batching then great! Continue that batch.
    if (storeUpdatesBatch !== null) return action();

    const listeners = new Set<() => void>();
    storeUpdatesBatch = {listeners};
    try {
        const value = action();

        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                // If one of our listeners throws an error, continue calling the rest of our
                // listeners.
                //
                // Treat listener errors as unhandled errors. Emitting an event should not need
                // to think about downstream listener implementation details.
                scheduleUncaughtError(error);
            }
        }

        return value;
    } finally {
        storeUpdatesBatch = null;
    }
}
