import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {
    ArrowLeft,
    ArrowRight,
    ArrowsOutSimple,
    MagnifyingGlass,
    Sparkle,
    SpinnerGap,
    X,
} from "phosphor-react";
import {Memo, Ref, forwardRef, useCallback, useEffect, useId, useRef, useState} from "react";
import {To, createPath} from "react-router";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {IconButton} from "~/client/design/icon_button.js";
import {Modal} from "~/client/design/modal.js";
import {Toast, useShowToast} from "~/client/design/toast.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {PeekRemixEmbed} from "~/client/peek/peek_remix_embed.js";
import {
    PeekSwitcherStatePeek,
    PeekSwitcherStatePeekContent,
    usePeekSwitcherState,
} from "~/client/peek/use_peek_switcher_state.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    SearchResultView,
    minSearchResultViewHeight,
} from "~/client/search/internal/search_result_view.js";
import {useSearchState} from "~/client/search/internal/use_search_state.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {generateId, unsafelyGenerateStableId} from "~/shared/id/id.js";
import {PeekId, SpaceId} from "~/shared/id/types/id_types.js";
import {convertPeekPathToSpacePath} from "~/shared/remix/peek_path_helpers.js";
import {SearchEntityIdObject, parseSearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchOptions} from "~/shared/search/search_options.js";
import {SearchResult, SearchResultId} from "~/shared/search/search_result.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    inputPlaceholderStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

const searchModalInputHeight = "16";
const searchModalPeekContentMaxHeight = "160";

const searchModalMaxHeight = addRemLengths(
    spacing[searchModalInputHeight],
    spacing[searchModalPeekContentMaxHeight],
);

const searchModalPeekControlsHeight = "6";

// Export the preload hook from our internal folder so it can be used by code
// depending on `//client/search`.
export {usePreloadSearchByAffinity as usePreloadAffinitiveSearchEntities} from "~/client/search/internal/use_search_state.js";

export function SearchModal({
    initialQueryText,
    onClose,
    pushPeekStack,
    debugOptions,
}: {
    initialQueryText: string;
    onClose: () => void;
    pushPeekStack: (to: To, options?: {focus?: boolean}) => Promise<void>;
    debugOptions: SearchOptions | null;
}) {
    const {space} = useSpaceContext();
    const navigate = useNavigate();
    const showToast = useShowToast();

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

    const {output, queryText, onQueryTextChange} = useSearchState({
        initialQueryText,
        resultListContainerRef,
        debugOptions,
    });

    // Keep the `search` URL parameter updated while this modal is open.
    useEffect(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("search", queryText);

        // Silently update the URL without telling Remix so our components don't
        // re-render unnecessarily.
        window.history.replaceState(window.history.state, "", url);
    }, [queryText]);

    // When this component unmounts, remove the `search` URL parameter.
    useEffect(() => {
        return () => {
            const url = new URL(window.location.href);
            url.searchParams.delete("search");

            // Silently update the URL without telling Remix so our components don't
            // re-render unnecessarily.
            window.history.replaceState(window.history.state, "", url);
        };
    }, []);

    const {selectedPeek, activePeek, switchPeek} = usePeekSwitcherState<{
        resultId: SearchResultId;
        destination: SearchResultDestination;
    }>({
        // Reset our peek state if the search response changes.
        key: output.key,
        initialPeekData: null,
    });

    const shouldShowInputLoadingIndicator =
        useDelayLoadingIndicator(output.isPending) &&
        // Only display a loading indicator on the input if we have results. Otherwise
        // we'll display a large loading indicator in the result list while we wait for
        // results to load.
        !!output.results;

    return (
        <Modal
            aria-label="Search"
            maxWidth="256"
            height="full"
            maxHeight={searchModalMaxHeight}
            borderRadius="lg"
            withoutCloseButton={true}
            // Don't animate the search modal open. The search modal is generally opened by
            // a user with direct intent to search. The search modal is a critical part of
            // the Alpine workflow. Slowing down the search workflow for even a 200ms
            // animation will make the product feel less snappy.
            withoutOpenAnimation={true}
            onClose={onClose}
        >
            {debugOptions && (
                // Show a debug mode indicator when we're using debug options to search. Since
                // we may not show explanation badges on search results.
                <Box
                    position="absolute"
                    top="2"
                    right="2"
                    zIndex="20"
                    pointerEvents="none"
                    fontSize="50"
                    fontStyle="code"
                    backgroundColor="green-10"
                    color="green-80"
                    paddingX="1"
                    paddingY="0.5"
                    borderRadius="base"
                >
                    Debug: On
                </Box>
            )}
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    switch (event.key) {
                        // The first escape press should clear search. The second escape press should
                        // close the modal. It's important that this `<GlobalKeyDownEvent>` is a child
                        // of `<Modal>`! That way we run our escape handler first.
                        case "Escape": {
                            // Let `<Modal>` handle our keypress and close the modal.
                            if (queryText === "") break;

                            event.preventDefault();
                            event.stopPropagation();
                            onQueryTextChange("");
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
                            if (!output.results) break;

                            const index = selectedPeek
                                ? output.results.findIndex(
                                      result => result.id === selectedPeek.extra.resultId,
                                  )
                                : -1;

                            const result =
                                index !== -1
                                    ? output.results[
                                          event.key === "ArrowUp" ? index - 1 : index + 1
                                      ]
                                    : output.results[0];

                            // There is no next item. Do nothing. Don't loop around since we may have many
                            // items so looping would be disorienting.
                            if (!result) break;

                            const destination = getSearchResultDestination(
                                space.id,
                                result.id,
                                output.key,
                            );

                            void switchPeek({
                                spacePath: destination.type === "Path" ? destination.path : null,
                                extra: {resultId: result.id, destination},
                            });
                            break;
                        }

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

                            switch (selectedPeek.extra.destination.type) {
                                case "Action": {
                                    selectedPeek.extra.destination.onSelect({
                                        spaceId: space.id,
                                        navigate,
                                        showToast,
                                    });
                                    break;
                                }
                                case "Path": {
                                    if (!selectedPeek.content) break;

                                    // Open the selected peek when `Enter` is pressed. You've probably just
                                    // selected a peek with the keyboard.
                                    const spacePath = convertPeekPathToSpacePath(
                                        selectedPeek.content.history.location,
                                    );
                                    if (!spacePath)
                                        throw new InternalError("Can only expand peek routes");

                                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                                    // Eventually switch to new page with a loading spinner?
                                    void navigate(spacePath);
                                    break;
                                }
                                default:
                                    throw exhaustive(selectedPeek.extra.destination);
                            }
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
                        queryText={queryText}
                        onQueryTextChange={onQueryTextChange}
                        shouldShowLoadingIndicator={shouldShowInputLoadingIndicator}
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
                            // Reset our result list if the search response changes.
                            key={output.key}
                            ref={resultListContainerRef}
                            flexGrow="1"
                            height="full"
                            overflow="hidden"
                        >
                            {output.isError ? (
                                <Box
                                    maxWidth="128"
                                    marginX="auto"
                                    padding="8"
                                    paddingTop="16"
                                    paddingBottom="8"
                                >
                                    <ErrorBodyRenderer
                                        title="Couldn’t get search results"
                                        error={output.error}
                                    />
                                </Box>
                            ) : !output.results ? (
                                <Box
                                    width="full"
                                    height="full"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    <SpinnerGap
                                        className={spinAnimationClassName}
                                        color={colorSchemeVars["grey-70"]}
                                        size={spacing["6"]}
                                    />
                                </Box>
                            ) : output.results.length === 0 ? (
                                <Box
                                    color="grey-50"
                                    padding="4"
                                    style={contentSchemaStyles.paragraphFontSize}
                                >
                                    Couldn’t find anything matching “
                                    <span
                                        className={sprinkles({color: "grey-70", fontStyle: "bold"})}
                                    >
                                        {queryText}
                                    </span>
                                    .” Try a different search?
                                </Box>
                            ) : (
                                <SearchModalResultList
                                    searchKey={output.key}
                                    results={output.results}
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
                            {activePeek?.content ? (
                                <SearchModalPeekContent
                                    // Fully remount whenever the peek changes...
                                    key={activePeek.id}
                                    peekId={activePeek.id}
                                    peekContent={activePeek.content}
                                    onClose={onClose}
                                    pushPeekStack={pushPeekStack}
                                    switchPeek={switchPeek}
                                />
                            ) : (
                                <Box
                                    width="full"
                                    height="full"
                                    overflow="hidden"
                                    display="flex"
                                    flexDirection="column"
                                    justifyContent="flex-end"
                                    alignItems="center"
                                >
                                    <Box
                                        padding="10"
                                        fontSize="100"
                                        userSelect="text"
                                        color="grey-40"
                                        width="full"
                                        style={{fontWeight: inputPlaceholderStyles.fontWeight}}
                                    >
                                        <Box
                                            display="flex"
                                            alignItems="center"
                                            gap="2"
                                            paddingBottom="3"
                                        >
                                            <Sparkle size={spacing["4"]} />
                                            <Box>Try advanced searches like…</Box>
                                        </Box>
                                        <Box>
                                            {[
                                                "my documents",
                                                "messages from alex last week",
                                                "tasks I updated yesterday",
                                                "posts by jordan",
                                            ].map((example, i) => (
                                                <Box
                                                    key={i}
                                                    className={classNames(
                                                        contentSchemaStyles.listItemClassName,
                                                        contentSchemaStyles.bulletListItemClassName,
                                                    )}
                                                    style={{
                                                        ...assignInlineVars({
                                                            [contentSchemaStyles.listItemIndentationVar]:
                                                                "0",
                                                        }),
                                                    }}
                                                    paddingBottom="1.5"
                                                >
                                                    <Box paddingLeft="2">{example}</Box>
                                                </Box>
                                            ))}
                                        </Box>
                                    </Box>
                                </Box>
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
        shouldShowLoadingIndicator,
    }: {
        queryText: string;
        onQueryTextChange: (queryText: string) => void;
        shouldShowLoadingIndicator: boolean;
    },
    ref: Ref<HTMLInputElement>,
) {
    const {space} = useSpaceContext();

    const paddingXWithIcon: Spacing = "12";
    const leftIconOffsetLeft: Spacing = "1";
    const iconSize: Spacing = "5";

    const heightRem = parseRemLengthNumber(spacing[searchModalInputHeight]);
    const paddingXWithIconRem = parseRemLengthNumber(spacing[paddingXWithIcon]);
    const leftIconOffsetLeftRem = parseRemLengthNumber(spacing[leftIconOffsetLeft]);
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
                    left: `${(paddingXWithIconRem - iconSizeRem) / 2 + leftIconOffsetLeftRem}rem`,
                }}
            />
            <input
                // NOTE(calebmer): There's no `<FocusRing>` on this input or the search modal
                // list since it should all be obviously keyboard navigable without needing
                // extra affordance.
                ref={ref}
                className={sprinkles({
                    display: "block",
                    width: "full",
                    height: searchModalInputHeight,
                    paddingLeft: paddingXWithIcon,
                    paddingRight: shouldShowLoadingIndicator ? paddingXWithIcon : "2",
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
            {shouldShowLoadingIndicator && (
                <Box
                    position="absolute"
                    pointerEvents="none"
                    color="grey-70"
                    style={{
                        top: `${(heightRem - iconSizeRem) / 2}rem`,
                        right: `${(paddingXWithIconRem - iconSizeRem) / 2}rem`,
                    }}
                >
                    <SpinnerGap className={spinAnimationClassName} size={spacing[iconSize]} />
                </Box>
            )}
        </Box>
    );
});

function SearchModalResultList({
    searchKey,
    results,
    selectedPeek,
    switchPeek,
}: {
    searchKey: string;
    results: ReadonlyArray<SearchResult>;
    selectedPeek: PeekSwitcherStatePeek<{
        resultId: SearchResultId;
        destination: SearchResultDestination;
    }> | null;
    switchPeek: Memo<
        (
            peekData: {
                spacePath: string | null;
                extra: {
                    resultId: SearchResultId;
                    destination: SearchResultDestination;
                };
            } | null,
        ) => Promise<void>
    >;
}) {
    const navigate = useNavigate();
    const showToast = useShowToast();
    const {space} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const lastSelectedResultIdRef = useRef(selectedPeek?.extra.resultId);
    useLayoutEffectWithoutServerSideWarning(() => {
        const view = assertExists(viewRef.current);

        if (lastSelectedResultIdRef.current === selectedPeek?.extra.resultId) return;
        lastSelectedResultIdRef.current = selectedPeek?.extra.resultId;

        // When a new result is selected, make sure it is visible in our scroll window. Scroll to
        // it if it is not visible.
        if (selectedPeek?.extra.resultId) {
            view.scrollToKeyIfExists(`Loaded:${selectedPeek.extra.resultId}`, {withAnchor: true});
        }
    }, [selectedPeek?.extra.resultId]);

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
                        key: `Loaded:${result.id}`,
                        minHeight: minSearchResultViewHeight,
                        node: (
                            <SearchResultView
                                result={result}
                                isSelected={result.id === selectedPeek?.extra.resultId}
                                isFirstEntry={isFirstEntry}
                                isLastEntry={isLastEntry}
                                // We use `onPressStart` to select so the selected style is applied immediately.
                                // We use the selected style to indicate interaction to the user instead of an
                                // `isPressed` style. The benefit of using selection is the previous item loses
                                // its style.
                                onPressStart={() => {
                                    if (result.id !== selectedPeek?.extra.resultId) {
                                        const destination = getSearchResultDestination(
                                            space.id,
                                            result.id,
                                            searchKey,
                                        );

                                        void switchPeek({
                                            spacePath:
                                                destination.type === "Path"
                                                    ? destination.path
                                                    : null,
                                            extra: {resultId: result.id, destination},
                                        });
                                    }
                                }}
                                onDoubleClick={() => {
                                    const destination = getSearchResultDestination(
                                        space.id,
                                        result.id,
                                        searchKey,
                                    );

                                    switch (destination.type) {
                                        case "Path": {
                                            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                                            // Eventually switch to new page with a loading spinner?
                                            void navigate(destination.path);
                                            break;
                                        }
                                        case "Action": {
                                            destination.onSelect({
                                                spaceId: space.id,
                                                navigate,
                                                showToast,
                                            });
                                            break;
                                        }
                                        default:
                                            throw exhaustive(destination);
                                    }
                                }}
                            />
                        ),
                    };
                },
                [
                    navigate,
                    results,
                    searchKey,
                    selectedPeek?.extra.resultId,
                    showToast,
                    space.id,
                    switchPeek,
                ],
            )}
            extraChildrenOutsideContentElement={({contentHeight}) => (
                // Our items all have a bottom border. This is good when there's less content
                // than room to scroll since it creates a clear shape for the last item in the
                // list.
                //
                // However, if there are enough items to scroll then when the user has fully
                // scrolled we want the last item to *not* have a border bottom since the
                // bottom of the screen creates that boundary. We don't need to render an extra
                // line in the margins.
                //
                // This div covers the bottom border of the last item but only when there's
                // enough content to scroll. Otherwise the bottom border needs to be visible to
                // visually contain the last item. To debug this it's helpful to switch the
                // `backgroundColor` to `red-30` or something similar.
                <Box
                    position="absolute"
                    left="0"
                    right="0"
                    top="0"
                    style={{height: `max(100%, ${contentHeight}px)`}}
                >
                    <Box
                        position="absolute"
                        left="0"
                        right="0"
                        bottom="0"
                        height="1"
                        backgroundColor="grey-0"
                    />
                </Box>
            )}
        />
    );
}

type SearchResultDestination =
    | {
          readonly type: "Path";
          readonly path: string;
      }
    | {
          readonly type: "Action";
          readonly onSelect: (props: {
              spaceId: SpaceId;
              navigate: (to: To) => Promise<void>;
              showToast: (toast: Toast) => void;
          }) => void;
      };

function getSearchResultDestination(
    spaceId: SpaceId,
    resultId: SearchResultId,
    searchKey: string,
): SearchResultDestination {
    const getStableRandom = () => new StableRandom(`getSearchResultDestination:${searchKey}`);

    switch (resultId) {
        case "CreateChat":
        case "CreateChatMessage": {
            return {
                type: "Path",
                path: `/s/${spaceId}/chat/new`,
            };
        }
        case "CreatePost": {
            // Make sure we use the same `draftId` consistently for the current search
            // result list.
            const draftId = unsafelyGenerateStableId(getStableRandom(), resultId);

            return {
                type: "Path",
                path: `/s/${spaceId}/posts/new/${draftId}`,
            };
        }
        case "CreateChannel": {
            // Make sure we use the same `channelId` consistently for the current search
            // result list.
            const channelId = unsafelyGenerateStableId(getStableRandom(), resultId);

            return {
                type: "Path",
                path: `/s/${spaceId}/channels/${channelId}?create&focus=none`,
            };
        }
        case "CreateDocument": {
            // TODO(calebmer): Looks like now this is the only search result that doesn't
            // display something in the peek. Eventually I'd like to change documents so
            // when you open a URL with `?create` it doesn't actually create the document
            // until you start typing. At that point we can let you create a new document
            // through search.
            return {
                type: "Action",
                onSelect: ({spaceId, navigate}) => {
                    const documentId = generateId();

                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    // Eventually switch to new page with a loading spinner?
                    void navigate(`/s/${spaceId}/documents/${documentId}?create`);
                },
            };
        }
        case "CreateTaskCollection": {
            // Make sure we use the same `collectionId` consistently for the current search
            // result list.
            const collectionId = unsafelyGenerateStableId(getStableRandom(), resultId);

            return {
                type: "Path",
                path: `/s/${spaceId}/tasks/collections/${collectionId}?create&focus=none`,
            };
        }
        case "CreateTaskView": {
            return {
                type: "Path",
                path: `/s/${spaceId}/tasks/view`,
            };
        }
        case "CreateTask":
        case "TaskNotepad": {
            return {
                type: "Path",
                path: `/s/${spaceId}/tasks`,
            };
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks I’ve created");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return {
                type: "Path",
                path: `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
            };
        }
        case "TaskQueryFilteredToAssigneeIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks assigned to me");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return {
                type: "Path",
                path: `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
            };
        }
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive": {
            const nameSearchParam = encodeURIComponent("Active tasks assigned to me");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenActive"]),
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "ActivatedTime",
                    direction: "Descending",
                },
            ]);

            return {
                type: "Path",
                path: `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
            };
        }
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks I’ve assigned to others");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Assignee",
                    operation: {
                        type: "NoneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return {
                type: "Path",
                path: `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
            };
        }
        default: {
            const entityIdObject = parseSearchEntityId(resultId);
            return {
                type: "Path",
                path: getSearchEntityPath(spaceId, entityIdObject),
            };
        }
    }
}

function getSearchEntityPath(spaceId: SpaceId, entityId: SearchEntityIdObject): string {
    switch (entityId.type) {
        case "Account": {
            // NOTE(calebmer): Eventually I'd like to have a profile page for accounts.
            // Since we don't currently have that, route to a 1:1 chat with the account.
            //
            // Though even if we had a profile page for accounts, routing to the 1:1 chat
            // in search may be more useful.
            return `/s/${spaceId}/chat/with/${entityId.accountId}`;
        }
        case "Document": {
            return `/s/${spaceId}/documents/${entityId.documentId}`;
        }
        case "DocumentComment": {
            return `/s/${spaceId}/documents/${entityId.documentId}?comments=${entityId.commentThreadId}&comment=${entityId.commentIndex}`;
        }
        case "Channel": {
            return `/s/${spaceId}/channels/${entityId.channelId}`;
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
            return `/s/${spaceId}/tasks/collections/${entityId.collectionId}`;
        }
        default:
            throw exhaustive(entityId);
    }
}

function SearchModalPeekContent({
    peekId,
    peekContent,
    onClose,
    pushPeekStack,
    switchPeek,
}: {
    peekId: PeekId;
    peekContent: PeekSwitcherStatePeekContent;
    onClose: () => void;
    pushPeekStack: (to: To, options?: {focus?: boolean}) => Promise<void>;
    switchPeek: Memo<
        (
            peekData: {
                spacePath: string | null;
                extra: {
                    resultId: SearchResultId;
                    destination: SearchResultDestination;
                };
            } | null,
        ) => Promise<void>
    >;
}) {
    const navigate = useNavigate();
    const routerResult = usePromise(peekContent.routerPromise);

    const [historyPosition, setHistoryPosition] = useState(() => ({
        index: peekContent.history.index,
        entriesLength: peekContent.history.entries.length,
    }));

    useEffect(() => {
        if (routerResult.isPending) return;

        const update = () => {
            setHistoryPosition(historyPosition => {
                const newHistoryPosition = {
                    index: peekContent.history.index,
                    entriesLength: peekContent.history.entries.length,
                };
                return !isDeepEqual(historyPosition, newHistoryPosition)
                    ? newHistoryPosition
                    : historyPosition;
            });
        };

        update();

        return routerResult.value.subscribe(update);
    }, [peekContent.history, routerResult.isPending, routerResult.value]);

    return (
        <Box
            position="relative"
            zIndex="0"
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            style={{
                // @ts-expect-error: This sets the CSS variable but TypeScript doesn't
                // like it.
                "--safe-area-inset-top": spacing[searchModalPeekControlsHeight],
            }}
        >
            {!routerResult.isPending && (
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    right="0"
                    // Render over overlays at `zIndex="50"`
                    zIndex="60"
                    height={searchModalPeekControlsHeight}
                    display="flex"
                    alignItems="center"
                >
                    <Box
                        flexShrink="0"
                        paddingX="1"
                        display="flex"
                        justifyContent="flex-start"
                        alignItems="center"
                        gap="1"
                    >
                        <IconButton
                            size="xs"
                            description="Go back"
                            tooltipPlacement="top"
                            isDisabled={!(historyPosition.index > 0)}
                            onPress={() => peekContent.history.go(-1)}
                        >
                            <ArrowLeft />
                        </IconButton>
                        <IconButton
                            size="xs"
                            description="Go forwards"
                            tooltipPlacement="top"
                            isDisabled={
                                !(historyPosition.index < historyPosition.entriesLength - 1)
                            }
                            onPress={() => peekContent.history.go(1)}
                        >
                            <ArrowRight />
                        </IconButton>
                    </Box>
                    <Box flexGrow="1" />
                    <Box
                        flexShrink="0"
                        paddingX="1"
                        display="flex"
                        justifyContent="flex-start"
                        alignItems="center"
                        gap="1"
                    >
                        <IconButton
                            size="xs"
                            description="Expand"
                            // TODO(calebmer): I think this is the only place in the product we name the
                            // peek concept. For now, I'm calling it "preview". We should make sure
                            // documentation, marketing, and other copy in the product align with this name.
                            // If we decide to call it something else publicly, this needs to be renamed.
                            tooltipContentOverride="Shift-click to open preview"
                            pressErrorTitle="Couldn’t expand"
                            onPress={async event => {
                                const spacePath = convertPeekPathToSpacePath(
                                    peekContent.history.location,
                                );
                                if (!spacePath)
                                    throw new InternalError("Can only expand peek routes");

                                if (
                                    isOpenLinkInSeparateTabPointerEvent(
                                        event,
                                        getClientInfoWithoutListening(),
                                    )
                                ) {
                                    window.open(
                                        createPath(spacePath),
                                        "_blank",
                                        // Important security measure. See:
                                        // https://mathiasbynens.github.io/rel-noopener
                                        "noopener noreferrer",
                                    );
                                } else if (event.shiftKey) {
                                    await pushPeekStack(spacePath).finally(onClose);
                                } else {
                                    await navigate(spacePath);
                                }
                            }}
                        >
                            <ArrowsOutSimple />
                        </IconButton>
                        <IconButton
                            size="xs"
                            description="Dismiss"
                            withoutTooltip={true}
                            pressErrorTitle="Couldn’t dismiss"
                            onPress={() => switchPeek(null)}
                        >
                            <X />
                        </IconButton>
                    </Box>
                </Box>
            )}
            {!routerResult.isPending ? (
                <PeekRemixEmbed
                    peekId={peekId}
                    withMobileLayout={true}
                    // Don't record view interactions when looking at a search entity in the search
                    // modal. The user is discovering an entity to open so may have pretty low
                    // intent when looking at an entity.
                    //
                    // This also means the "last opened" time we show for affinitive search entities
                    // won't change.
                    withoutSearchAffinityViewInteraction={true}
                    router={routerResult.value}
                    onGoBackOverflow={onClose}
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
