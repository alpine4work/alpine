import {MagnifyingGlass} from "phosphor-react";
import {useEffect, useReducer, useRef} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {Modal} from "~/client/design/modal.js";
import {SearchResultList} from "~/client/search/search_result_list.js";
import {minSearchResultViewHeight} from "~/client/search/search_result_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {
    Spacing,
    convertRemLengthToPx,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {searchByKeyword} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchResult} from "~/shared/search/search_result.js";
import {sprinkles} from "~/shared/styles/styles.js";

// NOCOMMIT: Double check that this renders on top of peeks. Add a test

// NOCOMMIT: Loading spinner

// NOCOMMIT: Escape clears search first then closes

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

type SearchStateRequest = {
    readonly queryText: string;
};

type SearchState = {
    readonly queryText: string;
    readonly wordTypingTimeoutTime: number | null;
    readonly pendingRequest: SearchStateRequest | null;
    readonly data: Result<{
        readonly results: ReadonlyArray<SearchResult>;
    }> | null;
};

function getInitialSearchState(initialQueryText: string): SearchState {
    const queryWords = splitUnicodeDefaultWordBoundary(initialQueryText);

    return {
        queryText: initialQueryText,
        wordTypingTimeoutTime: null,
        pendingRequest: queryWords.length > 0 ? {queryText: initialQueryText} : null,
        data: null,
    };
}

type SearchAction =
    | {
          readonly type: "ChangeQueryText";
          readonly queryText: string;
      }
    | {
          readonly type: "WordTypingTimeout";
      }
    | {
          readonly type: "ReceiveResponse";
          readonly request: SearchStateRequest;
          readonly data: Result<{
              readonly results: ReadonlyArray<SearchResult>;
          }>;
      };

function reduceSearchState(oldState: SearchState, action: SearchAction): SearchState {
    switch (action.type) {
        case "ChangeQueryText": {
            const oldQueryWords = splitUnicodeDefaultWordBoundary(oldState.queryText);
            const newQueryWords = splitUnicodeDefaultWordBoundary(action.queryText);

            const isTypingNewLastWord =
                newQueryWords.length > 0 &&
                oldQueryWords.length === newQueryWords.length - 1 &&
                oldQueryWords.every((oldQueryWord, i) => oldQueryWord === newQueryWords[i]);

            let newPendingRequest: SearchStateRequest | null;
            let newWordTypingTimeoutTime: number | null;

            // If the user has started typing a new word at the end of the query then send
            // a search with the OLD text not including the start of their new word. We'll
            // send a query with their new word once they're done typing.
            //
            // This way we send intermediate searches to our server with completed words.
            if (isTypingNewLastWord) {
                newPendingRequest =
                    oldQueryWords.length > 0 ? {queryText: oldState.queryText} : null;
                newWordTypingTimeoutTime = Date.now() + searchWordTypingDebounceMs;
            }
            // For other edits, wait for a debounce timeout so we know the user is done
            // typing before sending a request to the server.
            else {
                newPendingRequest = oldState.pendingRequest;
                newWordTypingTimeoutTime = Date.now() + searchWordTypingDebounceMs;
            }

            return {
                ...oldState,
                queryText: action.queryText,
                wordTypingTimeoutTime: newWordTypingTimeoutTime,
                pendingRequest: newPendingRequest,
                // If the search query is deleted, then clear search result data.
                data: newQueryWords.length === 0 ? null : oldState.data,
            };
        }
        case "WordTypingTimeout": {
            const {queryText} = oldState;
            const queryWords = splitUnicodeDefaultWordBoundary(queryText);

            return {
                ...oldState,
                wordTypingTimeoutTime: null,
                pendingRequest: queryWords.length > 0 ? {queryText} : null,
            };
        }
        case "ReceiveResponse": {
            // We only accept responses for our current pending request.
            if (oldState.pendingRequest !== action.request) return oldState;

            return {
                ...oldState,
                pendingRequest: null,
                data: action.data,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function SearchModal({
    initialQueryText,
    onClose,
}: {
    initialQueryText: string;
    onClose: () => void;
}) {
    const context = useAppContext();
    const {space} = useSpaceContext();

    const resultListContainerRef = useRef<HTMLDivElement>(null);

    const [searchState, dispatch] = useReducer(
        reduceSearchState,
        initialQueryText,
        getInitialSearchState,
    );

    // Keep the `search` URL parameter updated while this modal is open. We don't
    // use Remix's `useSearchParams()` because we don't want to re-render
    // underlying components when the search parameter changes. By directly calling
    // `replaceState()` we silently side-step Remix.
    useEffect(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("search", searchState.queryText);
        window.history.replaceState(null, "", url);
    }, [searchState.queryText]);

    // When this component unmounts, remove the `search` URL parameter.
    useEffect(() => {
        return () => {
            const url = new URL(window.location.href);
            url.searchParams.delete("search");
            window.history.replaceState(null, "", url);
        };
    }, []);

    useEffect(() => {
        if (searchState.wordTypingTimeoutTime === null) return;

        const timeout = createTimeout(() => {
            dispatch({type: "WordTypingTimeout"});
        }, searchState.wordTypingTimeoutTime - Date.now());

        return () => timeout.clear();
    }, [searchState.wordTypingTimeoutTime]);

    const lastRequestRef = useRef<SearchStateRequest | null>(null);

    useEffect(() => {
        const resultListContainerElement = assertExists(resultListContainerRef.current);

        const request = searchState.pendingRequest;

        if (lastRequestRef.current === request) return;
        lastRequestRef.current = request;

        if (!request) return;

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

        searchByKeyword(context, {
            spaceId: space.id,
            queryText: request.queryText,
            limit,
        }).then(
            output => {
                dispatch({
                    type: "ReceiveResponse",
                    request,
                    data: {ok: true, value: output},
                });
            },
            error => {
                dispatch({
                    type: "ReceiveResponse",
                    request,
                    data: {ok: false, error},
                });
            },
        );
    }, [context, searchState.pendingRequest, space.id]);

    return (
        <Modal
            aria-label="Search"
            maxWidth="256"
            height="full"
            maxHeight="192"
            borderRadius="lg"
            withoutCloseButton={true}
            onClose={onClose}
        >
            <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
                <SearchModalInput
                    queryText={searchState.queryText}
                    onQueryTextChange={queryText => dispatch({type: "ChangeQueryText", queryText})}
                />
                <Box
                    flexGrow="1"
                    width="full"
                    overflow="hidden"
                    display="flex"
                    flexDirection="row"
                    borderTop="grey-10"
                >
                    <Box ref={resultListContainerRef} flexGrow="1" height="full" overflow="hidden">
                        {!searchState.data ? (
                            <></>
                        ) : !searchState.data.ok ? (
                            <Box
                                maxWidth="128"
                                marginX="auto"
                                padding="8"
                                paddingTop="16"
                                paddingBottom="8"
                            >
                                <ErrorBodyRenderer
                                    title="Couldn’t get search results"
                                    error={searchState.data.error}
                                />
                            </Box>
                        ) : (
                            <SearchResultList results={searchState.data.value.results} />
                        )}
                    </Box>
                    <Box flexShrink="0" width="96" height="full" borderLeft="grey-10"></Box>
                </Box>
            </Box>
        </Modal>
    );
}

function SearchModalInput({
    queryText,
    onQueryTextChange,
}: {
    queryText: string;
    onQueryTextChange: (queryText: string) => void;
}) {
    const {space} = useSpaceContext();
    const inputRef = useRef<HTMLInputElement>(null);

    // Immediately focus the search input.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        assertExists(inputRef.current).focus();
    }, []);

    const height: Spacing = "12";
    const paddingLeft: Spacing = "10";
    const iconSize: Spacing = "4";

    const heightRem = parseRemLengthNumber(spacing[height]);
    const paddingLeftRem = parseRemLengthNumber(spacing[paddingLeft]);
    const iconSizeRem = parseRemLengthNumber(spacing[iconSize]);

    return (
        <Box flexShrink="0" position="relative" width="full">
            <MagnifyingGlass
                size={`${iconSizeRem}rem`}
                className={sprinkles({
                    pointerEvents: "none",
                    position: "absolute",
                    color: "grey-40",
                })}
                style={{
                    top: `${(heightRem - iconSizeRem) / 2}rem`,
                    left: `${(paddingLeftRem - iconSizeRem) / 2}rem`,
                }}
            />
            <input
                ref={inputRef}
                className={sprinkles({
                    display: "block",
                    width: "full",
                    height,
                    paddingLeft,
                    paddingRight: "2",
                    fontSize: "400",
                    backgroundColor: "transparent",
                })}
                placeholder={`Search ${space.name}…`}
                value={queryText}
                onChange={event => onQueryTextChange(event.currentTarget.value)}
            />
        </Box>
    );
}
