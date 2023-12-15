import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {Memo, Ref, forwardRef, useCallback, useEffect, useId, useReducer, useRef} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {Modal} from "~/client/design/modal.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {PeekRemixEmbed} from "~/client/peek/peek_remix_embed.js";
import {
    PeekSwitcherStatePeek,
    usePeekSwitcherState,
} from "~/client/peek/use_peek_switcher_state.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {SearchResultView, minSearchResultViewHeight} from "~/client/search/search_result_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {
    Spacing,
    convertRemLengthToPx,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Id, generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {searchByKeyword} from "~/shared/rpc/search_rpc_definitions.js";
import {
    SearchEntityId,
    SearchEntityIdObject,
    parseSearchEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchResult} from "~/shared/search/search_result.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";

// NOCOMMIT: Loading spinner

// NOCOMMIT: If you've selected something and new search results came in, try
// to maintain that selection but move it to the top or something? In case you
// see what you're looking for but the network is being slow.

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
    readonly wordTypingTimeoutTime: number | null;
    readonly pendingRequest: SearchStateRequest | null;
    readonly response: SearchStateResponse | null;
};

type SearchStateRequest = {
    readonly queryText: string;
};

type SearchStateResponse = {
    readonly key: Id;
    readonly request: SearchStateRequest;
    readonly data: Result<{
        readonly results: ReadonlyArray<SearchResult>;
    }>;
};

function getInitialSearchState(initialQueryText: string): SearchState {
    const queryWords = splitUnicodeDefaultWordBoundary(initialQueryText);

    return {
        queryText: initialQueryText,
        wordTypingTimeoutTime: null,
        pendingRequest: queryWords.length > 0 ? {queryText: initialQueryText} : null,
        response: null,
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
          readonly response: {
              readonly request: SearchStateRequest;
              readonly data: Result<{
                  readonly results: ReadonlyArray<SearchResult>;
              }>;
          };
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
            // It makes the product feel responsive to see results as you type. But since
            // our search backend doesn't support prefix searches we can only search on
            // complete words.
            if (
                isTypingNewLastWord &&
                // If we already have the data we'd search with an intermediate search request
                // then don't send a new request. This happens if you've typed a word, stopped,
                // the search has loaded, then type a new word.
                oldState.queryText.trim() !== oldState.response?.request.queryText
            ) {
                newPendingRequest =
                    oldQueryWords.length > 0 ? {queryText: oldState.queryText.trim()} : null;
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
                response: newQueryWords.length === 0 ? null : oldState.response,
            };
        }
        case "WordTypingTimeout": {
            const {queryText} = oldState;
            const queryWords = splitUnicodeDefaultWordBoundary(queryText);

            return {
                ...oldState,
                wordTypingTimeoutTime: null,
                pendingRequest: queryWords.length > 0 ? {queryText: queryText.trim()} : null,
            };
        }
        case "ReceiveResponse": {
            // We only accept responses for our current pending request.
            if (oldState.pendingRequest !== action.response.request) return oldState;

            return {
                ...oldState,
                pendingRequest: null,
                response: {
                    ...action.response,
                    key: generateId(),
                },
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
    const rootNavigate = useRootNavigate();

    const inputRef = useRef<HTMLInputElement>(null);
    const resultListContainerRef = useRef<HTMLDivElement>(null);

    // Immediately focus the search input.
    //
    // If the search input has some text (e.g. from the URL) then we select that
    // text so the user can immediately start a new search.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);

        inputElement.select();
        inputElement.focus();
    }, []);

    const [searchState, dispatch] = useReducer(
        reduceSearchState,
        initialQueryText,
        getInitialSearchState,
    );

    // Keep the `search` URL parameter updated while this modal is open.
    useEffect(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("search", searchState.queryText);

        // Silently update the URL without telling Remix so our components don't
        // re-render unnecessarily.
        window.history.replaceState(null, "", url);
    }, [searchState.queryText]);

    // When this component unmounts, remove the `search` URL parameter.
    useEffect(() => {
        return () => {
            const url = new URL(window.location.href);
            url.searchParams.delete("search");

            // Silently update the URL without telling Remix so our components don't
            // re-render unnecessarily.
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
                    response: {
                        request,
                        data: {ok: true, value: output},
                    },
                });
            },
            error => {
                dispatch({
                    type: "ReceiveResponse",
                    response: {
                        request,
                        data: {ok: false, error},
                    },
                });
            },
        );
    }, [context, searchState.pendingRequest, space.id]);

    const {selectedPeek, activePeek, switchPeek} = usePeekSwitcherState<{
        entityId: SearchEntityId;
    }>({
        // Reset our peek state if the search response changes.
        key: searchState.response?.key,
        initialPeekData: null,
    });

    return (
        <Modal
            aria-label="Search"
            maxWidth="256"
            height="full"
            maxHeight="192"
            borderRadius="lg"
            withoutCloseButton={true}
            // Don't animate the search modal open. The search modal is generally opened by
            // a user with direct intent to search. The search modal is a critical part of
            // the Alpine workflow. Slowing down the search workflow for even a 200ms
            // animation will make the product feel less snappy.
            withoutOpenAnimation={true}
            onClose={onClose}
        >
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    switch (event.key) {
                        // The first escape press should clear search. The second escape press should
                        // close the modal. It's important that this `<GlobalKeyDownEvent>` is a child
                        // of `<Modal>`! That way we run our escape handler first.
                        case "Escape": {
                            // Let `<Modal>` handle our keypress and close the modal.
                            if (searchState.queryText === "") break;

                            event.preventDefault();
                            event.stopPropagation();
                            dispatch({type: "ChangeQueryText", queryText: ""});
                            break;
                        }

                        case "ArrowUp":
                        case "ArrowDown": {
                            const inputElement = assertExists(inputRef.current);

                            // Ignore modified arrow up/down events like cmd-down which scrolls.
                            if (isModifiedKeyboardEvent(event)) break;

                            // If focus is within a text input element (e.g. we have a document peek open)
                            // then arrow key presses are for text editing.
                            //
                            // However, if focus is in our search input element then arrow key presses are
                            // for navigation.
                            if (
                                document.activeElement !== inputElement &&
                                isTextInputElement(document.activeElement)
                            ) {
                                break;
                            }

                            event.stopPropagation();
                            event.preventDefault();

                            // Data hasn't loaded yet, we can't select anything.
                            if (!searchState.response?.data.value) break;

                            const index = selectedPeek
                                ? searchState.response.data.value.results.findIndex(
                                      result => result.entityId === selectedPeek.extra.entityId,
                                  )
                                : -1;

                            const result =
                                index !== -1
                                    ? searchState.response.data.value.results[
                                          event.key === "ArrowUp" ? index - 1 : index + 1
                                      ]
                                    : searchState.response.data.value.results[0];

                            // There is no next item. Do nothing. Don't loop around since we may have many
                            // items so looping would be disorienting.
                            if (!result) break;

                            void switchPeek({
                                spacePath: getSearchEntityIdPath(space.id, result.entityId),
                                extra: {entityId: result.entityId},
                            });
                            break;
                        }

                        // NOCOMMIT: We need some other way to navigate besides `Enter`. Something that works on
                        // a touch device like an iPad.
                        case "Enter": {
                            const inputElement = assertExists(inputRef.current);

                            // Ignore modified arrow up/down events like cmd-down which scrolls.
                            if (isModifiedKeyboardEvent(event)) break;

                            // If focus is within a text input element (e.g. we have a document peek open)
                            // then arrow key presses are for text editing.
                            //
                            // However, if focus is in our search input element then arrow key presses are
                            // for navigation.
                            if (
                                document.activeElement !== inputElement &&
                                isTextInputElement(document.activeElement)
                            ) {
                                break;
                            }

                            event.stopPropagation();
                            event.preventDefault();

                            // If nothing is selected, there's nothing to open.
                            if (!selectedPeek) break;

                            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                            // Eventually switch to new page with a loading spinner?
                            void rootNavigate(
                                getSearchEntityIdPath(space.id, selectedPeek.extra.entityId),
                            ).finally(onClose);
                            break;
                        }
                    }
                }}
            >
                <Box
                    width="full"
                    height="full"
                    overflow="hidden"
                    display="flex"
                    flexDirection="column"
                >
                    <SearchModalInput
                        ref={inputRef}
                        queryText={searchState.queryText}
                        onQueryTextChange={queryText =>
                            dispatch({type: "ChangeQueryText", queryText})
                        }
                    />
                    <Box
                        flexGrow="1"
                        width="full"
                        overflow="hidden"
                        display="flex"
                        flexDirection="row"
                        borderTop="grey-10"
                    >
                        <Box
                            ref={resultListContainerRef}
                            flexGrow="1"
                            height="full"
                            overflow="hidden"
                        >
                            {!searchState.response ? (
                                <></>
                            ) : !searchState.response.data.ok ? (
                                <Box
                                    maxWidth="128"
                                    marginX="auto"
                                    padding="8"
                                    paddingTop="16"
                                    paddingBottom="8"
                                >
                                    <ErrorBodyRenderer
                                        title="Couldn’t get search results"
                                        error={searchState.response.data.error}
                                    />
                                </Box>
                            ) : (
                                <SearchModalResultList
                                    // Reset our result list if the search response changes.
                                    key={searchState.response?.key}
                                    results={searchState.response.data.value.results}
                                    selectedPeek={selectedPeek}
                                    switchPeek={switchPeek}
                                />
                            )}
                        </Box>
                        <Box
                            flexShrink="0"
                            width="128"
                            height="full"
                            overflow="hidden"
                            borderLeft="grey-10"
                        >
                            {activePeek && (
                                <SearchModalPeekContent
                                    // Fully remount whenever the peek changes...
                                    key={activePeek.id}
                                    peek={activePeek}
                                />
                            )}
                        </Box>
                    </Box>
                </Box>
            </GlobalKeyDownEvent>
        </Modal>
    );
}

const SearchModalInput = forwardRef(function SearchModalInput(
    {
        queryText,
        onQueryTextChange,
    }: {
        queryText: string;
        onQueryTextChange: (queryText: string) => void;
    },
    ref: Ref<HTMLInputElement>,
) {
    const {space} = useSpaceContext();

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
                ref={ref}
                className={sprinkles({
                    display: "block",
                    width: "full",
                    height,
                    paddingLeft,
                    paddingRight: "2",
                    fontSize: "400",
                    backgroundColor: "transparent",
                })}
                // Chrome complains if `<input>` doesn't have an `id` or `name`.
                id={useId()}
                autoComplete="off"
                placeholder={`Search ${space.name}…`}
                value={queryText}
                onChange={event => onQueryTextChange(event.currentTarget.value)}
            />
        </Box>
    );
});

function SearchModalResultList({
    results,
    selectedPeek,
    switchPeek,
}: {
    results: ReadonlyArray<SearchResult>;
    selectedPeek: PeekSwitcherStatePeek<{entityId: SearchEntityId}> | null;
    switchPeek: Memo<
        (peekData: {spacePath: string; extra: {entityId: SearchEntityId}} | null) => Promise<void>
    >;
}) {
    const {space} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const lastSelectedEntityIdRef = useRef(selectedPeek?.extra.entityId);
    useLayoutEffectWithoutServerSideWarning(() => {
        const view = assertExists(viewRef.current);

        if (lastSelectedEntityIdRef.current === selectedPeek?.extra.entityId) return;
        lastSelectedEntityIdRef.current = selectedPeek?.extra.entityId;

        // When a new result is selected, make sure it is visible in our scroll window. Scroll to
        // it if it is not visible.
        if (selectedPeek?.extra.entityId) {
            view.scrollToKeyIfExists(`Loaded:${selectedPeek.extra.entityId}`, {withAnchor: true});
        }
    }, [selectedPeek?.extra.entityId]);

    return (
        <VirtualizedScrollView
            ref={viewRef}
            itemCount={results.length}
            bufferedItemHeight={minSearchResultViewHeight}
            renderItem={useCallback(
                (index: number) => {
                    const result = results[index]!;

                    const isFirstEntry = index === 0;
                    const isLastEntry = index === results.length - 1;

                    return {
                        key: `Loaded:${result.entityId}`,
                        minHeight: minSearchResultViewHeight,
                        node: (
                            <SearchResultView
                                result={result}
                                isSelected={result.entityId === selectedPeek?.extra.entityId}
                                isFirstEntry={isFirstEntry}
                                isLastEntry={isLastEntry}
                                // We use `onPressStart` to select so the selected style is applied immediately.
                                // We use the selected style to indicate interaction to the user instead of an
                                // `isPressed` style. The benefit of using selection is the previous item loses
                                // its style.
                                onPressStart={() => {
                                    if (result.entityId !== selectedPeek?.extra.entityId) {
                                        void switchPeek({
                                            spacePath: getSearchEntityIdPath(
                                                space.id,
                                                result.entityId,
                                            ),
                                            extra: {entityId: result.entityId},
                                        });
                                    }
                                }}
                            />
                        ),
                    };
                },
                [results, selectedPeek?.extra.entityId, space.id, switchPeek],
            )}
        />
    );
}

function getSearchEntityIdPath(spaceId: SpaceId, entityId: SearchEntityId): string {
    const entityIdObject = parseSearchEntityId(entityId);
    return actuallyGetSearchEntityIdPath(spaceId, entityIdObject);
}

function actuallyGetSearchEntityIdPath(spaceId: SpaceId, entityId: SearchEntityIdObject): string {
    switch (entityId.type) {
        case "Account": {
            // NOCOMMIT
            throw new UnimplementedError("TODO");
        }
        case "Document": {
            return `/s/${spaceId}/documents/${entityId.documentId}`;
        }
        case "DocumentComment": {
            return `/s/${spaceId}/documents/${entityId.documentId}?comments=${entityId.commentThreadId}&comment=${entityId.commentIndex}`;
        }
        case "Channel": {
            // NOCOMMIT
            throw new UnimplementedError("TODO");
        }
        case "Post": {
            return `/s/${spaceId}/posts/${entityId.postId}`;
        }
        case "PostComment": {
            return `/s/${spaceId}/posts/${entityId.postId}?comment=${entityId.commentIndex}`;
        }
        case "Chat": {
            return `/s/${spaceId}/chat/${entityId.chatId}`;
        }
        case "ChatMessage": {
            return `/s/${spaceId}/chat/${entityId.chatId}?message=${entityId.messageIndex}`;
        }
        case "Task": {
            return `/s/${spaceId}/tasks/${entityId.taskId}`;
        }
        case "TaskCollection": {
            // NOCOMMIT
            throw new UnimplementedError("TODO");
        }
        default:
            throw exhaustive(entityId);
    }
}

function SearchModalPeekContent({peek}: {peek: PeekSwitcherStatePeek<{entityId: SearchEntityId}>}) {
    const routerResult = usePromise(peek.routerPromise);

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            {!routerResult.isPending ? (
                <PeekRemixEmbed
                    peekId={peek.id}
                    withMobileLayout={true}
                    router={routerResult.value}
                />
            ) : (
                <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                    <SpinnerGap
                        className={spinAnimationClassName}
                        color={colorSchemeVars["grey-70"]}
                        size={spacing["6"]}
                    />
                </Box>
            )}
        </Box>
    );
}
