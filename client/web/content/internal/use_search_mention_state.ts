// This file is a fork of `useSearchState()`. We decided to fork the
// `useSearchState()` file instead of creating a shared abstraction under the
// guidance of our style guide which says: "No abstraction is better than the wrong
// abstraction".
//
// IMPORTANT: If you make an update to this file, you also may want to make that
// update in `useSearchState()`.
//
// It's hard to find the reusable abstraction between `useSearchState()` and
// `useSearchMentionState()`. While they look broadly similar they have subtly
// different behaviors which are hard to express. For example,
// `useSearchState()`: 1) searches `SearchStaticEntityId`s and 2) calls
// `searchBySemantics()` and asynchronously merges those results in. Whereas
// `useSearchMentionState()` calls `searchByAffinity()` like `useSearchState()` but
// unlike `useSearchState()` it filters out non-mentionable entities and merges
// favorites back into the result list.

import {Memo, useCallback, useEffect, useMemo, useReducer} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {AppContext, useAppContext} from "~/client/web/context/app_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {searchWordTypingDebounceMs} from "~/client/web/search/core/search_word_typing_debounce_ms.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity, searchMentionByKeywords} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchEntityId, isSearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchAffinityEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {standardSearchOptions} from "~/shared/search/search_options.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {createPromiseStore} from "~/shared/store/promise_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * The maximum number of mentions that `useSearchMentionState()` will return.
 */
const searchMentionLimit = 10;

type SearchMentionState = {
    readonly queryText: string;
    readonly trimmedQueryText: string;
    readonly queryWords: ReadonlyArray<string>;
    readonly wordTypingTimeoutTime: number | null;
    readonly executionStack: SearchMentionStateExecutionStack;
};

function getInitialSearchMentionState(initialQueryText: string): SearchMentionState {
    const initialTrimmedQueryText = initialQueryText.trim();
    const initialQueryWords = splitUnicodeDefaultWordBoundary(initialTrimmedQueryText);

    return {
        queryText: initialQueryText,
        trimmedQueryText: initialTrimmedQueryText,
        queryWords: initialQueryWords,
        wordTypingTimeoutTime: null,
        executionStack: createSearchMentionStateExecutionStack([
            createSearchMentionStateExecution({
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
          readonly wordTypingDebounceMs: number;
      }
    | {
          readonly type: "FireWordTypingTimeout";
          readonly time: Date;
      };

function reduceSearchMentionState(
    state: SearchMentionState,
    action: SearchAction,
): SearchMentionState {
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

            let newExecutionStack: SearchMentionStateExecutionStack;
            let newWordTypingTimeoutTime: number | null;

            // If the user deletes their query, we can immediately push a new execution which
            // should resolve synchronously.
            if (newTrimmedQueryText.length === 0) {
                newExecutionStack = state.executionStack.push(
                    createSearchMentionStateExecution({
                        queryText: newTrimmedQueryText,
                        queryTime: action.time,
                    }),
                );
                newWordTypingTimeoutTime = null;
            }
            // If the user has started typing a new word at the end of the query then send a
            // search with the OLD text not including the start of their new word. We'll send a
            // query with their new word once they're done typing.
            //
            // This way we send intermediate searches to our server with completed words. It
            // makes the product feel responsive to see results as you type. But since our
            // search backend doesn't support prefix searches we can only search on complete
            // words.
            else if (
                isTypingNewLastWord &&
                // If we already have the data we'd search with an intermediate search request then
                // don't send a new request. This happens if you've typed a word, stopped, the
                // search has loaded, then type a new word.
                oldTrimmedQueryText !== state.executionStack.latestExecution.queryText
            ) {
                newExecutionStack = state.executionStack.push(
                    createSearchMentionStateExecution({
                        queryText: oldTrimmedQueryText,
                        queryTime: action.time,
                    }),
                );
                newWordTypingTimeoutTime = action.time.getTime() + action.wordTypingDebounceMs;
            }
            // For other edits, wait for a debounce timeout so we know the user is done typing
            // before sending a request to the server.
            else {
                newExecutionStack = state.executionStack;
                newWordTypingTimeoutTime = action.time.getTime() + action.wordTypingDebounceMs;
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
                executionStack:
                    state.executionStack.latestExecution.queryText !== state.trimmedQueryText
                        ? state.executionStack.push(
                              createSearchMentionStateExecution({
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
 * Manage state for our mention search experience.
 *
 * - Loads affinitive search results
 * - Runs, debounced, search queries whenever the query text changes
 * - Maintains the old search result while waiting on new results
 */
export function useSearchMentionState({
    initialQueryText,
    initialAffinitySearch,
}: {
    initialQueryText?: string;
    initialAffinitySearch?: RpcDefinitionOutputType<typeof searchByAffinity>;
}): {
    output: SearchMentionStateExecutionOutput;
    queryText: string;
    onQueryTextChange: Memo<(queryText: string) => void>;
} {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const platform = usePlatform();

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

    const [state, dispatch] = useReducer(
        reduceSearchMentionState,
        initialQueryText ?? "",
        getInitialSearchMentionState,
    );

    useEffect(() => {
        state.executionStack.latestExecution.execute(context, {spaceId: space.id});
    }, [context, state.executionStack.latestExecution, state.wordTypingTimeoutTime, space.id]);

    useEffect(() => {
        if (state.wordTypingTimeoutTime === null) return;

        const timeout = createTimeout(() => {
            dispatch({type: "FireWordTypingTimeout", time: new Date()});
        }, state.wordTypingTimeoutTime - Date.now());

        return () => timeout.clear();
    }, [state.wordTypingTimeoutTime]);

    const queryOutput = useStore(state.executionStack);

    const output = useMemo((): SearchMentionStateExecutionOutput => {
        // If we have an empty query returning no results from our search execution stack
        // then show search entities the account has some affinity for.
        if (
            queryOutput.queryText.length === 0 &&
            !queryOutput.isError &&
            (!queryOutput.results || queryOutput.results.length === 0)
        ) {
            if (!affinitySearch.output) {
                return {
                    key: "searchByAffinity",
                    queryText: "",
                    queryTime: queryOutput.queryTime,
                    isPending: true,
                    isError: false,
                    results: null,
                };
            } else {
                // 1. Merge the `favoriteResults` and `results` array
                // 2. Filter out non-mentionable entities
                // 3. Only return entities up to the search mention limit
                const results = Array.from(
                    flatIterable(
                        [affinitySearch.output.favoriteResults, affinitySearch.output.results].map(
                            results =>
                                sliceIterable(
                                    filterMapIterable(results, result => {
                                        if (!isSearchMentionEntityId(result.id)) return;

                                        // Accounts can't be search mention entities. So we should never have an
                                        // `AccountModel` here if `isSearchMentionEntityId()` returns true.
                                        assert(!(result.model instanceof AccountModel));

                                        return {
                                            score: result.score,
                                            model: result.model,
                                        };
                                    }),
                                    0,
                                    searchMentionLimit,
                                ),
                        ),
                    ),
                )
                    .sort((result1, result2) => result2.score - result1.score)
                    .slice(0, searchMentionLimit);

                return {
                    key: "searchByAffinity",
                    queryText: "",
                    queryTime: queryOutput.queryTime,
                    isPending:
                        affinitySearch.isLoading ||
                        affinitySearch.isValidating ||
                        queryOutput.isPending,
                    isError: false,
                    results,
                };
            }
        } else if (queryOutput.results && affinityResultById.size > 0) {
            const interpolation = standardSearchOptions.affinityToKeywordScoreInterpolation;

            const slope =
                (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
                (interpolation.point2.affinityScore - interpolation.point1.affinityScore);

            const intercept =
                interpolation.point2.keywordScore - slope * interpolation.point2.affinityScore;

            let newResults: Array<{
                readonly score: number;
                readonly model: SearchEntityModel;
            }> | null = null;

            // If some search results match affinitive search entities we loaded then we want
            // to boost the search entities the user has an affinity for since it's more likely
            // the user cares about those entities.
            for (let i = 0; i < queryOutput.results.length; i++) {
                const result = queryOutput.results[i]!;

                const affinityResult = affinityResultById.get(result.model.id);
                if (!affinityResult) {
                    newResults?.push(result);
                    continue;
                }

                // Initialize the `newResults` array since we'll need to reorder search results.
                newResults ??= queryOutput.results.slice(0, i);

                const additionalScore = slope * affinityResult.score + intercept;

                newResults.push({
                    ...result,
                    score: result.score + additionalScore,
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
    ]);

    return {
        output,
        queryText: state.queryText,
        onQueryTextChange: useCallback(
            (queryText: string) => {
                dispatch({
                    type: "ChangeQueryText",
                    time: new Date(),
                    queryText,
                    wordTypingDebounceMs: searchWordTypingDebounceMs[platform],
                });
            },
            [platform],
        ),
    };
}

/**
 * An execution is the store result from an `executeSearch()` but we only actually
 * send network requests once the `execute()` function is called. That way you can
 * store an execution in state but perform the network request side effects in a
 * `useEffect()`.
 *
 * The `execute()` function is idempotent. You can call it multiple times and it
 * only sends network requests once.
 */
type SearchMentionStateExecution = Store<SearchMentionStateExecutionOutput> & {
    readonly queryText: string;
    readonly queryTime: Date;
    execute(context: AppContext, options: {spaceId: SpaceId}): void;
};

type ExecuteMentionSearchOutput =
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
          readonly results: ReadonlyArray<{
              readonly score: number;
              readonly model: SearchEntityModel;
          }>;
      };

const pendingExecuteMentionSearchOutput: ExecuteMentionSearchOutput = {
    isPending: true,
    isError: false,
    results: null,
};

export type SearchMentionStateExecutionOutput = ExecuteMentionSearchOutput & {
    readonly key: string;
    readonly queryText: string;
    readonly queryTime: Date;
};

function createSearchMentionStateExecution({
    queryText,
    queryTime,
}: {
    queryText: string;
    queryTime: Date;
}): SearchMentionStateExecution {
    const key = generateId();

    // If the query text is empty, we don't have to wait for lazy execution to know
    // we'll get an empty result.
    if (queryText.length === 0) {
        return Object.assign(
            new ConstStore<SearchMentionStateExecutionOutput>({
                key,
                queryText: "",
                queryTime,
                isPending: false,
                isError: false,
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

    let hasExecuted = false;

    const store = new ValueStore<Store<ExecuteMentionSearchOutput>>(
        new ConstStore(pendingExecuteMentionSearchOutput),
    );

    const execute = (context: AppContext, {spaceId}: {spaceId: SpaceId}) => {
        const actuallyExecute = () =>
            createPromiseStore(
                searchMentionByKeywords(context, {
                    spaceId,
                    queryText,
                    limit: searchMentionLimit,
                }),
            ).map((output): ExecuteMentionSearchOutput => {
                switch (output.status) {
                    case "pending": {
                        return pendingExecuteMentionSearchOutput;
                    }
                    case "rejected": {
                        return {
                            isPending: false,
                            isError: true,
                            error: output.reason,
                            results: null,
                        };
                    }
                    case "fulfilled": {
                        return {
                            isPending: false,
                            isError: false,
                            results: output.value.results,
                        };
                    }
                    default:
                        throw exhaustive(output);
                }
            });

        if (!hasExecuted) {
            hasExecuted = true;
            store.set(actuallyExecute());
        }
    };

    return Object.assign(
        store.flat().map(
            (result): SearchMentionStateExecutionOutput => ({
                ...result,
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
 * The execution stack is a history of search executions in the current search
 * session. We maintain a history so that as a user types a new search query we can
 * show them results from a previous query before switching to new results.
 *
 * Examples: if a user searches "documents by caleb" and we search "documents" then
 * "documents by" then "documents by caleb" we want to show the results from
 * "documents" then "documents by" in that order while we wait for the final
 * results for "documents by caleb".
 *
 * The store returns the result of the latest execution in the stack with search
 * results. The `push()` function immutably creates a new stack.
 */
type SearchMentionStateExecutionStack = Store<SearchMentionStateExecutionOutput> & {
    readonly latestExecution: SearchMentionStateExecution;
    push(execution: SearchMentionStateExecution): SearchMentionStateExecutionStack;
};

function createSearchMentionStateExecutionStack(
    stack: ReadonlyArray<SearchMentionStateExecution>,
): SearchMentionStateExecutionStack {
    assert(stack.length > 0, "Stack should be non-empty");
    const latestExecution = stack[stack.length - 1]!;

    const push = (execution: SearchMentionStateExecution): SearchMentionStateExecutionStack => {
        return createSearchMentionStateExecutionStack([...stack, execution]);
    };

    const store = computeStore((get): SearchMentionStateExecutionOutput => {
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
                    // If this is not our last execution, then we're loading a newer execution. So make
                    // sure to return a pending result.
                    return !result.isPending ? {...result, isPending: true} : result;
                }
            }

            if (i === 0) return result;
        }

        throw new InternalError("Stack should be non-empty");
    });

    return Object.assign(store, {latestExecution, push});
}
