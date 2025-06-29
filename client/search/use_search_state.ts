import {Memo, useCallback, useEffect, useMemo, useReducer, useRef} from "react";
import {useSearchParams} from "react-router-dom";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {useStore} from "~/client/helpers/use_store.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {
    ExecuteSearchOutput,
    executeSearch,
    pendingExecuteSearchOutput,
} from "~/client/search/internal/execute_search.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {addSumOperandToOpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchEntityId, SearchStaticEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
    SearchFavoriteEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {SearchOptions, standardSearchOptions} from "~/shared/search/search_options.js";
import {searchStaticEntityIndex} from "~/shared/search/search_static_entity.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

const searchWordTypingDebounceMs = {
    /**
     * The debounce timeout before we'll send a new search request. Picked so that
     * >50% of typists will be done typing by the time this debounce fires.
     *
     * We expect that in a work context we generally have above average typists.
     * Also for search the user generally knows what they want to type or it's a
     * word they usually type which may make them faster. We may have some weird
     * intermediate results but that's accepted.
     */
    desktop: (() => {
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
    })(),

    /**
     * The debounce timeout before we'll send a new search request for mobile.
     * Picked so that >50% of typists will be done typing by the time this debounce
     * fires. Slower than `searchWordTypingDebounceMs.desktop` since the average
     * typing speed on mobile devices is slower than on desktop devices.
     */
    mobile: (() => {
        // This is average typing speed according to:
        // https://wordsrated.com/typing-speed-statistics/
        const wordsPerMinute = 38;

        const charactersPerMinute = wordsPerMinute * 5;
        const charactersPerSecond = charactersPerMinute / 60;
        const charactersPerMillisecond = charactersPerSecond / 1000;
        const millisecondsPerCharacter = 1 / charactersPerMillisecond;

        return Math.floor(millisecondsPerCharacter);
    })(),
};

type SearchState = {
    readonly queryText: string;
    readonly trimmedQueryText: string;
    readonly updatingSearchParams: URLSearchParams | null;
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
        updatingSearchParams: null,
        queryWords: initialQueryWords,
        wordTypingTimeoutTime: null,
        executionStack: createSearchStateExecutionStack([
            createSearchStateExecution({
                queryText: initialTrimmedQueryText,
                queryTime: new Date(),
            }),
        ]),
    };
}

type SearchAction =
    | {
          readonly type: "ChangeQueryText";
          readonly time: Date;
          readonly queryText: string;
          readonly updatingSearchParams: URLSearchParams | null;
          readonly wordTypingDebounceMs: number;
      }
    | {
          readonly type: "FireWordTypingTimeout";
          readonly time: Date;
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
                    createSearchStateExecution({
                        queryText: newTrimmedQueryText,
                        queryTime: action.time,
                    }),
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
                    createSearchStateExecution({
                        queryText: oldTrimmedQueryText,
                        queryTime: action.time,
                    }),
                );
                newWordTypingTimeoutTime = action.time.getTime() + action.wordTypingDebounceMs;
            }
            // For other edits, wait for a debounce timeout so we know the user is done
            // typing before sending a request to the server.
            else {
                newExecutionStack = state.executionStack;
                newWordTypingTimeoutTime = action.time.getTime() + action.wordTypingDebounceMs;
            }

            return {
                ...state,
                queryText: newQueryText,
                trimmedQueryText: newTrimmedQueryText,
                updatingSearchParams: action.updatingSearchParams,
                queryWords: newQueryWords,
                wordTypingTimeoutTime: newWordTypingTimeoutTime,
                executionStack: newExecutionStack,
            };
        }
        case "FireWordTypingTimeout": {
            return {
                ...state,
                wordTypingTimeoutTime: null,
                executionStack:
                    state.executionStack.latestExecution.queryText !== state.trimmedQueryText
                        ? state.executionStack.push(
                              createSearchStateExecution({
                                  queryText: state.trimmedQueryText,
                                  queryTime: action.time,
                              }),
                          )
                        : state.executionStack,
            };
        }
        default:
            throw exhaustive(action);
    }
}

/**
 * Preload affinitive search entities when we have some idle time so that they
 * are immediately available when the search modal opens.
 */
export function usePreloadSearchByAffinity() {
    const {space} = useSpaceContext();

    useIdlyPreloadRpc(searchByAffinity, {spaceId: space.id});
}

/**
 * Manage state for our search experience.
 *
 * - Loads affinitive search results
 * - Runs, debounced, search queries whenever the query text changes
 * - Maintains the old search result while waiting on new results
 */
export function useSearchState({
    isSearchParamControlled,
    debugOptions,
    initialAffinitySearch,
}: {
    isSearchParamControlled: boolean;
    debugOptions: SearchOptions | null;
    initialAffinitySearch?: RpcDefinitionOutputType<typeof searchByAffinity>;
}): {
    output: SearchStateExecutionOutput;
    queryText: string;
    onQueryTextChange: Memo<(queryText: string) => void>;
} {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const platform = usePlatform();

    const [searchParams, setSearchParams] = useSearchParams();
    const searchParamsRef = useRef(searchParams);
    const queryTextFromSearchParams = searchParams.get("search") ?? "";

    useEffect(() => {
        searchParamsRef.current = searchParams;
    }, [searchParams]);

    const options = debugOptions ?? standardSearchOptions;

    const affinitySearch = useLazyLoadRpc(
        searchByAffinity,
        {spaceId: space.id},
        {initialOutput: initialAffinitySearch},
    );

    const affinityResultById = useMemo(() => {
        const affinityResultById = new Map<SearchEntityId, SearchAffinityEntityResultModel>();

        for (const result of affinitySearch.output?.favoriteResults ?? []) {
            affinityResultById.set(result.id, result);
        }

        for (const result of affinitySearch.output?.results ?? []) {
            affinityResultById.set(result.id, result);
        }

        return affinityResultById;
    }, [affinitySearch.output?.favoriteResults, affinitySearch.output?.results]);

    const [searchState, dispatch] = useReducer(
        reduceSearchState,
        queryTextFromSearchParams,
        getInitialSearchState,
    );

    // When the search param changes we need to update our search state.
    if (
        isSearchParamControlled &&
        searchState.queryText !== queryTextFromSearchParams &&
        // Remix updates `searchParams` asynchronously. So we don't want to reset
        // `searchState.queryText` after `searchState.queryText` has been updated but
        // before `queryTextFromSearchParams` has been updated.
        searchState.updatingSearchParams !== searchParams
    ) {
        dispatch({
            type: "ChangeQueryText",
            time: new Date(),
            queryText: queryTextFromSearchParams,
            updatingSearchParams: null,
            wordTypingDebounceMs: searchWordTypingDebounceMs[platform],
        });
    }

    useEffect(() => {
        searchState.executionStack.latestExecution.execute(context, {
            spaceId: space.id,
            debugOptions,
            isTyping: searchState.wordTypingTimeoutTime !== null,
        });
    }, [
        context,
        debugOptions,
        searchState.executionStack.latestExecution,
        searchState.wordTypingTimeoutTime,
        space.id,
    ]);

    useEffect(() => {
        if (searchState.wordTypingTimeoutTime === null) return;

        const timeout = createTimeout(() => {
            dispatch({type: "FireWordTypingTimeout", time: new Date()});
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
            if (!affinitySearch.output) {
                return {
                    type: "EmptyQuery",
                    key: "searchByAffinity",
                    queryText: "",
                    queryTime: queryOutput.queryTime,
                    isPending: true,
                    isError: false,
                    hasMoreFavoriteResults: false,
                    favoriteResults: null,
                    results: null,
                };
            } else {
                return {
                    type: "EmptyQuery",
                    key: "searchByAffinity",
                    queryText: "",
                    queryTime: queryOutput.queryTime,
                    isPending:
                        affinitySearch.isLoading ||
                        affinitySearch.isValidating ||
                        queryOutput.isPending,
                    isError: false,
                    hasMoreFavoriteResults: affinitySearch.output.hasMoreFavoriteResults,
                    favoriteResults: affinitySearch.output.favoriteResults,
                    results: affinitySearch.output.results,
                };
            }
        } else if (
            queryOutput.type === "Query" &&
            queryOutput.results &&
            affinityResultById.size > 0
        ) {
            const interpolation = options.affinityToKeywordScoreInterpolation;

            const slope =
                (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
                (interpolation.point2.affinityScore - interpolation.point1.affinityScore);

            const intercept =
                interpolation.point2.keywordScore - slope * interpolation.point2.affinityScore;

            let newResults: Array<SearchEntityResultModel> | null = null;

            // Search for commands matching the query text and add them to the beginning of
            // our results list if so.
            const staticEntityIds = new Set<SearchStaticEntityId>();
            const staticEntityMatches = searchStaticEntityIndex.get().search(queryOutput.queryText);
            for (const match of staticEntityMatches) {
                if (staticEntityIds.has(match.item.entityId)) continue;
                staticEntityIds.add(match.item.entityId);

                newResults ??= [];

                // Only count close matches. Exclude search results with too high a score. This
                // cutoff was picked so typing "Create t" doesn't match "Create chat" and
                // "Create a" doesn't match "Create task". But "Create tsk" matches
                // "Create task".
                if (match.score! < 0.2) {
                    newResults.push(
                        new SearchEntityResultModel({
                            model: new SearchEntityModel({
                                id: match.item.entityId,
                                title: match.item.entity.title,
                                titleVersion: null,
                                media: match.item.entity.media ?? null,
                            }),
                            score: Infinity,
                            bodyTextSnippet: [],
                        }),
                    );
                }
            }

            // If some search results match affinitive search entities we loaded then we
            // want to boost the search entities the user has an affinity for since it's
            // more likely the user cares about those entities.
            for (let i = 0; i < queryOutput.results.length; i++) {
                const result = queryOutput.results[i]!;

                const affinityResult = affinityResultById.get(result.id);
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
                              // `\u2764\uFE0F` is the red heart emoji. It needs two Unicode
                              // code points to render correctly.
                              description: `\u2764\uFE0F interpolated affinity score, computed as (m * x) + b from:`,
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
        affinityResultById,
        affinitySearch.output,
        affinitySearch.isLoading,
        affinitySearch.isValidating,
        options.affinityToKeywordScoreInterpolation,
    ]);

    return {
        output,
        queryText: searchState.queryText,
        onQueryTextChange: useCallback(
            (queryText: string) => {
                dispatch({
                    type: "ChangeQueryText",
                    time: new Date(),
                    queryText,
                    updatingSearchParams: isSearchParamControlled ? searchParamsRef.current : null,
                    wordTypingDebounceMs: searchWordTypingDebounceMs[platform],
                });

                if (isSearchParamControlled) {
                    setSearchParams(
                        oldSearchParams => {
                            if (oldSearchParams.get("search") === queryText) return oldSearchParams;

                            const newSearchParams = new URLSearchParams(oldSearchParams);
                            newSearchParams.set("search", queryText);
                            return newSearchParams;
                        },
                        {
                            replace: true,
                            // Don't revalidate when updating search params from here. We can't use the
                            // stable `shouldRevalidate` route function because we want ALL rendered routes
                            // to skip revalidation. And updating all rendered routes `shouldRevalidate`
                            // function to ignore `search` is too much of a burden.
                            unstable_shouldRevalidate: false,
                        },
                    );
                }
            },
            [isSearchParamControlled, platform, setSearchParams],
        ),
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
    readonly queryTime: Date;
    execute(
        context: AppContext,
        options: {
            spaceId: SpaceId;
            debugOptions: SearchOptions | null;
            isTyping: boolean;
        },
    ): void;
};

type ExecuteSearchByAffinityOutput =
    | {
          readonly isPending: true;
          readonly isError: false;
          readonly hasMoreFavoriteResults: false;
          readonly favoriteResults: null;
          readonly results: null;
      }
    | {
          readonly isPending: boolean;
          readonly isError: true;
          readonly error: unknown;
          readonly hasMoreFavoriteResults: false;
          readonly favoriteResults: null;
          readonly results: null;
      }
    | {
          readonly isPending: boolean;
          readonly isError: false;
          readonly hasMoreFavoriteResults: boolean;
          readonly favoriteResults: ReadonlyArray<SearchFavoriteEntityResultModel>;
          readonly results: ReadonlyArray<SearchAffinityEntityResultModel>;
      };

export type SearchStateExecutionOutput =
    | (ExecuteSearchByAffinityOutput & {
          readonly type: "EmptyQuery";
          readonly key: string;
          readonly queryText: "";
          readonly queryTime: Date;
      })
    | (ExecuteSearchOutput & {
          readonly type: "Query";
          readonly key: string;
          readonly queryText: string;
          readonly queryTime: Date;
      });

function createSearchStateExecution({
    queryText,
    queryTime,
}: {
    queryText: string;
    queryTime: Date;
}): SearchStateExecution {
    const key = generateId();

    // If the query text is empty, we don't have to wait for lazy execution to know
    // we'll get an empty result.
    if (queryText.length === 0) {
        return Object.assign(
            new ConstStore<SearchStateExecutionOutput>({
                type: "EmptyQuery",
                key,
                queryText: "",
                queryTime,
                isPending: false,
                isError: false,
                hasMoreFavoriteResults: false,
                favoriteResults: emptyArray,
                results: emptyArray,
            }),
            {
                queryText,
                queryTime,
                execute: () => {},
                pauseExecute: () => {},
            },
        );
    }

    let lastExecution: {
        debugOptions: SearchOptions | null;
    } | null = null;

    const store = new ValueStore<
        Store<ExecuteSearchOutput> & {
            executeSearchBySemantics?: () => void;
        }
    >(new ConstStore(pendingExecuteSearchOutput));

    const execute = (
        context: AppContext,
        {
            spaceId,
            debugOptions,
            isTyping,
        }: {
            spaceId: SpaceId;
            debugOptions: SearchOptions | null;
            isTyping: boolean;
        },
    ) => {
        if (lastExecution === null) {
            lastExecution = {debugOptions};

            const nextStore = executeSearch(context, {
                spaceId,
                queryText,
                debugOptions,
            });

            // If the user is actively typing, we want to delay sending
            // `searchBySemantics()` until we have the final query. That way we reduce cost
            // by avoiding executing semantic search on meaningless intermediate queries.
            if (!isTyping) nextStore.executeSearchBySemantics();

            store.set(nextStore);
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
                    debugOptions,
                });

                // Don't bother trying to debounce semantic search in debug mode.
                nextStore.executeSearchBySemantics();

                return Store.map(lastStore, nextStore, (lastResult, nextResult) => {
                    if (nextResult.isPending) return {...lastResult, isPending: true};
                    return nextResult;
                });
            });
        } else if (!isTyping) {
            // Once the user is done typing, we need to call `executeSearchBySemantics()`
            // if we haven't already.
            store.getSnapshot().executeSearchBySemantics?.();
        }
    };

    return Object.assign(
        store.flat().map(
            (result): SearchStateExecutionOutput => ({
                ...result,
                type: "Query",
                key,
                queryText,
                queryTime,
            }),
        ),
        {
            queryText,
            queryTime,
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
