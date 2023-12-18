import {AppContext} from "~/client/context/app_context.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {createPromiseStore} from "~/client/helpers/store/promise_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {searchByKeywords, searchBySemantics} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchResult} from "~/shared/search/search_result.js";

/**
 * The maximum number of semantic search results we look for. These search
 * results are mixed with our keyword search results. Semantic search results
 * can be expensive to compute so we don't load too many.
 *
 * Picked 7 since it's a lucky number. Working with leading AI models requires
 * a bit of superstition.
 *
 * When paginating, we only load more keyword search results. Not new semantic
 * search results.
 */
const semanticSearchResultLimit = 7;

export type ExecuteSearchResult =
    | {
          readonly isPending: true;
          readonly isError: false;
          readonly results: null;
      }
    | {
          readonly isPending: boolean;
          readonly isError: true;
          readonly error: unknown;
          readonly results: null;
      }
    | {
          readonly isPending: boolean;
          readonly isError: false;
          readonly results: ReadonlyArray<SearchResult>;
      };

/**
 * Constant pending result `executeSearch()` returns while it's loading.
 */
export const pendingExecuteSearchResult: ExecuteSearchResult = {
    isPending: true,
    isError: false,
    results: null,
};

/**
 * Constant result `executeSearch()` returns when it receives an empty
 * search query.
 */
export const emptyExecuteSearchResult: ExecuteSearchResult = {
    isPending: false,
    isError: false,
    results: [],
};

/**
 * Execute a search request. Instead of returning a `Promise` we return a
 * `Store` since our search result may change a few times before it stabilizes.
 *
 * Returning `null` for `results` means we've loaded no search results yet. We
 * may return `isPending: true` when `results` is non-null. This means we've
 * received the search execution base but may still be waiting to mix in other
 * search results.
 *
 * A search request is made of two RPC calls: `searchByKeywords()` and
 * `searchBySemantics()`. Our RPC client will end up batching these requests
 * but they're returned separately. `searchByKeywords()` forms the base of our
 * search results. Then semantic search results from `searchBySemantics()` are
 * mixed in on top. We expect semantic search to take longer than keyword
 * search since we both need to embed the query then search in vector space. So
 * we present keyword search results to the user as soon as we have them then
 * mix in semantic search results once we get them.
 */
export function executeSearch(
    context: AppContext,
    {
        spaceId,
        queryText,
        limit,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
    },
): Store<ExecuteSearchResult> {
    // If the query is empty then return no search results.
    if (queryText.length === 0) return new ConstStore(emptyExecuteSearchResult);

    const keywordSearchPromise = searchByKeywords(context, {
        spaceId,
        queryText,
        limit,
    });

    const semanticSearchPromise = searchBySemantics(context, {
        spaceId,
        queryText,
        limit: semanticSearchResultLimit,
    });

    const keywordSearchStore = createPromiseStore(keywordSearchPromise);
    const semanticSearchStore = createPromiseStore(semanticSearchPromise);

    return Store.map(
        keywordSearchStore,
        semanticSearchStore,
        (keywordSearchState, semanticSearchState): ExecuteSearchResult => {
            if (keywordSearchState.status === "pending") return pendingExecuteSearchResult;

            if (keywordSearchState.status === "rejected") {
                return {
                    isPending: false,
                    isError: true,
                    error: keywordSearchState.reason,
                    results: null,
                };
            }

            if (semanticSearchState.status === "rejected") {
                return {
                    isPending: false,
                    isError: true,
                    error: semanticSearchState.reason,
                    results: null,
                };
            }

            return {
                isPending: semanticSearchState.status === "pending",
                isError: false,
                results: keywordSearchState.value.results,
            };
        },
    );
}
