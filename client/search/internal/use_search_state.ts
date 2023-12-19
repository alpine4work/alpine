import {RefObject, useEffect, useReducer} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {
    ExecuteSearchResult,
    emptyExecuteSearchResult,
    executeSearch,
    pendingExecuteSearchResult,
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
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

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

export function useSearchState({
    initialQueryText,
    resultListContainerRef,
}: {
    initialQueryText: string;
    resultListContainerRef: RefObject<HTMLDivElement>;
}): {
    result: ExecuteSearchResult & {readonly key: string};
    queryText: string;
    onQueryTextChange: (queryText: string) => void;
} {
    const context = useAppContext();
    const {space} = useSpaceContext();

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
        });
    }, [context, resultListContainerRef, searchState.executionStack.latestExecution, space.id]);

    useEffect(() => {
        if (searchState.wordTypingTimeoutTime === null) return;

        const timeout = createTimeout(() => {
            dispatch({type: "FireWordTypingTimeout"});
        }, searchState.wordTypingTimeoutTime - Date.now());

        return () => timeout.clear();
    }, [searchState.wordTypingTimeoutTime]);

    const result = useStore(searchState.executionStack);

    return {
        result,
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
type SearchStateExecution = Store<ExecuteSearchResult & {readonly key: string}> & {
    readonly queryText: string;
    execute(context: AppContext, options: {spaceId: SpaceId; limit: number}): void;
};

function createSearchStateExecution(queryText: string): SearchStateExecution {
    const key = generateId();

    let hasExecuted = false;

    const execute = (context: AppContext, {spaceId, limit}: {spaceId: SpaceId; limit: number}) => {
        // This method is idempotent. Only execute once.
        if (hasExecuted) return;
        hasExecuted = true;

        store.set(executeSearch(context, {spaceId, queryText, limit}));
    };

    const store = new ValueStore<Store<ExecuteSearchResult>>(
        new ConstStore(pendingExecuteSearchResult),
    );

    // If the query text is empty, we don't have to wait for lazy execution to know
    // we'll get an empty result.
    if (queryText.length === 0) {
        hasExecuted = true;
        store.set(new ConstStore(emptyExecuteSearchResult));
    }

    return Object.assign(
        store.flat().map(result => ({...result, key})),
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
type SearchStateExecutionStack = Store<ExecuteSearchResult & {readonly key: string}> & {
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

    const store = computeStore((get): ExecuteSearchResult & {readonly key: string} => {
        for (let i = stack.length - 1; i >= 0; i--) {
            const execution = stack[i]!;

            const result = get(execution);

            if (!result.isPending || result.results) {
                // We only care about the latest execution with results. Throw away all earlier
                // executions so they can be garbage collected. We will never need to use them
                // again. Once an execution is not pending, it will never enter a pending state
                // again.
                stack = stack.slice(i);

                if (i === stack.length - 1) {
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
