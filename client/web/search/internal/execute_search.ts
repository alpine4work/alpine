import {AppContext} from "~/client/web/context/app_context.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {pendingPromiseState} from "~/shared/helpers/async/promise_state.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {searchByKeywords, searchBySemantics} from "~/shared/rpc/search_rpc_definitions.js";
import {mergeKeywordAndSemanticSearchResults} from "~/shared/search/merge_keyword_and_semantic_search_results.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {SearchOptions, standardSearchOptions} from "~/shared/search/search_options.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {createPromiseStore} from "~/shared/store/promise_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * The maximum number of keyword search results we look for. These search results
 * form the base of the list we present to the user. We mix semantic search results
 * on top and boost any results the user has an affinity for.
 *
 * Keyword search also performs natural language parsing on the query and searches
 * with any filters parsed from the user's query.
 */
// TODO(calebmer): Should consider implementing keyword search result infinite
// loading someday. Not implementing now since I ran out of time in the cycle.
const searchByKeywordLimit = 30;

/**
 * The maximum number of semantic search results we look for. These search results
 * are mixed with our keyword search results. Semantic search results can be
 * expensive to compute so we don't load too many.
 *
 * Picked 14 since it's two times 7 which is a lucky number. Working with leading
 * AI models requires a bit of superstition.
 *
 * When paginating, we only load more keyword search results. Not new semantic
 * search results.
 */
const searchBySemanticsLimit = 14;

export type ExecuteSearchOutput =
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
          readonly results: ReadonlyArray<SearchEntityResultModel>;
      };

/**
 * Constant pending output `executeSearch()` returns while it's loading.
 */
export const pendingExecuteSearchOutput: ExecuteSearchOutput = {
    isPending: true,
    isError: false,
    results: null,
};

/**
 * Constant output `executeSearch()` returns when it receives an empty search
 * query.
 */
export const emptyExecuteSearchOutput: ExecuteSearchOutput = {
    isPending: false,
    isError: false,
    results: emptyArray,
};

/**
 * Execute a search request. Instead of returning a `Promise` we return a `Store`
 * since our search output may change a few times before it stabilizes.
 *
 * Returning `null` for `results` means we've loaded no search results yet. We may
 * return `isPending: true` when `results` is non-null. This means we've received
 * the search execution base but may still be waiting to mix in other search
 * results.
 *
 * A search request is made of two RPC calls: `searchByKeywords()` and
 * `searchBySemantics()`. Our RPC client will end up batching these requests but
 * they're returned separately. `searchByKeywords()` forms the base of our search
 * results. Then semantic search results from `searchBySemantics()` are mixed in on
 * top. We expect semantic search to take longer than keyword search since we both
 * need to embed the query then search in vector space. So we present keyword
 * search results to the user as soon as we have them then mix in semantic search
 * results once we get them.
 *
 * You control when `searchBySemantics()` is called. You must call
 * `executeSearchBySemantics()` at some point otherwise this function will return a
 * pending store forever. This capability is provided so we can delay calling
 * `executeSearchBySemantics()` while the user is actively typing.
 */
export function executeSearch(
    context: AppContext,
    {
        spaceId,
        queryText,
        debugOptions,
    }: {
        spaceId: SpaceId;
        queryText: string;
        debugOptions: SearchOptions | null;
    },
): Store<ExecuteSearchOutput> & {
    executeSearchBySemantics(): void;
} {
    // If the query is empty then return no search results.
    if (queryText.length === 0) {
        return Object.assign(new ConstStore(emptyExecuteSearchOutput), {
            executeSearchBySemantics: () => {},
        });
    }

    const options = debugOptions ?? standardSearchOptions;

    const timeZone = getClientInfo().timeZone;
    const currentTime = new Date();

    const keywordSearchPromise = searchByKeywords(context, {
        spaceId,
        queryText,
        limit: searchByKeywordLimit,
        timeZone,
        currentTime,
        debugOptions: debugOptions ?? undefined,
    });

    const semanticSearchPromiseStore = new ValueStore<ReturnType<typeof searchBySemantics> | null>(
        null,
    );

    const executeSearchBySemantics = () => {
        if (semanticSearchPromiseStore.getSnapshot() !== null) return;

        semanticSearchPromiseStore.set(
            searchBySemantics(context, {
                spaceId,
                queryText,
                limit: searchBySemanticsLimit,
                timeZone,
                currentTime,
                debugOptions: debugOptions ?? undefined,
            }),
        );
    };

    const keywordSearchStore = createPromiseStore(keywordSearchPromise);
    const semanticSearchStore = semanticSearchPromiseStore.flatMap(semanticSearchPromise =>
        semanticSearchPromise
            ? createPromiseStore(semanticSearchPromise)
            : new ConstStore(pendingPromiseState),
    );

    const store = Store.map(
        keywordSearchStore,
        semanticSearchStore,
        (keywordSearchState, semanticSearchState): ExecuteSearchOutput => {
            if (keywordSearchState.status === "pending") return pendingExecuteSearchOutput;

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

            if (semanticSearchState.status === "pending") {
                return {
                    isPending: true,
                    isError: false,
                    results: keywordSearchState.value.results,
                };
            }

            // Now that we have both keyword search results and semantic search results, let's
            // merge them together...
            const newResults = mergeKeywordAndSemanticSearchResults({
                keywordSearchResults: keywordSearchState.value.results,
                semanticSearchResults: semanticSearchState.value.results,
                options,
                shouldDebug: !!debugOptions,
            });

            return {
                isPending: false,
                isError: false,
                results: newResults,
            };
        },
    );

    return Object.assign(store, {executeSearchBySemantics});
}
