import {getGlobalContext} from "~/client/web/helpers/global_context.js";
import {
    SwrCacheContext,
    swrDefaultDedupingIntervalMs,
} from "~/client/web/rpc/internal/swr_cache.js";

/**
 * Preload the provided key in the SWR cache.
 *
 * The preloaded entry will be retained for ~20 seconds before being deleted if a
 * `useIdlyPreloadSwr()` or `useSwr()` hook for the same key isn't mounted.
 *
 * TODO: Move into a dedicated `swr` package.
 */
export function preloadSwr(
    key: string,
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
    const cache = getGlobalContext(SwrCacheContext);

    cache.retainEntry(key);

    cache.revalidateEntryIfNotAvailable(key, fetcher, {dedupingInterval});

    // The entry will be deleted in ~20 seconds if not used.
    cache.releaseEntry(key);
}
