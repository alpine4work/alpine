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
import {usePress} from "react-aria";
import {flushSync} from "react-dom";
import {To, createPath} from "react-router";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ErrorBodyRenderer} from "~/client/web/design/error_body_renderer.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Modal} from "~/client/web/design/modal.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {isModifiedKeyboardEvent} from "~/client/web/helpers/events/is_modified_keyboard_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/web/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {useGlobalContext} from "~/client/web/helpers/global_context.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {PeekRemixEmbed} from "~/client/web/peek/peek_remix_embed.js";
import {
    PeekSwitcherStatePeek,
    PeekSwitcherStatePeekBase,
    usePeekSwitcherState,
} from "~/client/web/peek/use_peek_switcher_state.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {RpcCacheContext} from "~/client/web/rpc/rpc_cache.js";
import {forceRevalidateSearchByAffinity} from "~/client/web/search/core/force_revalidate_search_by_affinity.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {updateSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {SearchInstructionalPlaceholder} from "~/client/web/search/internal/search_instructional_placeholder.js";
import {SearchEntityView} from "~/client/web/search/search_entity_view.js";
import {SearchStateExecutionOutput, useSearchState} from "~/client/web/search/use_search_state.js";
import {SearchEntityShimmer} from "~/client/web/shimmer/search_entity_shimmer.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {
    searchEntityHeaderFontSize,
    searchEntityHeaderLineHeight,
    searchEntityHeaderPaddingTop,
    searchEntityViewDefaultMarginX,
    searchEntityViewDefaultPaddingX,
    searchEntityViewMinHeightPx,
    searchModalInputHeight,
    searchModalMaxHeight,
    searchModalMaxWidth,
} from "~/client/web/styles/search_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {Spacing, addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {convertPeekPathToSpacePath} from "~/shared/remix/peek_path_helpers.js";
import {
    clearSearchEntityAffinity,
    markSearchAffinityEntityInteraction,
    unfavoriteSearchEntity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {
    getSearchEntityPath,
    getSearchStaticEntityPath,
} from "~/shared/search/path/get_search_entity_path.js";
import {SearchEntityId, isSearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {
    SearchEntityModel,
    SearchEntityModelDataWithAccount,
    printSearchEntityWithAccountModelId,
} from "~/shared/search/search_entity_model.js";
import {SearchOptions} from "~/shared/search/search_options.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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
    const searchEntityRegistry = useSearchEntityRegistry();
    const accountRegistry = useAccountRegistry();

    const inputRef = useRef<HTMLInputElement>(null);

    // Immediately focus the search input.
    //
    // If the search input has some text (e.g. from the URL) then we select that text
    // so the user can immediately start a new search.
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
        initialPeekData: null,
    });

    // If the `output` changes such that our selected peek is no longer in the output
    // then:
    //
    // - If the item after the selected peek in the previous output exists move our
    //   selection to that item (e.g. when removing a suggested item)
    // - Otherwise clear the selected peek.
    const previousOutputRef = useRef(output);
    useLayoutEffectWithoutServerSideWarning(() => {
        const previousOutput = previousOutputRef.current;
        previousOutputRef.current = output;

        if (selectedPeek) {
            if (output.type === "EmptyQuery" && selectedPeek.extra.entityId === "SearchFavorites") {
                // Don't navigate away from favorites when we're viewing the affinity query. That
                // way if an update to favorites causes the "see all" button to disappear we won't
                // abruptly navigate the user away.
            } else if (!hasSearchEntityId(output, selectedPeek.extra.entityId)) {
                const nextEntity = getNextSearchEntity(previousOutput, selectedPeek.extra.entityId);
                if (!nextEntity) {
                    void switchPeek(null);
                } else {
                    // It's safe to use the snapshot while we are in a state transition. In this
                    // specific case, we are transition the peek view in the search modal to the next
                    // available entity.
                    const nextEntityDataSnapshot = getSearchEntityDataSnapshot(
                        nextEntity,
                        searchEntityRegistry,
                        accountRegistry,
                    );
                    const nextEntityId =
                        printSearchEntityWithAccountModelId(nextEntityDataSnapshot);

                    if (!hasSearchEntityId(output, nextEntityId)) {
                        void switchPeek(null);
                    } else {
                        const path = getSearchEntityPath({
                            spaceId: space.id,
                            entityData: nextEntityDataSnapshot,
                            randomSeed: output.key,
                            currentTime: output.queryTime,
                            routeLayout: "narrow",
                        });

                        void switchPeek({
                            spacePath: path,
                            extra: {entityId: nextEntityId},
                        });
                    }
                }
            }
        }
    }, [output, selectedPeek, searchEntityRegistry, space.id, switchPeek, accountRegistry]);

    const shouldShowInputLoadingIndicator =
        useDelayLoadingIndicator(output.isPending) &&
        // Only display a loading indicator on the input if we have results. Otherwise
        // we'll display a large loading indicator in the result list while we wait for
        // results to load.
        !!output.results;

    // Whenever the user selects a search result, we record a high intent affinity
    // interaction. This is because the user opening a result from search is super high
    // signal that this is an entity they care about. In this way search is a self
    // reinforcing system. The more a user selects an entity, the higher the entity
    // will appear in the user's next search.
    const markResultSelectAffinityInteraction = useCallback(
        (entityId: SearchEntityId) => {
            if (!isSearchAffinityEntityId(entityId)) return;

            markSearchAffinityEntityInteraction(context, {
                spaceId: space.id,
                entityId,
                interaction: {type: "HighIntentUpdate"},
                // Skip the site cascade here. The search modal doesn't carry the result's access
                // policy, and once the user lands on the entity its own view-time affinity hook
                // will fire (with a known siteId) — so engagement with the entity still flows to
                // the site.
                siteId: null,
            }).catch(error => {
                // Silently fail. This doesn't affect anything the user sees so we don't need to
                // report the error to the user.
                reporter.logErrorWithoutDisplaying(
                    "Couldn\u2019t mark search result select affinity interaction",
                    error,
                );
            });
        },
        [context, reporter, space.id],
    );

    const handleArrowKeyDownNavigation = (key: "ArrowUp" | "ArrowDown") => {
        // Data hasn't loaded yet, we can't select anything.
        if (!output.results) return;

        let entity: SearchEntityModel | AccountModel | null = null;

        if (!selectedPeek) {
            // NOTE(calebmer): Notably, pressing down when `output.hasMoreFavoriteResults` is
            // true and there's no selected result does not select the "see all" button. But
            // pressing down will select the first favorite item then pressing up will select
            // the "see all" button. This is because we believe keyboard navigation to the "see
            // all" button is significantly less likely then navigating to the first favorite
            // item.
            if (
                output.type === "EmptyQuery" &&
                output.favoriteResults &&
                output.favoriteResults.length > 0
            ) {
                entity = output.favoriteResults[0]!.model;
            } else if (output.results.length > 0) {
                entity = output.results[0]!.model;
            }
        } else if (key === "ArrowUp") {
            entity = getPreviousSearchEntity(output, selectedPeek.extra.entityId);
        } else {
            entity = getNextSearchEntity(output, selectedPeek.extra.entityId);
        }

        // There is no next item. Do nothing. Don't loop around since we may have many
        // items so looping would be disorienting.
        if (entity === null) return;

        // It's safe to use the snapshot during a state transition. In this specific case,
        // we are transitioning the peek view in the search modal to the previous or next
        // entity.
        const entityDataSnapshot = getSearchEntityDataSnapshot(
            entity,
            searchEntityRegistry,
            accountRegistry,
        );

        const path = getSearchEntityPath({
            spaceId: space.id,
            entityData: entityDataSnapshot,
            randomSeed: output.key,
            currentTime: output.queryTime,
            routeLayout: "narrow",
        });

        void switchPeek({
            spacePath: path,
            extra: {entityId: printSearchEntityWithAccountModelId(entityDataSnapshot)},
        });
    };

    const handleOpenEntityInPeekStack = useCallback(
        async (entityData: SearchEntityModelDataWithAccount, options?: {focus?: boolean}) => {
            const path = getSearchEntityPath({
                spaceId: space.id,
                entityData,
                randomSeed: output.key,
                currentTime: output.queryTime,
                routeLayout: "narrow",
            });
            await pushPeekStack(path, options).finally(onClose);
            markResultSelectAffinityInteraction(printSearchEntityWithAccountModelId(entityData));
        },
        [
            markResultSelectAffinityInteraction,
            onClose,
            pushPeekStack,
            space.id,
            output.key,
            output.queryTime,
        ],
    );

    const [withoutBorderRadiusForDev, setWithoutBorderRadiusForDev] = useState(false);

    useDevConsoleTool("searchModal", () => ({
        toggleBorderRadius: () => {
            // Change visibility synchronously so when taking a screenshot we don't have to
            // wait for React to re-render.
            flushSync(() => {
                setWithoutBorderRadiusForDev(hasBorderRadius => !hasBorderRadius);
            });
        },
    }));

    return (
        <Modal
            aria-label="Search"
            maxWidth={searchModalMaxWidth}
            height="full"
            maxHeight={searchModalMaxHeight}
            borderRadius={withoutBorderRadiusForDev ? "none" : "2.5"}
            withoutCloseButton={true}
            // Don't animate the search modal open. The search modal is generally opened by a
            // user with direct intent to search. The search modal is a critical part of the
            // Alpine workflow. Slowing down the search workflow for even a 200ms animation
            // will make the product feel less snappy.
            withoutOpenAnimation={true}
            onClose={onClose}
        >
            {debugOptions && (
                // Show a debug mode indicator when we're using debug options to search. Since we
                // may not show explanation badges on search results.
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
                        // The first escape press should clear search. The second escape press should close
                        // the modal. It's important that this `<GlobalKeyDownEvent>` is a child of
                        // `<Modal>`! That way we run our escape handler first.
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

                            // If focus is within a text input element (e.g. we have a document peek open) then
                            // arrow key presses are for text editing.
                            //
                            // However, if focus is in our search input element then arrow key presses are for
                            // navigation.
                            if (
                                document.activeElement !== inputElement &&
                                isTextInputElement(document.activeElement)
                            ) {
                                break;
                            }

                            event.stopPropagation();
                            event.preventDefault();

                            handleArrowKeyDownNavigation(event.key);
                            break;
                        }

                        case "Enter": {
                            const inputElement = assertExists(inputRef.current);

                            // Ignore modified arrow up/down events like cmd-down which scrolls.
                            if (isModifiedKeyboardEvent(event)) break;

                            // If focus is within a text input element (e.g. we have a document peek open) then
                            // arrow key presses are for text editing.
                            //
                            // However, if focus is in our search input element then arrow key presses are for
                            // navigation.
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

                            // Open the selected peek when `Enter` is pressed. You've probably just selected a
                            // peek with the keyboard.
                            //
                            // We check `event.shiftKey` because this determines whether we open in a peek or
                            // navigate to full screen. Therefore we want the route not to open in a peek if
                            // `event.shiftKey` is pressed.
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
                    data-testid="SearchModal"
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
                                                title="Couldn&#x2019;t get search results"
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
                                        <Box padding={searchEntityViewDefaultMarginX}>
                                            <Box
                                                color="grey-50"
                                                padding={searchEntityViewDefaultPaddingX}
                                                style={contentStyles.paragraphFontSize}
                                            >
                                                {queryText.trim().length === 0 ? (
                                                    <>
                                                        As you explore, content you&#x2019;ve
                                                        recently visited will show up here. For now,
                                                        try searching.
                                                    </>
                                                ) : (
                                                    <>
                                                        Couldn&#x2019;t find anything matching
                                                        &#x201C;
                                                        <span
                                                            className={sprinkles({
                                                                color: "grey-70",
                                                                fontStyle: "bold",
                                                            })}
                                                        >
                                                            {queryText}
                                                        </span>
                                                        .&#x201D; Try a different search?
                                                    </>
                                                )}
                                            </Box>
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
                                            handleOpenEntityInPeekStack={
                                                handleOpenEntityInPeekStack
                                            }
                                        />
                                    )}
                                </Box>
                            ),
                            [
                                handleOpenEntityInPeekStack,
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
                                    position="relative"
                                    width={peekNarrowLayoutWidth}
                                    height="full"
                                    overflow="hidden"
                                >
                                    <Box
                                        zIndex="10"
                                        position="absolute"
                                        bottom="0"
                                        left="0"
                                        width="border"
                                        backgroundColor="grey-5-translucent"
                                        style={{
                                            // Render border 1px down so the two semi transparent borders don't conflict with
                                            // each other creating a single pixel that's darker where they intersect.
                                            top: 1,
                                        }}
                                    />
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
                // Render border with a semi-transparent box shadow so that we get a nice soft
                // shadow effect when content from the search result list scrolls under the border
                // instead of a hard cutoff.
                boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5-translucent"]}`,
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
                // NOTE(calebmer): There's no `<FocusRing>` on this input or the search modal list
                // since it should all be obviously keyboard navigable without needing extra
                // affordance.
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
                    // eslint-disable-next-line cyberworlds/string-quotes
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
    handleOpenEntityInPeekStack,
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
    handleOpenEntityInPeekStack: (
        entity: SearchEntityModelDataWithAccount,
        options?: {focus?: boolean},
    ) => Promise<void>;
}) {
    const spacingScale = useSpacingScale();
    const navigate = useNavigate();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const rpcCache = useGlobalContext(RpcCacheContext);

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const lastSelectedResultIdRef = useRef(selectedPeek?.extra.entityId);
    useLayoutEffectWithoutServerSideWarning(() => {
        const view = assertExists(viewRef.current);

        if (lastSelectedResultIdRef.current === selectedPeek?.extra.entityId) return;
        lastSelectedResultIdRef.current = selectedPeek?.extra.entityId;

        // When a new result is selected, make sure it is visible in our scroll window.
        // Scroll to it if it is not visible.
        if (selectedPeek?.extra.entityId) {
            view.scrollToKeyIfExists(selectedPeek.extra.entityId, {withAnchor: true});
        }
    }, [selectedPeek?.extra.entityId]);

    const handleDoubleClick = useEvent((entityData: SearchEntityModelDataWithAccount) => {
        const entityId = printSearchEntityWithAccountModelId(entityData);
        if (entityId !== selectedPeek?.extra.entityId) {
            const path = getSearchEntityPath({
                spaceId: space.id,
                entityData,
                randomSeed: output.key,
                currentTime: output.queryTime,
                routeLayout: "wide",
            });

            // If the user double clicked there may be an ongoing pending transition started by
            // `onPressStart`. Don't switch to that transition while we're waiting on a
            // navigation. That'll look janky since the search modal will flash the new content
            // right before the full page navigation.
            holdPeekTransition(
                navigate(path).then(() => {
                    markResultSelectAffinityInteraction(entityId);
                }),
            );
        } else {
            const spacePath = convertPeekPathToSpacePath(selectedPeek.history.location, {
                routeLayout: "wide",
            });
            if (!spacePath) throw new InternalError("Can only expand peek routes");

            // If the user double clicked there may be an ongoing pending transition started by
            // `onPressStart`. Don't switch to that transition while we're waiting on a
            // navigation. That'll look janky since the search modal will flash the new content
            // right before the full page navigation.
            holdPeekTransition(
                navigate(spacePath).then(() => {
                    markResultSelectAffinityInteraction(entityId);
                }),
            );
        }
    });

    const hasFavorites =
        output.type === "EmptyQuery" &&
        (output.hasMoreFavoriteResults || output.favoriteResults.length > 0);
    const hasMoreFavoriteResults = hasFavorites && output.hasMoreFavoriteResults;
    const favoriteResults = hasFavorites ? output.favoriteResults : emptyArray;

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            if (hasFavorites) {
                if (index === 0) {
                    return {
                        key: "FavoritesHeader",
                        minHeight: addRemLengths(
                            searchEntityHeaderPaddingTop,
                            searchEntityHeaderLineHeight,
                        ),
                        node: (
                            <Box
                                paddingTop={searchEntityHeaderPaddingTop}
                                paddingX={searchEntityViewDefaultMarginX}
                            >
                                <Box
                                    paddingX={searchEntityViewDefaultPaddingX}
                                    color="grey-50"
                                    fontSize={searchEntityHeaderFontSize}
                                    style={{lineHeight: spacing[searchEntityHeaderLineHeight]}}
                                >
                                    Favorites
                                    {hasMoreFavoriteResults && (
                                        // Intentionally using [U+2219 (bullet operator)][1] instead of [U+2022
                                        // (bullet)][2] since the former is thinner.
                                        //
                                        // A bullet separator here is nicer than parentheses like "(see all)" since the
                                        // parentheses draw a lot of attention.
                                        //
                                        // [1]: https://graphemica.com/%E2%88%99
                                        // [2]: https://graphemica.com/%E2%80%A2
                                        <>
                                            {"\u2009\u2219\u2009"}
                                            <SearchModalFavoritesHeaderSeeMoreButton
                                                isSelected={
                                                    selectedPeek?.extra.entityId ===
                                                    "SearchFavorites"
                                                }
                                                onPressStart={() => {
                                                    if (
                                                        selectedPeek?.extra.entityId ===
                                                        "SearchFavorites"
                                                    ) {
                                                        return;
                                                    }

                                                    const path = getSearchStaticEntityPath({
                                                        spaceId: space.id,
                                                        entityId: "SearchFavorites",
                                                        randomSeed: output.key,
                                                        currentTime: output.queryTime,
                                                    });

                                                    void switchPeek({
                                                        spacePath: path,
                                                        extra: {entityId: "SearchFavorites"},
                                                    });
                                                }}
                                            />
                                        </>
                                    )}
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
                                // We use `onPressStart` to select so the selected style is applied immediately. We
                                // use the selected style to indicate interaction to the user instead of an
                                // `isPressed` style. The benefit of using selection is the previous item loses its
                                // style.
                                onPressStart={entityData => {
                                    if (result.id !== selectedPeek?.extra.entityId) {
                                        const path = getSearchEntityPath({
                                            spaceId: space.id,
                                            entityData,
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
                                onDoubleClick={entityData => {
                                    handleDoubleClick(entityData);
                                }}
                                getCopyPath={entityData => {
                                    return getSearchEntityPath({
                                        spaceId: space.id,
                                        entityData,
                                        randomSeed: output.key,
                                        currentTime: output.queryTime,
                                        routeLayout: "wide",
                                    });
                                }}
                                onOpenInPeekStack={entityData =>
                                    handleOpenEntityInPeekStack(entityData)
                                }
                                onRemoveFromFavorites={async () => {
                                    await unfavoriteSearchEntity(context, {
                                        spaceId: space.id,
                                        entityId: result.id,
                                    });

                                    // This is very race condition prone. But it's good enough for this
                                    // non-collaborative use case. _Shrug_
                                    updateSearchFavoriteEntityMenuAction(
                                        space.id,
                                        result.id,
                                        false,
                                    );

                                    forceRevalidateSearchByAffinity(
                                        context,
                                        rpcCache,
                                        space.id,
                                        "removing favorite in search modal",
                                        output => {
                                            // Test that the item was removed from `favoriteResults`.
                                            return !output.favoriteResults.some(
                                                otherResult => otherResult.id === result.id,
                                            );
                                        },
                                    );
                                }}
                            />
                        ),
                    };
                }

                index -= favoriteResults.length;

                if (index === 0) {
                    return {
                        key: "SuggestedHeader",
                        minHeight: addRemLengths(
                            searchEntityHeaderPaddingTop,
                            searchEntityHeaderLineHeight,
                        ),
                        node: (
                            <Box
                                paddingX={searchEntityViewDefaultMarginX}
                                paddingTop={searchEntityHeaderPaddingTop}
                            >
                                <Box
                                    paddingX={searchEntityViewDefaultPaddingX}
                                    color="grey-50"
                                    fontSize={searchEntityHeaderFontSize}
                                    style={{lineHeight: spacing[searchEntityHeaderLineHeight]}}
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
                        // We use `onPressStart` to select so the selected style is applied immediately. We
                        // use the selected style to indicate interaction to the user instead of an
                        // `isPressed` style. The benefit of using selection is the previous item loses its
                        // style.
                        onPressStart={entityData => {
                            if (result.id !== selectedPeek?.extra.entityId) {
                                const path = getSearchEntityPath({
                                    spaceId: space.id,
                                    entityData,
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
                        onDoubleClick={entityData => {
                            handleDoubleClick(entityData);
                        }}
                        getCopyPath={entityData => {
                            return getSearchEntityPath({
                                spaceId: space.id,
                                entityData,
                                randomSeed: output.key,
                                currentTime: output.queryTime,
                                routeLayout: "wide",
                            });
                        }}
                        onOpenInPeekStack={entityData => handleOpenEntityInPeekStack(entityData)}
                        onRemoveFromSuggested={
                            output.type === "EmptyQuery"
                                ? async () => {
                                      // Since `output.type === "EmptyQuery"` here, `output` will return search affinity
                                      // entities.
                                      const result = output.results[index]!;

                                      await clearSearchEntityAffinity(context, {
                                          spaceId: space.id,
                                          entityId: result.id,
                                      });

                                      forceRevalidateSearchByAffinity(
                                          context,
                                          rpcCache,
                                          space.id,
                                          "removing suggestion in search modal",
                                          output => {
                                              // Test that the item was removed from `results`.
                                              return !output.results.some(
                                                  otherResult => otherResult.id === result.id,
                                              );
                                          },
                                      );
                                  }
                                : undefined
                        }
                    />
                ),
            };
        },
        [
            context,
            favoriteResults,
            handleDoubleClick,
            handleOpenEntityInPeekStack,
            hasFavorites,
            hasMoreFavoriteResults,
            output.key,
            output.queryTime,
            output.results,
            output.type,
            rpcCache,
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
                // Our items all have a bottom border. This is good when there's less content than
                // room to scroll since it creates a clear shape for the last item in the list.
                //
                // However, if there are enough items to scroll then when the user has fully
                // scrolled we want the last item to _not_ have a border bottom since the bottom of
                // the screen creates that boundary. We don't need to render an extra line in the
                // margins.
                //
                // This div covers the bottom border of the last item but only when there's enough
                // content to scroll. Otherwise the bottom border needs to be visible to visually
                // contain the last item. To debug this it's helpful to switch the
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
            data-testid="SearchModalPeek"
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
                        // TODO(calebmer): I think this is the only place in the product we name the peek
                        // concept. For now, I'm calling it "preview". We should make sure documentation,
                        // marketing, and other copy in the product align with this name. If we decide to
                        // call it something else publicly, this needs to be renamed.
                        tooltipContentOverride="Shift-click to open in peek"
                        pressErrorTitle="Couldn&#x2019;t expand"
                        // We check `event.shiftKey`because this determines whether we open in a peek or
                        // navigate to full screen. Therefore we want the route not to open in a peek if
                        // `event.shiftKey` is pressed.
                        onPress={async event => {
                            const spacePath = convertPeekPathToSpacePath(peek.history.location, {
                                routeLayout: event.shiftKey ? "narrow" : "wide",
                            });
                            if (!spacePath) throw new InternalError("Can only expand peek routes");

                            if (isOpenLinkInSeparateTabPointerEvent(event, getClientInfo())) {
                                window.open(
                                    createPath(spacePath),
                                    "_blank",
                                    // Important security measure. See: https://mathiasbynens.github.io/rel-noopener
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
                        pressErrorTitle="Couldn&#x2019;t dismiss"
                        onPress={() => switchPeek(null)}
                    >
                        <X />
                    </IconButton>
                </Box>
            </Box>
            <ContentBlockWidthContextProvider width={peekNarrowLayoutWidth}>
                <PeekRemixEmbed
                    peekId={peek.id}
                    layout="narrow"
                    // Don't record view interactions when looking at a search entity in the search
                    // modal. The user is discovering an entity to open so may have pretty low intent
                    // when looking at an entity.
                    //
                    // This also means the "last opened" time we show for affinitive search entities
                    // won't change.
                    withoutSearchAffinityViewEntityInteraction={true}
                    router={router}
                    onGoBackOverflow={onClose}
                />
            </ContentBlockWidthContextProvider>
        </Box>
    );
}

function SearchModalFavoritesHeaderSeeMoreButton({
    isSelected,
    onPressStart,
}: {
    isSelected: boolean;
    onPressStart: () => void;
}) {
    const {pressProps} = usePress({onPressStart});

    return (
        <Box
            {...pressProps}
            display="inline"
            // We don't usually use a pointer cursor for pressable things but in this case it's
            // not obvious this text is interactive without it.
            cursor="pointer"
            color={isSelected ? "grey-100" : undefined}
            backgroundColor={isSelected ? "grey-5" : undefined}
            paddingX="1"
            paddingY="1"
            borderRadius="1"
            position="relative"
            left="-1"
        >
            see all
        </Box>
    );
}

function hasSearchEntityId(
    output: SearchStateExecutionOutput,
    selectedEntityId: SearchEntityId,
): boolean {
    if (!output.results) return false;

    // Handle the case when you've selected "See all" in the favorites header then hit
    // `ArrowUp`.
    if (output.type === "EmptyQuery" && output.hasMoreFavoriteResults) {
        if (selectedEntityId === "SearchFavorites") {
            return true;
        }
    }

    if (output.type === "EmptyQuery" && output.favoriteResults) {
        for (let i = 0; i < output.favoriteResults.length; i++) {
            const result = output.favoriteResults[i]!;
            if (result.id === selectedEntityId) {
                return true;
            }
        }
    }

    for (let i = 0; i < output.results.length; i++) {
        const result = output.results[i]!;
        if (result.id === selectedEntityId) {
            return true;
        }
    }

    return false;
}

function getPreviousSearchEntity(
    output: SearchStateExecutionOutput,
    selectedEntityId: SearchEntityId,
): SearchEntityModel | AccountModel | null {
    // Data hasn't loaded yet, we can't select anything.
    if (!output.results) return null;

    let previousEntity: SearchEntityModel | AccountModel | null = null;

    // Handle the case when you've selected "See all" in the favorites header then hit
    // `ArrowUp`.
    if (output.type === "EmptyQuery" && output.hasMoreFavoriteResults) {
        if (selectedEntityId === "SearchFavorites") {
            return null;
        } else {
            previousEntity = new SearchEntityModel({
                type: "Static",
                id: "SearchFavorites",
                title: null,
            });
        }
    }

    if (output.type === "EmptyQuery" && output.favoriteResults) {
        for (let i = 0; i < output.favoriteResults.length; i++) {
            const result = output.favoriteResults[i]!;
            if (result.id === selectedEntityId) {
                return previousEntity;
            }
            previousEntity = result.model;
        }
    }

    for (let i = 0; i < output.results.length; i++) {
        const result = output.results[i]!;
        if (result.id === selectedEntityId) {
            return previousEntity;
        }
        previousEntity = result.model;
    }

    return null;
}

function getNextSearchEntity(
    output: SearchStateExecutionOutput,
    selectedEntityId: SearchEntityId,
): SearchEntityModel | AccountModel | null {
    // Data hasn't loaded yet, we can't select anything.
    if (!output.results) return null;

    let nextEntity: SearchEntityModel | AccountModel | null = null;

    for (let i = output.results.length - 1; i >= 0; i--) {
        const previousResult = output.results[i]!;
        if (previousResult.id === selectedEntityId) {
            return nextEntity;
        }
        nextEntity = previousResult.model;
    }

    if (output.type === "EmptyQuery" && output.favoriteResults) {
        for (let i = output.favoriteResults.length - 1; i >= 0; i--) {
            const previousResult = output.favoriteResults[i]!;
            if (previousResult.id === selectedEntityId) {
                return nextEntity;
            }
            nextEntity = previousResult.model;
        }
    }

    // Handle the case when you've selected "See all" in the favorites header then hit
    // `ArrowDown`.
    if (output.type === "EmptyQuery" && output.hasMoreFavoriteResults) {
        if (selectedEntityId === "SearchFavorites") {
            return nextEntity;
        }
    }

    return null;
}

function getSearchEntityDataSnapshot(
    entity: SearchEntityModel | AccountModel,
    searchEntityRegistry: SearchEntityRegistry,
    accountRegistry: AccountRegistry,
): SearchEntityModelDataWithAccount {
    if (entity instanceof SearchEntityModel) {
        return searchEntityRegistry.getEntityStore(entity).getSnapshot();
    } else {
        const accountData = accountRegistry.getAccountStore(entity).getSnapshot();
        return {
            type: "Account",
            account: entity,
            title: accountData.name,
        };
    }
}
