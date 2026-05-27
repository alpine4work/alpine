import {useEffect, useRef} from "react";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {useGlobalContext} from "~/client/web/helpers/global_context.js";
import {
    SwrCacheContext,
    swrDefaultDedupingIntervalMs,
} from "~/client/web/rpc/internal/swr_cache.js";
import {assert} from "~/shared/helpers/control/assert.js";

let scheduledIdlePreloadRpcCallbacks: Array<() => void> | null = null;

/**
 * Preload data into our SWR cache with idle priority. Useful if you have some UI
 * that uses `useSwr()` to render data and you want the data to be immediately
 * available when the user navigates to that UI.
 */
export function useIdlyPreloadSwr(
    key: string | null,
    fetcher: (key: string) => PromiseLike<object>,
    {
        dedupingInterval = swrDefaultDedupingIntervalMs,
    }: {
        /**
         * When we make a request for a given `key`, how long should we consider the
         * request "fresh". Any other component that wants data for the key will reuse the
         * existing pending request instead of sending a new one.
         */
        dedupingInterval?: number;
    } = {},
) {
    const cache = useGlobalContext(SwrCacheContext);

    const retainedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (key === null) return;

        retainedKeyRef.current = key;
        cache.retainEntry(key);
        return () => {
            retainedKeyRef.current = null;
            cache.releaseEntry(key);
        };
    }, [cache, key]);

    // When `key` changes, preload it once.
    const hasPreloadedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (hasPreloadedKeyRef.current === key) return;
        hasPreloadedKeyRef.current = key;

        if (key === null) return;

        if (scheduledIdlePreloadRpcCallbacks === null) {
            scheduledIdlePreloadRpcCallbacks = [];

            // Use the React scheduler to schedule an idle callback. `requestIdleCallback()` is
            // not implemented in Safari. Generally we recommend using the React scheduler
            // since it has centralized knowledge of all our tasks (including UI rendering).
            unstable_scheduleCallback(unstable_IdlePriority, () => {
                assert(scheduledIdlePreloadRpcCallbacks !== null);

                const callbacks = scheduledIdlePreloadRpcCallbacks;
                scheduledIdlePreloadRpcCallbacks = null;

                for (const callback of callbacks) {
                    callback();
                }
            });
        }

        assert(retainedKeyRef.current === key);

        scheduledIdlePreloadRpcCallbacks.push(() => {
            // Make sure `key` is still retained. If `key` changes or the component unmounts
            // after we scheduled the idle callback then we need to not run our idle callback.
            if (retainedKeyRef.current === key) {
                cache.revalidateEntryIfNotAvailable(key, fetcher, {dedupingInterval});
            }
        });
    }, [cache, dedupingInterval, fetcher, key]);
}
