import {GiphyFetch} from "@giphy/js-fetch-api";
import {IGif} from "@giphy/js-types";
import {AppContext} from "~/client/web/context/app_context.js";
import {preloadSwr} from "~/client/web/rpc/preload_swr.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

/**
 * How many GIFs to fetch per page.
 *
 * TODO(#giphy-paid-api-key): When we have a paid API key we should use a lower
 * page limit in production. We use a higher page now so we have to make less
 * requests.
 */
const pageLimit = 30;

/**
 * Whether to preload Giphy data into the SWR cache in development.
 */
const debugPreloadEnabled: CommitBlocker | null = null;

/**
 * Whether to preload Giphy data into the SWR cache.
 *
 * This is disabled in development because we only get 100 requests per hour in our
 * free tier. We don't want to hit our free tier limit in development.
 *
 * TODO(#giphy-paid-api-key): Add a process.env.NODE_ENV === "production" check
 * here when we get a paid API key.
 */
const preloadEnabled = !!debugPreloadEnabled;

export type GiphyPageResult = {
    readonly gifs: ReadonlyArray<IGif>;
    readonly isDone: boolean;
};

let giphyFetchInstance: GiphyFetch | null = null;

/**
 * Whether the Giphy integration is enabled. Checks that the build-time API key
 * global is defined and non-empty.
 */
export function isGiphyEnabled(): boolean {
    return typeof __GIPHY_SDK_API_KEY__ !== "undefined" && !!__GIPHY_SDK_API_KEY__;
}

function getGiphyFetch(): GiphyFetch {
    if (!giphyFetchInstance) {
        const apiKey =
            typeof __GIPHY_SDK_API_KEY__ !== "undefined" ? __GIPHY_SDK_API_KEY__ : undefined;
        assert(apiKey, "Giphy API key is required");
        giphyFetchInstance = new GiphyFetch(apiKey);
    }
    return giphyFetchInstance;
}

/**
 * SWR cache key for a Giphy page fetch.
 */
export function giphySwrKey(query: string, offset: number): string {
    return `giphy:${JSON.stringify({query, offset})}`;
}

/**
 * Creates a fetcher compatible with `useSwr()` for Giphy page requests. The
 * fetcher parses the query and offset from the SWR key.
 */
export function createGiphyFetcher(context: AppContext): (key: string) => Promise<GiphyPageResult> {
    return async (key: string) => {
        const {query, offset}: {query: string; offset: number} = JSON.parse(
            key.slice("giphy:".length),
        );
        const gf = getGiphyFetch();

        const result = await context.tracer.withSpan(
            query ? "Giphy search" : "Giphy trending",
            async () => {
                return query
                    ? await gf.search(query, {offset, limit: pageLimit})
                    : await gf.trending({offset, limit: pageLimit});
            },
        );

        return {gifs: result.data, isDone: result.data.length === 0};
    };
}

/**
 * Fetch a page of GIFs from Giphy (trending or search). Used for pagination beyond
 * page 0 where SWR caching isn't needed.
 */
export async function giphyFetchPage(
    context: AppContext,
    query: string,
    offset: number,
): Promise<GiphyPageResult> {
    return await createGiphyFetcher(context)(giphySwrKey(query, offset));
}

/**
 * Preload trending page 0 into the SWR cache. Called on ContentEditor mount when
 * `onSelectGif` is provided so the picker opens instantly.
 */
export function preloadGiphyTrending(context: AppContext): void {
    if (!preloadEnabled) return;

    preloadSwr(giphySwrKey("", 0), createGiphyFetcher(context));
}
