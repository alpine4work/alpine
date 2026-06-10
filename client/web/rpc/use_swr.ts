import {useEffect, useMemo, useRef, useState} from "react";
import {useGlobalContext} from "~/client/web/helpers/global_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {
    SwrCacheContext,
    SwrCacheEntryHistoryStack,
    SwrCacheEntryResult,
    createSwrCacheEntryHistoryStack,
    disabledSwrCacheEntryResult,
    pendingSwrCacheEntryResult,
    swrDefaultDedupingIntervalMs,
} from "~/client/web/rpc/internal/swr_cache.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {undefinedStore} from "~/shared/store/const_store.js";

/**
 * A complete re-implementation of the [SWR library][1]. The SWR library has a
 * great API for client side read requests but it's overly complicated. It has too
 * many options and a confusing implementation that doesn't always do precisely
 * what we want. Furthermore we keep finding "bugs" or behaviors that don't exactly
 * match how we think of the library. So we rewrote to simplify, make sure behavior
 * is well defined, and allow for easy modification in the future.
 *
 * Before 2023-12-29 we used the SWR library directly. This is designed to be a
 * drop-in replacement. API names and options match what SWR defines. There are
 * some breaking changes in our implementation.
 *
 * The name "SWR" is derived from `stale-while-revalidate`, a HTTP cache
 * invalidation strategy popularized by [HTTP RFC 5861][2]. SWR is a strategy to
 * first return the data from cache (stale), then send the fetch request
 * (revalidate), and finally come with the up-to-date data.
 *
 * At a high level, we have a cache shared across the entire app. Multiple calls to
 * `useSwr()` will share the same result for the same `key` string. If we have data
 * in the cache for the provided `key` then we'll return that while loading new
 * data in the background so the user sees something.
 *
 * If `isLoading` is true that means we have no cached `data` and we're loading
 * more in the background. If we have `data` but `isValidating` is true then that
 * means we're presenting stale data to the user while fetching new data.
 *
 * TODO: Move into a dedicated `swr` package.
 *
 * [1]: https://swr.vercel.app
 * [2]: https://datatracker.ietf.org/doc/html/rfc5861
 */
export function useSwr(
    key: string | null,
    fetcher: (key: string) => PromiseLike<object>,
    {
        keepPreviousData = false,
        dedupingInterval = swrDefaultDedupingIntervalMs,
        onlyFetchIfNotAvailable = false,
        initialData = null,
    }: {
        /**
         * By default, when the key changes we throw away old data from the last key.
         * However, often you can create a better user experience by showing the user data
         * from the last key while you fetch data for the new key.
         *
         * To continue returning data from the last key while fetching new data set
         * `keepPreviousData: true`.
         */
        keepPreviousData?: boolean;

        /**
         * When we make a request for a given `key`, how long should we consider the
         * request "fresh". Any other component that wants data for the key will reuse the
         * existing pending request instead of sending a new one.
         */
        dedupingInterval?: number;

        /**
         * Only refetch the entry in the SWR cache if it isn't available. Otherwise, use
         * the existing data in the cache.
         */
        onlyFetchIfNotAvailable?: boolean;

        /**
         * Initial data to return from this hook. If provided then on initial mount we
         * won't call `fetcher` and will instead use the data from this object. The data
         * from this object will be placed in the cache so may be seen by other `useSwr()`
         * hooks observing the same key.
         */
        initialData?: object | null;
    } = {},
): SwrCacheEntryResult {
    const cache = useGlobalContext(SwrCacheContext);

    const entryStackStore = key !== null ? cache.getEntryStack(key) : undefinedStore;
    const entryStack = useStore(entryStackStore) ?? null;

    useEffect(() => {
        if (key === null) return;

        cache.retainEntry(key);
        return () => {
            cache.releaseEntry(key);
        };
    }, [cache, key]);

    // When `key` changes, revalidate it once.
    const hasRevalidatedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (hasRevalidatedKeyRef.current === key) return;
        hasRevalidatedKeyRef.current = key;

        if (key === null) return;

        if (initialData === null) {
            if (onlyFetchIfNotAvailable) {
                cache.revalidateEntryIfNotAvailable(key, fetcher, {dedupingInterval});
            } else {
                cache.revalidateEntry(key, fetcher, {dedupingInterval});
            }
        } else {
            // Wait a microtask before putting our initial data in the cache. So if there are
            // two `useSwr()` hooks looking at the same key no matter what order the hooks are
            // mounted in we'll send a network request if one of the hooks doesn't have
            // `initialData`.
            //
            // If another network request is sent then this `revalidateEntry()` call will be a
            // noop because of `dedupingInterval`.
            //
            // IMPORTANT: Don't cancel this microtask if the `useEffect()` cleans up. Since if
            // the hook re-runs we won't re-schedule the microtask because this only runs once
            // on key change.
            scheduleMicrotask(() => {
                cache.revalidateEntry(key, () => PromiseImmediate.resolve(initialData), {
                    dedupingInterval,
                });
            });
        }
    }, [cache, dedupingInterval, fetcher, initialData, key, onlyFetchIfNotAvailable]);

    // Revalidate whenever the browser activates (e.g. the window was hidden then made
    // visible again).
    useEffect(() => {
        if (key === null) return;

        // Don't revalidate when the browser activates if we were instructed to only fetch
        // if the data isn't already available.
        if (onlyFetchIfNotAvailable) return;

        return cache.subscribeToBrowserActivated(() => {
            cache.revalidateEntry(key, fetcher, {dedupingInterval});
        });
    }, [cache, dedupingInterval, fetcher, key, onlyFetchIfNotAvailable]);

    const [originalHistoryStack, setHistoryStack] = useState<SwrCacheEntryHistoryStack | null>(
        () =>
            keepPreviousData && key !== null
                ? createSwrCacheEntryHistoryStack([{key, entryStackStore}])
                : null,
    );
    let historyStack = originalHistoryStack;

    if (!keepPreviousData && originalHistoryStack !== null) {
        historyStack = null;
        setHistoryStack(historyStack);
    }

    if (keepPreviousData) {
        if (key === null) {
            if (historyStack !== null) {
                historyStack = null;
                setHistoryStack(historyStack);
            }
        } else if (historyStack === null) {
            historyStack = createSwrCacheEntryHistoryStack([{key, entryStackStore}]);
            setHistoryStack(historyStack);
        } else if (historyStack.lastKey !== key) {
            historyStack = historyStack.push({key, entryStackStore});
            setHistoryStack(historyStack);
        }
    }

    // If `keepPreviousData` is true then `historyStack` may be set which may contain
    // data from previous `key`s this hook has seen.
    const entryResult =
        useStore(historyStack ?? entryStack) ??
        (key === null ? disabledSwrCacheEntryResult : pendingSwrCacheEntryResult);

    return useMemo(() => {
        if (entryResult.data === null && initialData !== null) {
            return {...entryResult, data: initialData};
        }

        return entryResult;
    }, [entryResult, initialData]);
}
