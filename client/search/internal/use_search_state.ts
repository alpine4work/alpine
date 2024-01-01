import {RefObject, useEffect, useMemo, useReducer} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {
    ExecuteSearchOutput,
    emptyExecuteSearchOutput,
    executeSearch,
    pendingExecuteSearchOutput,
} from "~/client/search/internal/execute_search.js";
import {minSearchResultViewHeight} from "~/client/search/internal/search_result_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {convertRemLengthToPx} from "~/shared/design/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {addSumOperandToOpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchEntityIdOrSearchAffinityId} from "~/shared/search/search_entity_affinity_id.js";
import {SearchOptions, standardSearchOptions} from "~/shared/search/search_options.js";
import {SearchResult} from "~/shared/search/search_result.js";

/**
 * The debounce timeout before we'll send a new search request. Picked so that
 * >50% of typists will be done typing by the time this debounce fires.
 *
 * We expect that in a work context we generally have above average typists.
 * Also for search the user generally knows what they want to type or it's a
 * word they usually type which may make them faster. We may have some weird
 * intermediate results but that's accepted.
 */
const searchWordTypingDebounceMs = (() => {
    // This is p50 typing speed according to the distribution here:
    // https://humanbenchmark.com/tests/typing
    //
    // Percentile calculator here:
    // https://docs.google.com/spreadsheets/d/1_FiahHiNpEqFG7KrtRYOcKWRG8LYIcuHZWBAX2X4nFQ/edit?usp=sharing
    const wordsPerMinute = 44;

    const charactersPerMinute = wordsPerMinute * 5;
    const charactersPerSecond = charactersPerMinute / 60;
    const charactersPerMillisecond = charactersPerSecond / 1000;
    const millisecondsPerCharacter = 1 / charactersPerMillisecond;

    return Math.floor(millisecondsPerCharacter);
})();

type SearchState = {
    readonly queryText: string;
    readonly trimmedQueryText: string;
    readonly queryWords: ReadonlyArray<string>;
    readonly wordTypingTimeoutTime: number | null;
    readonly executionStack: SearchStateExecutionStack;
};

function getInitialSearchState(initialQueryText: string): SearchState {
    const initialTrimmedQueryText = initialQueryText.trim();
    const initialQueryWords = splitUnicodeDefaultWordBoundary(initialTrimmedQueryText);

    return {
        queryText: initialQueryText,
        trimmedQueryText: initialTrimmedQueryText,
        queryWords: initialQueryWords,
        wordTypingTimeoutTime: null,
        executionStack: createSearchStateExecutionStack([
            createSearchStateExecution(initialTrimmedQueryText),
        ]),
    };
}

type SearchAction =
    | {
          readonly type: "ChangeQueryText";
          readonly time: number;
          readonly queryText: string;
      }
    | {
          readonly type: "FireWordTypingTimeout";
      };

function reduceSearchState(state: SearchState, action: SearchAction): SearchState {
    switch (action.type) {
        case "ChangeQueryText": {
            const oldTrimmedQueryText = state.trimmedQueryText;
            const oldQueryWords = state.queryWords;

            const newQueryText = action.queryText;
            const newTrimmedQueryText = newQueryText.trim();
            const newQueryWords = splitUnicodeDefaultWordBoundary(newTrimmedQueryText);

            const isTypingNewLastWord =
                newQueryWords.length > 0 &&
                oldQueryWords.length === newQueryWords.length - 1 &&
                oldQueryWords.every((oldQueryWord, i) => oldQueryWord === newQueryWords[i]);

            let newExecutionStack: SearchStateExecutionStack;
            let newWordTypingTimeoutTime: number | null;

            // If the user deletes their query, we can immediately push a new execution
            // which should resolve synchronously.
            if (newTrimmedQueryText.length === 0) {
                newExecutionStack = state.executionStack.push(
                    createSearchStateExecution(newTrimmedQueryText),
                );
                newWordTypingTimeoutTime = null;
            }
            // If the user has started typing a new word at the end of the query then send
            // a search with the OLD text not including the start of their new word. We'll
            // send a query with their new word once they're done typing.
            //
            // This way we send intermediate searches to our server with completed words.
            // It makes the product feel responsive to see results as you type. But since
            // our search backend doesn't support prefix searches we can only search on
            // complete words.
            else if (
                isTypingNewLastWord &&
                // If we already have the data we'd search with an intermediate search request
                // then don't send a new request. This happens if you've typed a word, stopped,
                // the search has loaded, then type a new word.
                oldTrimmedQueryText !== state.executionStack.latestExecution.queryText
            ) {
                newExecutionStack = state.executionStack.push(
                    createSearchStateExecution(oldTrimmedQueryText),
                );
                newWordTypingTimeoutTime = action.time + searchWordTypingDebounceMs;
            }
            // For other edits, wait for a debounce timeout so we know the user is done
            // typing before sending a request to the server.
            else {
                newExecutionStack = state.executionStack;
                newWordTypingTimeoutTime = action.time + searchWordTypingDebounceMs;
            }

            return {
                ...state,
                queryText: newQueryText,
                trimmedQueryText: newTrimmedQueryText,
                queryWords: newQueryWords,
                wordTypingTimeoutTime: newWordTypingTimeoutTime,
                executionStack: newExecutionStack,
            };
        }
        case "FireWordTypingTimeout": {
            return {
                ...state,
                wordTypingTimeoutTime: null,
                executionStack: state.executionStack.push(
                    createSearchStateExecution(state.trimmedQueryText),
                ),
            };
        }
        default:
            throw exhaustive(action);
    }
}

const affinitiveSearchEntitiesLimit = 40;

/**
 * Preload affinitive search entities when we have some idle time so that they
 * are immediately available when the search modal opens.
 */
export function usePreloadSearchByAffinity() {
    const {space} = useSpaceContext();

    useIdlyPreloadRpc(searchByAffinity, {
        spaceId: space.id,
        limit: affinitiveSearchEntitiesLimit,
    });
}

/**
 * Manage state for our search experience.
 *
 * - Loads affinitive search results
 * - Runs, debounced, search queries whenever the query text changes
 * - Maintains the old search result while waiting on new results
 */
export function useSearchState({
    initialQueryText,
    resultListContainerRef,
    debugOptions,
}: {
    initialQueryText: string;
    resultListContainerRef: RefObject<HTMLDivElement>;
    debugOptions: SearchOptions | null;
}): {
    output: ExecuteSearchOutput & {readonly key: string};
    queryText: string;
    onQueryTextChange: (queryText: string) => void;
} {
    const context = useAppContext();
    const {space} = useSpaceContext();

    const options = debugOptions ?? standardSearchOptions;

    const affinityOutput = useLazyLoadRpc(searchByAffinity, {
        spaceId: space.id,
        limit: affinitiveSearchEntitiesLimit,
    });

    const affinityResultByEntityId = useMemo(() => {
        const affinityResultByEntityId = new Map<SearchEntityIdOrSearchAffinityId, SearchResult>();

        for (const result of affinityOutput.output?.results ?? []) {
            affinityResultByEntityId.set(result.entityId, result);
        }

        return affinityResultByEntityId;
    }, [affinityOutput.output?.results]);

    const [searchState, dispatch] = useReducer(
        reduceSearchState,
        initialQueryText,
        getInitialSearchState,
    );

    useEffect(() => {
        const resultListContainerElement = assertExists(resultListContainerRef.current);

        // Load enough items to fill the virtualization window once. This gives the
        // user some space to scroll and read before we need to load more messages.
        //
        // If the user did a jump scroll then we load 50% more messages so we have some
        // buffer above and below the virtualization window.
        const limit = Math.max(
            20,
            Math.ceil(
                getVirtualizationWindowHeight(resultListContainerElement.clientHeight) /
                    convertRemLengthToPx(minSearchResultViewHeight, getRemPxWithoutListening()),
            ),
        );

        searchState.executionStack.latestExecution.execute(context, {
            spaceId: space.id,
            limit,
            debugOptions,
        });
    }, [
        context,
        debugOptions,
        resultListContainerRef,
        searchState.executionStack.latestExecution,
        space.id,
    ]);

    useEffect(() => {
        if (searchState.wordTypingTimeoutTime === null) return;

        const timeout = createTimeout(() => {
            dispatch({type: "FireWordTypingTimeout"});
        }, searchState.wordTypingTimeoutTime - Date.now());

        return () => timeout.clear();
    }, [searchState.wordTypingTimeoutTime]);

    const queryOutput = useStore(searchState.executionStack);

    const output = useMemo((): SearchStateExecutionOutput => {
        // If we have an empty query returning no results from our search execution
        // stack then show search entities the account has some affinity for.
        if (
            queryOutput.queryText.length === 0 &&
            !queryOutput.isError &&
            (!queryOutput.results || queryOutput.results.length === 0)
        ) {
            if (!affinityOutput.output) {
                return {
                    key: "searchByAffinity",
                    queryText: queryOutput.queryText,
                    isPending: true,
                    isError: false,
                    results: null,
                };
            } else {
                return {
                    key: "searchByAffinity",
                    queryText: queryOutput.queryText,
                    isPending:
                        affinityOutput.isLoading ||
                        affinityOutput.isValidating ||
                        queryOutput.isPending,
                    isError: false,
                    results: affinityOutput.output.results,
                };
            }
        }
        // If some search results match affinitive search entities we loaded then we
        // want to boost the search entities the user has an affinity for since it's
        // more likely the user cares about those entities.
        else if (queryOutput.results && affinityResultByEntityId.size > 0) {
            const interpolation = options.affinityToKeywordScoreInterpolation;

            const slope =
                (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
                (interpolation.point2.affinityScore - interpolation.point1.affinityScore);

            const intercept =
                interpolation.point2.keywordScore - slope * interpolation.point2.affinityScore;

            let newResults: Array<SearchResult> | null = null;

            for (let i = 0; i < queryOutput.results.length; i++) {
                const result = queryOutput.results[i]!;

                const affinityResult = affinityResultByEntityId.get(result.entityId);
                if (!affinityResult) {
                    newResults?.push(result);
                    continue;
                }

                // Initialize the `newResults` array since we'll need to reorder search
                // results.
                newResults ??= queryOutput.results.slice(0, i);

                const additionalScore = slope * affinityResult.score + intercept;

                newResults.push({
                    ...result,
                    score: result.score + additionalScore,
                    explanation: result.explanation
                        ? addSumOperandToOpensearchSearchHitExplanation(result.explanation, {
                              value: additionalScore,
                              description: `✨ interpolated affinity score, computed as (m * x) + b from:`,
                              details: [
                                  {
                                      value: affinityResult.score,
                                      description: "x, affinity score",
                                      details: [],
                                  },
                                  {
                                      value: slope,
                                      description: "m, slope",
                                      details: [],
                                  },
                                  {
                                      value: intercept,
                                      description: "b, intercept",
                                      details: [],
                                  },
                              ],
                          })
                        : undefined,
                });
            }

            if (!newResults) return queryOutput;

            newResults.sort((result1, result2) => result2.score - result1.score);
            return {...queryOutput, results: newResults};
        } else {
            return queryOutput;
        }
    }, [
        queryOutput,
        affinityResultByEntityId,
        affinityOutput.output,
        affinityOutput.isLoading,
        affinityOutput.isValidating,
        options.affinityToKeywordScoreInterpolation,
    ]);

    return {
        output,
        queryText: searchState.queryText,
        onQueryTextChange: (queryText: string) =>
            dispatch({type: "ChangeQueryText", time: Date.now(), queryText}),
    };
}

/**
 * An execution is the store result from an `executeSearch()` but we only
 * actually send network requests once the `execute()` function is called.
 * That way you can store an execution in state but perform the network request
 * side effects in a `useEffect()`.
 *
 * The `execute()` function is idempotent. You can call it multiple times and
 * it only sends network requests once.
 */
type SearchStateExecution = Store<SearchStateExecutionOutput> & {
    readonly queryText: string;
    execute(
        context: AppContext,
        options: {spaceId: SpaceId; limit: number; debugOptions: SearchOptions | null},
    ): void;
};

type SearchStateExecutionOutput = ExecuteSearchOutput & {
    readonly key: string;
    readonly queryText: string;
};

function createSearchStateExecution(queryText: string): SearchStateExecution {
    const key = generateId();

    // If the query text is empty, we don't have to wait for lazy execution to know
    // we'll get an empty result.
    if (queryText.length === 0) {
        return Object.assign(
            new ConstStore({
                ...emptyExecuteSearchOutput,
                key,
                queryText,
            }),
            {
                queryText,
                execute: () => {},
            },
        );
    }

    let lastExecution: {
        debugOptions: SearchOptions | null;
    } | null = null;

    const execute = (
        context: AppContext,
        {
            spaceId,
            limit,
            debugOptions,
        }: {
            spaceId: SpaceId;
            limit: number;
            debugOptions: SearchOptions | null;
        },
    ) => {
        if (lastExecution === null) {
            lastExecution = {debugOptions};

            store.set(
                executeSearch(context, {
                    spaceId,
                    queryText,
                    limit,
                    debugOptions,
                }),
            );
        }
        // If debug options changed, we'll re-execute. We need to keep the last results
        // around since once an execution has non-null `results` it should never return
        // null `results` again.
        else if (!isDeepEqual(lastExecution.debugOptions, debugOptions)) {
            lastExecution = {debugOptions};

            store.set(lastStore => {
                const nextStore = executeSearch(context, {
                    spaceId,
                    queryText,
                    limit,
                    debugOptions,
                });

                return Store.map(lastStore, nextStore, (lastResult, nextResult) => {
                    if (nextResult.results === null) return {...lastResult, isPending: true};
                    return nextResult;
                });
            });
        }
    };

    const store = new ValueStore<Store<ExecuteSearchOutput>>(
        new ConstStore(pendingExecuteSearchOutput),
    );

    return Object.assign(
        store.flat().map(result => ({
            ...result,
            key,
            queryText,
        })),
        {
            queryText,
            execute,
        },
    );
}

/**
 * The execution stack is a history of search executions in the current
 * search session. We maintain a history so that as a user types a new search
 * query we can show them results from a previous query before switching to
 * new results.
 *
 * Examples: if a user searches "documents by caleb" and we search "documents"
 * then "documents by" then "documents by caleb" we want to show the results
 * from "documents" then "documents by" in that order while we wait for the
 * final results for "documents by caleb".
 *
 * The store returns the result of the latest execution in the stack with
 * search results. The `push()` function immutably creates a new stack.
 */
type SearchStateExecutionStack = Store<SearchStateExecutionOutput> & {
    readonly latestExecution: SearchStateExecution;
    push(execution: SearchStateExecution): SearchStateExecutionStack;
};

function createSearchStateExecutionStack(
    stack: ReadonlyArray<SearchStateExecution>,
): SearchStateExecutionStack {
    assert(stack.length > 0, "Stack should be non-empty");
    const latestExecution = stack[stack.length - 1]!;

    const push = (execution: SearchStateExecution): SearchStateExecutionStack => {
        return createSearchStateExecutionStack([...stack, execution]);
    };

    const store = computeStore((get): SearchStateExecutionOutput => {
        for (let i = stack.length - 1; i >= 0; i--) {
            const execution = stack[i]!;

            const result = get(execution);

            if (!result.isPending || result.results) {
                const isLastExecution = i === stack.length - 1;

                // We only care about the latest execution with results. Throw away all earlier
                // executions so they can be garbage collected. We will never need to use them
                // again. Once an execution is not pending, it will never enter a pending state
                // again.
                stack = stack.slice(i);

                if (isLastExecution) {
                    return result;
                } else {
                    // If this is not our last execution, then we're loading a newer execution. So
                    // make sure to return a pending result.
                    return !result.isPending ? {...result, isPending: true} : result;
                }
            }

            if (i === 0) return result;
        }

        throw new InternalError("Stack should be non-empty");
    });

    return Object.assign(store, {latestExecution, push});
}
