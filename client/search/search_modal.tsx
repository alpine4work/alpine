import {
    ArrowLeft,
    ArrowRight,
    ArrowsOutSimple,
    MagnifyingGlass,
    SpinnerGap,
    X,
} from "phosphor-react";
import {
    Memo,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {To, createPath} from "react-router";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {IconButton} from "~/client/design/icon_button.js";
import {Modal} from "~/client/design/modal.js";
import {useReporter} from "~/client/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {PeekRemixEmbed} from "~/client/peek/peek_remix_embed.js";
import {
    PeekSwitcherStatePeek,
    PeekSwitcherStatePeekBase,
    usePeekSwitcherState,
} from "~/client/peek/use_peek_switcher_state.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {getSearchEntityPath} from "~/client/search/internal/get_search_entity_path.js";
import {SearchInstructionalPlaceholder} from "~/client/search/internal/search_instructional_placeholder.js";
import {SearchEntityView, searchEntitySideBarWidth} from "~/client/search/search_entity_view.js";
import {SearchStateExecutionOutput, useSearchState} from "~/client/search/use_search_state.js";
import {SearchEntityShimmer} from "~/client/shimmer/search_entity_shimmer.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {peekNarrowLayoutWidth} from "~/client/styles/peek_shared_styles.js";
import {
    searchEntityViewDefaultMarginX,
    searchEntityViewDefaultPaddingX,
    searchEntityViewMinHeightPx,
    searchEntityViewPaddingY,
} from "~/client/styles/search_shared_styles.js";
import {
    contentStyles,
    fontSizes,
    grey5SemiTransparentColorVar,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing, addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {convertPeekPathToSpacePath} from "~/shared/remix/peek_path_helpers.js";
import {markSearchAffinityEntityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchEntityId, isSearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {SearchOptions} from "~/shared/search/search_options.js";

const searchModalInputHeight = "16";
const searchModalPeekContentMaxHeight = "160";

const searchModalMaxHeight = addRemLengths(searchModalInputHeight, searchModalPeekContentMaxHeight);

const searchModalPeekControlsHeight = "6";

export function SearchModal({
    onClose,
    pushPeekStack,
    debugOptions,
}: {
    onClose: Memo<() => void>;
    pushPeekStack: Memo<(to: To, options?: {focus?: boolean}) => Promise<void>>;
    debugOptions: SearchOptions | null;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const {space} = useSpaceContext();
    const navigate = useNavigate();

    const inputRef = useRef<HTMLInputElement>(null);

    // Immediately focus the search input.
    //
    // If the search input has some text (e.g. from the URL) then we select that
    // text so the user can immediately start a new search.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);

        inputElement.focus();
        inputElement.select();
    }, []);

    const {output, queryText, onQueryTextChange} = useSearchState({
        isSearchParamControlled: true,
        debugOptions,
    });

    const {selectedPeek, activePeek, switchPeek, holdPeekTransition} = usePeekSwitcherState<{
        entityId: SearchEntityId;
    }>({
        // Reset our peek state if the search response changes.
        //
        // NOCOMMIT: Consider removing this? Or only clear if the new result isn't in
        // the search list. Maybe also avoid remounting?
        key: output.key,
        initialPeekData: null,
    });

    const shouldShowInputLoadingIndicator =
        useDelayLoadingIndicator(output.isPending) &&
        // Only display a loading indicator on the input if we have results. Otherwise
        // we'll display a large loading indicator in the result list while we wait for
        // results to load.
        !!output.results;

    // Whenever the user selects a search result, we record a high intent affinity
    // interaction. This is because the user opening a result from search is super
    // high signal that this is an entity they care about. In this way search is a
    // self reinforcing system. The more a user selects an entity, the higher the
    // entity will appear in the user's next search.
    const markResultSelectAffinityInteraction = useCallback(
        (entityId: SearchEntityId) => {
            if (!isSearchAffinityEntityId(entityId)) return;

            markSearchAffinityEntityInteraction(context, {
                spaceId: space.id,
                entityId,
                interaction: {type: "HighIntentUpdate"},
            }).catch(error => {
                // Silently fail. This doesn't affect anything the user sees so we don't need
                // to report the error to the user.
                reporter.logErrorWithoutDisplaying(
                    "Couldn't mark search result select affinity interaction",
                    error,
                );
            });
        },
        [context, reporter, space.id],
    );

    return (
        <Modal
            aria-label="Search"
            maxWidth={addRemLengths(searchEntitySideBarWidth, peekNarrowLayoutWidth)}
            height="full"
            maxHeight={searchModalMaxHeight}
            borderRadius="2.5"
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
                    color="green-90"
                    paddingX="1"
                    paddingY="0.5"
                    borderRadius="1"
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

                            let result: {readonly id: SearchEntityId} | undefined;

                            if (!selectedPeek) {
                                if (
                                    output.type === "EmptyQuery" &&
                                    output.favoriteResults &&
                                    output.favoriteResults.length > 0
                                ) {
                                    result = output.favoriteResults[0]!;
                                } else if (output.results.length > 0) {
                                    result = output.results[0]!;
                                }
                            } else if (event.key === "ArrowUp") {
                                let found = false;

                                if (output.type === "EmptyQuery" && output.favoriteResults) {
                                    for (let i = 0; i < output.favoriteResults.length; i++) {
                                        const nextResult = output.favoriteResults[i]!;
                                        if (nextResult.id === selectedPeek.extra.entityId) {
                                            found = true;
                                            break;
                                        }
                                        result = nextResult;
                                    }
                                }

                                if (!found) {
                                    for (let i = 0; i < output.results.length; i++) {
                                        const nextResult = output.results[i]!;
                                        if (nextResult.id === selectedPeek.extra.entityId) {
                                            found = true;
                                            break;
                                        }
                                        result = nextResult;
                                    }
                                }

                                if (!found) {
                                    result = undefined;
                                }
                            } else {
                                let found = false;

                                for (let i = output.results.length - 1; i >= 0; i--) {
                                    const previousResult = output.results[i]!;
                                    if (previousResult.id === selectedPeek.extra.entityId) {
                                        found = true;
                                        break;
                                    }
                                    result = previousResult;
                                }

                                if (
                                    !found &&
                                    output.type === "EmptyQuery" &&
                                    output.favoriteResults
                                ) {
                                    for (let i = output.favoriteResults.length - 1; i >= 0; i--) {
                                        const previousResult = output.favoriteResults[i]!;
                                        if (previousResult.id === selectedPeek.extra.entityId) {
                                            found = true;
                                            break;
                                        }
                                        result = previousResult;
                                    }
                                }

                                if (!found) {
                                    result = undefined;
                                }
                            }

                            // There is no next item. Do nothing. Don't loop around since we may have many
                            // items so looping would be disorienting.
                            if (!result) break;

                            const path = getSearchEntityPath({
                                spaceId: space.id,
                                entityId: result.id,
                                randomSeed: output.key,
                                currentTime: output.queryTime,
                                routeLayout: "narrow",
                            });

                            // NOCOMMIT: We're not scrolling anymore? When did that break?
                            void switchPeek({
                                spacePath: path,
                                extra: {entityId: result.id},
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

                            // Open the selected peek when `Enter` is pressed. You've probably just
                            // selected a peek with the keyboard.
                            //
                            // We check `event.shiftKey` because this determines whether we open in a peek
                            // or navigate to full screen. Therefore we want the route not to open in a
                            // peek if `event.shiftKey` is pressed.
                            const spacePath = convertPeekPathToSpacePath(
                                selectedPeek.history.location,
                                {routeLayout: event.shiftKey ? "narrow" : "wide"},
                            );
                            if (!spacePath) throw new InternalError("Can only expand peek routes");

                            if (event.shiftKey) {
                                void pushPeekStack(spacePath).finally(() => {
                                    markResultSelectAffinityInteraction(
                                        selectedPeek.extra.entityId,
                                    );
                                });
                            } else {
                                navigate(spacePath).finally(() => {
                                    markResultSelectAffinityInteraction(
                                        selectedPeek.extra.entityId,
                                    );
                                });
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
                    >
                        {useMemo(
                            () => (
                                <Box
                                    // Reset our result list if the search response changes.
                                    key={output.key}
                                    flexGrow="1"
                                    height="full"
                                    overflow="hidden"
                                >
                                    {output.isError ? (
                                        <Box
                                            maxWidth={peekNarrowLayoutWidth}
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
                                        <Box width="full">
                                            <Box
                                                width="full"
                                                style={{height: `calc(${spacing["1"]} + 1px)`}}
                                            />
                                            <SearchEntityShimmer titleWidth="64" />
                                            <SearchEntityShimmer titleWidth="32" />
                                            <SearchEntityShimmer titleWidth="48" />
                                            <SearchEntityShimmer titleWidth="96" />
                                            <SearchEntityShimmer titleWidth="64" />
                                            <SearchEntityShimmer titleWidth="48" />
                                            <SearchEntityShimmer titleWidth="96" />
                                        </Box>
                                    ) : output.results.length === 0 ? (
                                        <Box
                                            color="grey-50"
                                            padding={searchEntityViewPaddingY}
                                            style={contentStyles.paragraphFontSize}
                                        >
                                            {queryText.trim().length === 0 ? (
                                                <>
                                                    As you explore, content you’ve recently visited
                                                    will show up here. For now, try searching.
                                                </>
                                            ) : (
                                                <>
                                                    Couldn’t find anything matching “
                                                    <span
                                                        className={sprinkles({
                                                            color: "grey-70",
                                                            fontStyle: "bold",
                                                        })}
                                                    >
                                                        {queryText}
                                                    </span>
                                                    .” Try a different search?
                                                </>
                                            )}
                                        </Box>
                                    ) : (
                                        <SearchModalResultList
                                            output={output}
                                            selectedPeek={selectedPeek}
                                            switchPeek={switchPeek}
                                            holdPeekTransition={holdPeekTransition}
                                            markResultSelectAffinityInteraction={
                                                markResultSelectAffinityInteraction
                                            }
                                        />
                                    )}
                                </Box>
                            ),
                            [
                                holdPeekTransition,
                                markResultSelectAffinityInteraction,
                                output,
                                queryText,
                                selectedPeek,
                                switchPeek,
                            ],
                        )}
                        {useMemo(
                            () => (
                                <Box
                                    flexShrink="0"
                                    width={peekNarrowLayoutWidth}
                                    height="full"
                                    overflow="hidden"
                                    style={{
                                        // Render border 1px down so the two semi transparent borders don't conflict
                                        // with each other creating a single pixel that's darker where they intersect.
                                        boxShadow: `-1px 1px 0 0 ${grey5SemiTransparentColorVar}`,
                                    }}
                                >
                                    {activePeek ? (
                                        <SearchModalPeekContent
                                            // Fully remount whenever the peek changes...
                                            key={activePeek.id}
                                            peek={activePeek}
                                            onClose={onClose}
                                            pushPeekStack={pushPeekStack}
                                            switchPeek={switchPeek}
                                            markResultSelectAffinityInteraction={
                                                markResultSelectAffinityInteraction
                                            }
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
                                            padding="10"
                                        >
                                            <SearchInstructionalPlaceholder />
                                        </Box>
                                    )}
                                </Box>
                            ),
                            [
                                activePeek,
                                markResultSelectAffinityInteraction,
                                onClose,
                                pushPeekStack,
                                switchPeek,
                            ],
                        )}
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

    const heightRem = parseRemLength(searchModalInputHeight);
    const paddingXWithIconRem = parseRemLength(paddingXWithIcon);
    const leftIconOffsetLeftRem = parseRemLength(leftIconOffsetLeft);
    const iconSizeRem = parseRemLength(iconSize);

    return (
        <Box
            flexShrink="0"
            position="relative"
            zIndex="10"
            width="full"
            style={{
                // Render border with a semi-transparent box shadow so that we get a nice
                // soft shadow effect when content from the search result list scrolls under
                // the border instead of a hard cutoff.
                boxShadow: `0 1px 0 0 ${grey5SemiTransparentColorVar}`,
            }}
        >
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
                style={{
                    // Render contextual alternate glyphs. User text may be rendered here. Helpful
                    // for consistency if the user types anything like 2x2 or an @ mention.
                    fontFeatureSettings: '"calt" on',
                }}
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
    output,
    selectedPeek,
    switchPeek,
    holdPeekTransition,
    markResultSelectAffinityInteraction,
}: {
    output: SearchStateExecutionOutput & {readonly results: object};
    selectedPeek: PeekSwitcherStatePeekBase<{entityId: SearchEntityId}> | null;
    switchPeek: Memo<
        (
            peekData: {
                spacePath: string;
                extra: {entityId: SearchEntityId};
            } | null,
        ) => Promise<void>
    >;
    holdPeekTransition: Memo<(promise: Promise<void>) => void>;
    markResultSelectAffinityInteraction: (entityId: SearchEntityId) => void;
}) {
    const spacingScale = useSpacingScale();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const lastSelectedResultIdRef = useRef(selectedPeek?.extra.entityId);
    useLayoutEffectWithoutServerSideWarning(() => {
        const view = assertExists(viewRef.current);

        if (lastSelectedResultIdRef.current === selectedPeek?.extra.entityId) return;
        lastSelectedResultIdRef.current = selectedPeek?.extra.entityId;

        // When a new result is selected, make sure it is visible in our scroll window. Scroll to
        // it if it is not visible.
        if (selectedPeek?.extra.entityId) {
            view.scrollToKeyIfExists(`Loaded:${selectedPeek.extra.entityId}`, {withAnchor: true});
        }
    }, [selectedPeek?.extra.entityId]);

    const handleDoubleClick = useEvent((result: {readonly id: SearchEntityId}) => {
        if (result.id !== selectedPeek?.extra.entityId) {
            const path = getSearchEntityPath({
                spaceId: space.id,
                entityId: result.id,
                randomSeed: output.key,
                currentTime: output.queryTime,
                routeLayout: "wide",
            });

            // If the user double clicked there may be an ongoing pending transition
            // started by `onPressStart`. Don't switch to that transition while we're
            // waiting on a navigation. That'll look janky since the search modal will
            // flash the new content right before the full page navigation.
            holdPeekTransition(
                navigate(path).then(() => {
                    markResultSelectAffinityInteraction(result.id);
                }),
            );
        } else {
            const spacePath = convertPeekPathToSpacePath(selectedPeek.history.location, {
                routeLayout: "wide",
            });
            if (!spacePath) throw new InternalError("Can only expand peek routes");

            // If the user double clicked there may be an ongoing pending transition
            // started by `onPressStart`. Don't switch to that transition while we're
            // waiting on a navigation. That'll look janky since the search modal will
            // flash the new content right before the full page navigation.
            holdPeekTransition(
                navigate(spacePath).then(() => {
                    markResultSelectAffinityInteraction(result.id);
                }),
            );
        }
    });

    const hasFavorites = output.type === "EmptyQuery";
    // NOCOMMIT: Use this
    const hasMoreFavoriteResults = hasFavorites && output.hasMoreFavoriteResults;
    const favoriteResults = hasFavorites ? output.favoriteResults : emptyArray;

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            if (hasFavorites) {
                if (index === 0) {
                    const fontSize = "75";
                    const paddingBottom = "1";

                    return {
                        key: "FavoritesHeader",
                        minHeight: addRemLengths(
                            searchEntityViewDefaultMarginX,
                            searchEntityViewDefaultPaddingX,
                            fontSizes[fontSize].lineHeight,
                            paddingBottom,
                        ),
                        node: (
                            <Box
                                paddingX={searchEntityViewDefaultMarginX}
                                paddingBottom={paddingBottom}
                                style={{
                                    paddingTop: addRemLengths(
                                        searchEntityViewDefaultMarginX,
                                        searchEntityViewDefaultPaddingX,
                                    ),
                                }}
                            >
                                <Box
                                    paddingX={searchEntityViewDefaultPaddingX}
                                    color="grey-50"
                                    fontSize={fontSize}
                                >
                                    Favorites
                                </Box>
                            </Box>
                        ),
                    };
                }

                index -= 1;

                if (index < favoriteResults.length) {
                    const result = favoriteResults[index]!;

                    return {
                        key: result.id,
                        minHeight: searchEntityViewMinHeightPx[spacingScale],
                        node: (
                            <SearchEntityView
                                result={result}
                                isSelected={result.id === selectedPeek?.extra.entityId}
                                // We use `onPressStart` to select so the selected style is applied immediately.
                                // We use the selected style to indicate interaction to the user instead of an
                                // `isPressed` style. The benefit of using selection is the previous item loses
                                // its style.
                                onPressStart={() => {
                                    if (result.id !== selectedPeek?.extra.entityId) {
                                        const path = getSearchEntityPath({
                                            spaceId: space.id,
                                            entityId: result.id,
                                            randomSeed: output.key,
                                            currentTime: output.queryTime,
                                            routeLayout: "narrow",
                                        });

                                        void switchPeek({
                                            spacePath: path,
                                            extra: {entityId: result.id},
                                        });
                                    }
                                }}
                                onDoubleClick={() => handleDoubleClick(result)}
                            />
                        ),
                    };
                }

                index -= favoriteResults.length;

                if (index === 0) {
                    const fontSize = "75";
                    const paddingBottom = "1";
                    const paddingTop = "4";

                    return {
                        key: "SuggestedHeader",
                        minHeight: addRemLengths(
                            paddingTop,
                            fontSizes[fontSize].lineHeight,
                            paddingBottom,
                        ),
                        node: (
                            <Box
                                paddingX={searchEntityViewDefaultMarginX}
                                paddingTop={paddingTop}
                                paddingBottom={paddingBottom}
                            >
                                <Box
                                    color="grey-50"
                                    fontSize={fontSize}
                                    paddingX={searchEntityViewDefaultPaddingX}
                                >
                                    Suggested
                                </Box>
                            </Box>
                        ),
                    };
                }

                index -= 1;
            }

            const result = output.results[index]!;

            const isFirstItem = !hasFavorites && index === 0;
            const isLastItem = index === output.results.length - 1;

            return {
                key: result.id,
                minHeight: searchEntityViewMinHeightPx[spacingScale],
                node: (
                    <SearchEntityView
                        result={result}
                        isSelected={result.id === selectedPeek?.extra.entityId}
                        withMarginTop={isFirstItem}
                        withMarginBottom={isLastItem}
                        // We use `onPressStart` to select so the selected style is applied immediately.
                        // We use the selected style to indicate interaction to the user instead of an
                        // `isPressed` style. The benefit of using selection is the previous item loses
                        // its style.
                        onPressStart={() => {
                            if (result.id !== selectedPeek?.extra.entityId) {
                                const path = getSearchEntityPath({
                                    spaceId: space.id,
                                    entityId: result.id,
                                    randomSeed: output.key,
                                    currentTime: output.queryTime,
                                    routeLayout: "narrow",
                                });

                                void switchPeek({
                                    spacePath: path,
                                    extra: {entityId: result.id},
                                });
                            }
                        }}
                        onDoubleClick={() => handleDoubleClick(result)}
                    />
                ),
            };
        },
        [
            favoriteResults,
            handleDoubleClick,
            hasFavorites,
            output.key,
            output.queryTime,
            output.results,
            selectedPeek?.extra.entityId,
            space.id,
            spacingScale,
            switchPeek,
        ],
    );

    return (
        <VirtualizedScrollView
            ref={viewRef}
            itemCount={
                (hasFavorites ? 2 + output.favoriteResults.length : 0) + output.results.length
            }
            bufferedItemHeight={searchEntityViewMinHeightPx[spacingScale]}
            renderItem={renderItem}
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

function SearchModalPeekContent({
    peek,
    onClose,
    pushPeekStack,
    switchPeek,
    markResultSelectAffinityInteraction,
}: {
    peek: PeekSwitcherStatePeek<{entityId: SearchEntityId}>;
    onClose: () => void;
    pushPeekStack: (to: To, options?: {focus?: boolean}) => Promise<void>;
    switchPeek: Memo<
        (
            peekData: {
                spacePath: string;
                extra: {entityId: SearchEntityId};
            } | null,
        ) => Promise<void>
    >;
    markResultSelectAffinityInteraction: (entityId: SearchEntityId) => void;
}) {
    if (!peek.routerResult.ok) throw peek.routerResult.error;
    const router = peek.routerResult.value;

    const navigate = useNavigate();

    const [historyPosition, setHistoryPosition] = useState(() => ({
        index: peek.history.index,
        entriesLength: peek.history.entries.length,
    }));

    useEffect(() => {
        const update = () => {
            setHistoryPosition(historyPosition => {
                const newHistoryPosition = {
                    index: peek.history.index,
                    entriesLength: peek.history.entries.length,
                };
                return !isDeepEqual(historyPosition, newHistoryPosition)
                    ? newHistoryPosition
                    : historyPosition;
            });
        };

        update();

        return router.subscribe(update);
    }, [peek.history, router]);

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
                // When setting `--safe-area-inset-top` we need to set
                // `--safe-area-inset-top-base` to the same value. Some code (e.g. inbox
                // notification banner) will need the base value to override
                // `--safe-area-inset-top`.
                //
                // @ts-expect-error: This sets the CSS variable but TypeScript doesn't
                // like it.
                "--safe-area-inset-top-base": spacing[searchModalPeekControlsHeight],
                "--safe-area-inset-top": spacing[searchModalPeekControlsHeight],
            }}
        >
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
                    paddingX="0.5"
                    display="flex"
                    justifyContent="flex-start"
                    alignItems="center"
                >
                    <IconButton
                        size="xs"
                        description="Go back"
                        tooltipPlacement="top"
                        isDisabled={!(historyPosition.index > 0)}
                        onPress={() => peek.history.go(-1)}
                    >
                        <ArrowLeft />
                    </IconButton>
                    <IconButton
                        size="xs"
                        description="Go forwards"
                        tooltipPlacement="top"
                        isDisabled={!(historyPosition.index < historyPosition.entriesLength - 1)}
                        onPress={() => peek.history.go(1)}
                    >
                        <ArrowRight />
                    </IconButton>
                </Box>
                <Box flexGrow="1" />
                <Box
                    flexShrink="0"
                    paddingX="0.5"
                    display="flex"
                    justifyContent="flex-start"
                    alignItems="center"
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
                        // We check `event.shiftKey`because this determines whether we open in a peek
                        // or navigate to full screen. Therefore we want the route not to open in a
                        // peek if `event.shiftKey` is pressed.
                        onPress={async event => {
                            const spacePath = convertPeekPathToSpacePath(peek.history.location, {
                                routeLayout: event.shiftKey ? "narrow" : "wide",
                            });
                            if (!spacePath) throw new InternalError("Can only expand peek routes");

                            if (isOpenLinkInSeparateTabPointerEvent(event, getClientInfo())) {
                                window.open(
                                    createPath(spacePath),
                                    "_blank",
                                    // Important security measure. See:
                                    // https://mathiasbynens.github.io/rel-noopener
                                    "noopener noreferrer",
                                );
                            } else if (event.shiftKey) {
                                await pushPeekStack(spacePath).finally(onClose);
                                markResultSelectAffinityInteraction(peek.extra.entityId);
                            } else {
                                await navigate(spacePath);
                                markResultSelectAffinityInteraction(peek.extra.entityId);
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
            <PeekRemixEmbed
                peekId={peek.id}
                layout="narrow"
                // Don't record view interactions when looking at a search entity in the search
                // modal. The user is discovering an entity to open so may have pretty low
                // intent when looking at an entity.
                //
                // This also means the "last opened" time we show for affinitive search entities
                // won't change.
                withoutSearchAffinityViewEntityInteraction={true}
                router={router}
                onGoBackOverflow={onClose}
            />
        </Box>
    );
}
