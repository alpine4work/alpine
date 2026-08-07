import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    SortingStrategy,
    rectSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import {setInteractionModality} from "@react-aria/interactions";
import {DotsSixVertical, Link as LinkIcon} from "phosphor-react";
import {
    Fragment,
    KeyboardEvent as SyntheticKeyboardEvent,
    PointerEvent as SyntheticPointerEvent,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import {createPortal} from "react-dom";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ContextMenuActions, useContextMenuActions} from "~/client/web/design/context_menu.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useGlobalContext} from "~/client/web/helpers/global_context.js";
import {useInitialAppRenderId} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {RpcCacheContext} from "~/client/web/rpc/rpc_cache.js";
import {forceRevalidateSearchByAffinity} from "~/client/web/search/core/force_revalidate_search_by_affinity.js";
import {useSearchEntityModel} from "~/client/web/search/core/search_entity_registry_context.js";
import {
    subscribeToUpdateSearchFavoriteEntityMenuAction,
    updateSearchFavoriteEntityMenuAction,
} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {SearchAffinityEntityView} from "~/client/web/search/search_affinity_entity_view.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityViewDefaultPaddingX,
} from "~/client/web/styles/search_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {screenPaddingX, spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    moveSearchFavoriteEntity,
    unfavoriteSearchEntity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {updateSpaceAccountSettings} from "~/shared/rpc/spaces_rpc_definitions.js";
import {getSearchEntityPath} from "~/shared/search/path/get_search_entity_path.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {SearchFavoriteEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {
    searchShortcutFavoriteEntityMaxCount,
    searchShortcutFavoriteEntityMinCount,
} from "~/shared/spaces/space_account_settings.js";

const screenPaddingXWithoutSearchEntityViewPaddingX = mapObjectValues(
    screenPaddingX,
    screenPaddingX => subtractRemLengths(screenPaddingX, searchEntityViewDefaultPaddingX),
);

export function SearchFavoritesView({
    initialShortcutFavoriteEntityCount,
    initialResults,
}: {
    initialShortcutFavoriteEntityCount: number;
    initialResults: ReadonlyArray<SearchFavoriteEntityResultModel>;
}) {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();
    const rpcCache = useGlobalContext(RpcCacheContext);

    const maxWidth = routeLayout !== "narrow" ? peekNarrowLayoutWidth : undefined;

    const [shortcutFavoriteEntityCount, , updateShortcutFavoriteEntityCountOptimistically] =
        useStateWithOptimisticUpdates(initialShortcutFavoriteEntityCount);

    const [results, updateResults, updateResultsOptimistically] =
        useStateWithOptimisticUpdates(initialResults);

    // If some other code unfavorites an entity while `<SearchFavoritesView>` is
    // mounted then remove it from our state. This mainly exists to support the mobile
    // workflow of:
    //
    // 1. Navigate to favorites view
    // 2. Navigating to an entity within the favorites view
    // 3. Unfavoriting that entity
    // 4. Pop navigation back to favorites view
    useEffect(() => {
        return subscribeToUpdateSearchFavoriteEntityMenuAction((spaceId, entityId, isFavorite) => {
            // Ignore favorite actions since we don't have the full entity data. Only subscribe
            // to unfavorite actions.
            if (isFavorite) return;

            if (spaceId !== space.id) return;

            updateResults(results => results.filter(result => result.id !== entityId));
        });
    }, [space.id, updateResults]);

    const pointerSensor = useSensor(
        PointerSensor,
        // Needs to be `useMemo()`d to avoid unnecessary re-renders.
        // https://github.com/clauderic/dnd-kit/blob/00f749bc0cc3e6582f4f887f64c1f1de65ee0081/packages/core/src/sensors/useSensor.ts#L15
        useMemo(
            () => ({
                activationConstraint: {
                    // The pointer must move to activate dragging. That way a plain click can be used
                    // to open the favorite.
                    distance: 2,
                },
            }),
            [],
        ),
    );

    const keyboardSensor = useSensor(
        KeyboardSensor,
        // Needs to be `useMemo()`d to avoid unnecessary re-renders.
        // https://github.com/clauderic/dnd-kit/blob/00f749bc0cc3e6582f4f887f64c1f1de65ee0081/packages/core/src/sensors/useSensor.ts#L15
        useMemo(
            () => ({
                keyboardCodes: {
                    // Instead of starting the keyboard drag with the default "Enter" or "Space" keys,
                    // we start the drag with the "m" key. That way the default "Enter" or "Space" key
                    // can be used to navigate to the favorite.
                    start: ["KeyM"],
                    cancel: ["Escape"],
                    end: ["Space", "Enter", "Tab"],
                },
                onActivation: () => {
                    // If we activate the keyboard sensor, make sure we switch to a keyboard
                    // interaction modality.
                    setInteractionModality("keyboard");
                },
            }),
            [],
        ),
    );

    const sensors = useSensors(pointerSensor, keyboardSensor);

    const shortcutDividerIndex = Math.min(shortcutFavoriteEntityCount - 1, results.length - 1);

    const handleDragEnd = (event: DragEndEvent) => {
        const {active, over} = event;
        if (!over || active.id === over.id) return;

        if (active.id === "ShortcutDivider") {
            const oldShortcutFavoriteEntityCount = shortcutFavoriteEntityCount;

            let newShortcutFavoriteEntityCount = results.findIndex(result => result.id === over.id);
            if (newShortcutFavoriteEntityCount > shortcutDividerIndex)
                newShortcutFavoriteEntityCount++;
            newShortcutFavoriteEntityCount = clamp(
                searchShortcutFavoriteEntityMinCount,
                newShortcutFavoriteEntityCount,
                searchShortcutFavoriteEntityMaxCount,
            );

            if (oldShortcutFavoriteEntityCount === newShortcutFavoriteEntityCount) {
                return;
            }

            const movePromise = updateSpaceAccountSettings(context, {
                spaceId: space.id,
                update: {
                    searchShortcutFavoriteEntityCount: newShortcutFavoriteEntityCount,
                },
            });

            // 1. Show an error if the update fails. Refetch search affinity list if the update
            //    succeeds.
            movePromise.then(
                () => {
                    forceRevalidateSearchByAffinity(
                        context,
                        rpcCache,
                        space.id,
                        "moving shortcut divider in favorites view",
                        output => {
                            // Test if the shortcut count grew or shrunk in the expected direction.
                            return (
                                Math.sign(
                                    oldShortcutFavoriteEntityCount - newShortcutFavoriteEntityCount,
                                ) ===
                                Math.sign(
                                    oldShortcutFavoriteEntityCount - output.favoriteResults.length,
                                )
                            );
                        },
                    );
                },
                error => {
                    reporter.displayError("Couldn\u2019t move shortcut divider", error);
                },
            );

            // 2. Show a loading indicator if the update takes a while (this will also stop the
            //    user from closing the browser).
            addGlobalLoadingIndicator(movePromise, {type: "Saving"});

            // 3. Optimistically update our `results` state. Will revert the update if the
            //    promise rejects.
            updateShortcutFavoriteEntityCountOptimistically(
                movePromise,
                () => newShortcutFavoriteEntityCount,
            );
            return;
        }

        const activeIndex = results.findIndex(result => result.id === active.id);
        const overIndex = results.findIndex(result => result.id === over.id);
        assert(activeIndex >= 0);
        assert(overIndex >= 0);

        const newBeforeResult =
            activeIndex >= overIndex
                ? assertExists(results[overIndex])
                : overIndex < results.length - 1
                  ? assertExists(results[overIndex + 1])
                  : null;
        const newAfterResult =
            activeIndex < overIndex
                ? assertExists(results[overIndex])
                : overIndex > 0
                  ? assertExists(results[overIndex - 1])
                  : null;

        const newFavoriteOrderKey = generateOrderKeyBetween(
            newAfterResult?.favoriteOrderKey ?? null,
            newBeforeResult?.favoriteOrderKey ?? null,
        );

        const movePromise = moveSearchFavoriteEntity(context, {
            spaceId: space.id,
            entityId: active.id as SearchAffinityEntityId,
            orderKey: newFavoriteOrderKey,
        });

        // 1. Show an error if the update fails. Refetch search affinity list if the update
        //    succeeds.
        movePromise.then(
            () => {
                // We're moving an item below the shortcut divider to a position also below the
                // shortcut divider. The search affinity list doesn't need to update.
                if (
                    activeIndex >= shortcutFavoriteEntityCount &&
                    overIndex >= shortcutFavoriteEntityCount
                ) {
                    return;
                }

                forceRevalidateSearchByAffinity(
                    context,
                    rpcCache,
                    space.id,
                    "moving favorite in favorites view",
                    output => {
                        if (
                            activeIndex >= shortcutFavoriteEntityCount &&
                            overIndex < shortcutFavoriteEntityCount
                        ) {
                            // Test that the item was added to `favoriteResults`.
                            if (output.favoriteResults.some(result => result.id === active.id)) {
                                return true;
                            }
                        } else if (
                            activeIndex < shortcutFavoriteEntityCount &&
                            overIndex >= shortcutFavoriteEntityCount
                        ) {
                            // Test that the item was removed from `favoriteResults`.
                            if (!output.favoriteResults.some(result => result.id === active.id)) {
                                return true;
                            }
                        } else {
                            // This assert should be safe since we return above if
                            // `activeIndex >= shortcutFavoriteEntityCount && overIndex >= shortcutFavoriteEntityCount`.
                            // So this is the last possible combination to test for.
                            assert(
                                activeIndex < shortcutFavoriteEntityCount &&
                                    overIndex < shortcutFavoriteEntityCount,
                            );

                            const newActiveIndex = output.favoriteResults.findIndex(
                                result => result.id === active.id,
                            );

                            // Test that the item moved in the right direction within `favoriteResults`.
                            if (
                                newActiveIndex !== -1 &&
                                Math.sign(activeIndex - overIndex) ===
                                    Math.sign(activeIndex - newActiveIndex)
                            ) {
                                return true;
                            }
                        }

                        return false;
                    },
                );
            },
            error => {
                reporter.displayError("Couldn\u2019t move favorite", error);
            },
        );

        // 2. Show a loading indicator if the update takes a while (this will also stop the
        //    user from closing the browser).
        addGlobalLoadingIndicator(movePromise, {type: "Saving"});

        // 3. Optimistically update our `results` state. Will revert the update if the
        //    promise rejects.
        updateResultsOptimistically(movePromise, oldResults => {
            const newResults = oldResults
                .map(oldResult => {
                    if (oldResult.id !== active.id) return oldResult;
                    return {
                        ...oldResult,
                        favoriteOrderKey: newFavoriteOrderKey,
                    };
                })
                .sort((result1, result2) =>
                    defaultCompareStrings(result1.favoriteOrderKey, result2.favoriteOrderKey),
                );

            return newResults;
        });
    };

    const lastDragOverIdRef = useRef<string | number | null>(null);

    return (
        <SpaceRouteScrollView
            title="Favorites"
            desktopTitleFontSize="400"
            desktopTitleFontWeight="bold"
            withoutDisappearingTitle={true}
            desktopMaxWidth={maxWidth}
        >
            <Box position="relative" zIndex="0" width="full" maxWidth={maxWidth} marginX="center">
                <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="flex-start"
                    paddingX={screenPaddingX}
                    style={{height: searchAffinityEntityViewMinHeightPx[spacingScale] / 2}}
                >
                    <Box width="full" height="border" backgroundColor="grey-5-translucent" />
                </Box>
                <Box
                    style={{
                        paddingLeft:
                            platform !== "mobile"
                                ? screenPaddingXWithoutSearchEntityViewPaddingX[platform]
                                : undefined,
                        paddingRight:
                            platform !== "mobile"
                                ? screenPaddingXWithoutSearchEntityViewPaddingX[platform]
                                : undefined,
                    }}
                >
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        onDragStart={() => {
                            lastDragOverIdRef.current = null;
                        }}
                        onDragMove={({over}: DragEndEvent) => {
                            if (over !== null) {
                                if (lastDragOverIdRef.current === null) {
                                    lastDragOverIdRef.current = over.id;
                                } else if (lastDragOverIdRef.current !== over.id) {
                                    lastDragOverIdRef.current = over.id;

                                    // Whenever we're dragging over something new, play the selection changed haptic
                                    // feedback.
                                    NativeMobileBridge?.haptic.playSelectionChanged();
                                }
                            }
                        }}
                    >
                        <SearchFavoritesViewInner
                            shortcutDividerIndex={shortcutDividerIndex}
                            results={results}
                            updateResults={updateResults}
                        />
                    </DndContext>
                </Box>
            </Box>
        </SpaceRouteScrollView>
    );
}

function SearchFavoritesViewInner({
    results,
    updateResults,
    shortcutDividerIndex,
}: {
    results: ReadonlyArray<SearchFavoriteEntityResultModel>;
    updateResults: (
        update: (
            value: ReadonlyArray<SearchFavoriteEntityResultModel>,
        ) => ReadonlyArray<SearchFavoriteEntityResultModel>,
    ) => void;
    shortcutDividerIndex: number;
}) {
    const initialAppRenderId = useInitialAppRenderId();
    const platform = usePlatform();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const rpcCache = useGlobalContext(RpcCacheContext);
    const dndContext = useDndContext();

    const [randomSeed] = useState(() =>
        initialAppRenderId ? `${initialAppRenderId}-SearchFavoritesView` : generateId(),
    );

    const sortableIds = useMemo(() => {
        const sortableIds: Array<string> = [];

        if (dndContext.active?.id === "ShortcutDivider" && shortcutDividerIndex === -1)
            sortableIds.push("ShortcutDivider");

        for (let index = 0; index < results.length; index++) {
            const result = results[index]!;
            sortableIds.push(result.id);

            // Only allow sorting `ShortcutDivider` if we're actively dragging
            // `ShortcutDivider`. Otherwise it should stay in the same position while other
            // items move around it.
            if (dndContext.active?.id === "ShortcutDivider" && index === shortcutDividerIndex)
                sortableIds.push("ShortcutDivider");
        }

        return sortableIds;
    }, [dndContext.active?.id, shortcutDividerIndex, results]);

    return (
        <SortableContext
            items={sortableIds}
            strategy={useCallback(
                (options: Parameters<SortingStrategy>[0]) => {
                    const activeId = sortableIds[options.activeIndex];

                    // Don't allow `ShortcutDivider` to be dragged below more than the max entity
                    // count.
                    if (activeId === "ShortcutDivider") {
                        return rectSortingStrategy({
                            ...options,
                            overIndex: clamp(
                                searchShortcutFavoriteEntityMinCount,
                                options.overIndex,
                                searchShortcutFavoriteEntityMaxCount,
                            ),
                        });
                    }

                    return rectSortingStrategy(options);
                },
                [sortableIds],
            )}
        >
            <SearchFavoritesViewDragPortals randomSeed={randomSeed} results={results} />
            {results.length === 0 && (
                <Box
                    paddingX={
                        platform !== "mobile" ? searchEntityViewDefaultPaddingX : screenPaddingX
                    }
                    color="grey-50"
                    style={contentStyles.paragraphFontSize}
                >
                    No favorites. When you favorite something it will show up here.
                </Box>
            )}
            {results.length > 0 && shortcutDividerIndex === -1 && (
                <SearchFavoritesViewShortcutDivider />
            )}
            {results.map((result, index) => (
                <Fragment key={result.id}>
                    <SearchFavoritesViewItem
                        randomSeed={randomSeed}
                        result={result}
                        removeResult={async () => {
                            await unfavoriteSearchEntity(context, {
                                spaceId: space.id,
                                entityId: result.id,
                            });

                            // This is very race condition prone. But it's good enough for this
                            // non-collaborative use case. _Shrug_
                            updateSearchFavoriteEntityMenuAction(space.id, result.id, false);

                            updateResults(results =>
                                results.filter(otherResult => otherResult.id !== result.id),
                            );

                            // Don't refetch `searchByAffinity()` if we're removing a non-shortcut.
                            if (index <= shortcutDividerIndex) {
                                forceRevalidateSearchByAffinity(
                                    context,
                                    rpcCache,
                                    space.id,
                                    "removing favorite in favorites view",
                                    output => {
                                        // Test that the item was removed from `favoriteResults`.
                                        return output.favoriteResults.every(
                                            otherResult => otherResult.id !== result.id,
                                        );
                                    },
                                );
                            }
                        }}
                    />
                    {index === shortcutDividerIndex && <SearchFavoritesViewShortcutDivider />}
                </Fragment>
            ))}
        </SortableContext>
    );
}

function SearchFavoritesViewDragPortals({
    randomSeed,
    results,
}: {
    randomSeed: string;
    results: ReadonlyArray<SearchFavoriteEntityResultModel>;
}) {
    const platform = usePlatform();
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    const activeResult = useMemo(
        () =>
            active && active.id !== "ShortcutDivider"
                ? assertExists(results.find(result => result.id === active.id))
                : null,
        [active, results],
    );

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="80" cursor="grabbing" />,
                    document.body,
                )}
            {activeResult &&
                createPortal(
                    <DragOverlay
                        zIndex={70}
                        // Only let shortcut divider move on the Y axis on mobile. Not on the X axis.
                        modifiers={
                            platform === "mobile"
                                ? [({transform}) => ({...transform, x: 0})]
                                : undefined
                        }
                    >
                        <SearchFavoritesViewItem
                            randomSeed={randomSeed}
                            result={activeResult}
                            removeResult={asyncNoop}
                            isDragOverlay={true}
                        />
                    </DragOverlay>,
                    document.body,
                )}
            {active?.id === "ShortcutDivider" &&
                createPortal(
                    <DragOverlay
                        zIndex={70}
                        // Only let shortcut divider move on the Y axis. Not on the X axis.
                        modifiers={[({transform}) => ({...transform, x: 0})]}
                    >
                        <SearchFavoritesViewShortcutDivider isDragOverlay={true} />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function SearchFavoritesViewItem({
    randomSeed,
    result,
    removeResult,
    isDragOverlay = false,
}: {
    randomSeed: string;
    result: SearchFavoriteEntityResultModel;
    removeResult: () => Promise<void>;
    isDragOverlay?: boolean;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();
    const currentTime = useCurrentTimeRoundedToHour();
    const activeContextMenuActions = useContextMenuActions();
    const entityData = useSearchEntityModel(result.model);

    const id = useId();

    const path = useMemo(
        () =>
            getSearchEntityPath({
                spaceId: space.id,
                entityData,
                randomSeed,
                currentTime,
                routeLayout,
            }),
        [currentTime, randomSeed, entityData, routeLayout, space.id],
    );

    const {
        attributes: sortableAttributes,
        listeners: sortableListeners,
        setNodeRef: setSortableNodeRef,
        transform: sortableTransform,
        transition: sortableTransition,
        isDragging,
        active: dndContextActive,
    } = useSortable({
        id: result.id,
        disabled: isDragOverlay,
    });

    const [isPointerDown, setIsPointerDown] = useState(false);
    const [isEnterKeyDown, setIsEnterKeyDown] = useState(false);
    const [isSpaceKeyDown, setIsSpaceKeyDown] = useState(false);
    const isPressed = isPointerDown || isEnterKeyDown || isSpaceKeyDown;

    if (isDragging || isDragOverlay) {
        if (isPointerDown) setIsPointerDown(false);
        if (isEnterKeyDown) setIsEnterKeyDown(false);
        if (isSpaceKeyDown) setIsSpaceKeyDown(false);
    }

    const [isPending, setIsPending] = useState(false);

    const handlePress = (event: SyntheticPointerEvent | SyntheticKeyboardEvent) => {
        if (isPending) return;

        runPromiseWithoutAwaiting(async () => {
            setIsPending(true);

            try {
                // When you select a favorite, don't navigate the peek we're in and don't open a
                // peek if we're fullscreen. Always perform a fullscreen navigation. This way we
                // consider opening search, pressing "see all", then pressing a favorite closes
                // `<SearchModal>`. A fast, successful, navigation session.
                //
                // Holding shift performs a normal navigation.
                if (!event.shiftKey) {
                    await rootNavigate(path);
                } else {
                    await navigate(path);
                }
            } finally {
                setIsPending(false);
            }
        });
    };

    const handleRemovePress = useEvent(removeResult);

    const contextMenuActions = useMemo(
        (): ReadonlyArray<ReadonlyArray<MenuAction>> => [
            [
                {
                    key: id,
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    pressErrorTitle: "Couldn\u2019t copy link",
                    onPress: async () => {
                        const url = new URL(path, window.location.href);
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
            [
                {
                    label: "Remove from favorites",
                    pressErrorTitle: "Couldn\u2019t remove from favorite",
                    onPress: handleRemovePress,
                },
            ],
        ],
        [id, handleRemovePress, path],
    );

    const hasActiveContextMenu = useMemo(
        () =>
            activeContextMenuActions?.some(section =>
                ("actions" in section ? section.actions : section).some(
                    action => !action.withCustomLayout && action.key === id,
                ),
            ) ?? false,
        [activeContextMenuActions, id],
    );

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <FocusRing isDisabled={isDragging || isDragOverlay} offset="inset">
                <Box
                    {...mergeProps(sortableAttributes, sortableListeners, {
                        onPointerDown: () => {
                            if (isDragging || isDragOverlay) return;
                            setIsPointerDown(true);
                        },
                        onPointerUp: (event: SyntheticPointerEvent) => {
                            const wasPressed = isPressed;
                            setIsPointerDown(false);
                            if (wasPressed) handlePress(event);
                        },
                        onPointerOut: () => setIsPointerDown(false),
                        onPointerCancel: () => setIsPointerDown(false),
                        onKeyDown: (event: SyntheticKeyboardEvent) => {
                            if (isDragging || isDragOverlay) return;

                            switch (event.key) {
                                case "Enter": {
                                    setIsEnterKeyDown(true);
                                    break;
                                }
                                case " ": {
                                    setIsSpaceKeyDown(true);
                                    break;
                                }
                            }
                        },
                        onKeyUp: (event: SyntheticKeyboardEvent) => {
                            switch (event.key) {
                                case "Enter": {
                                    const wasEnterKeyDown = isEnterKeyDown;
                                    setIsEnterKeyDown(false);
                                    if (wasEnterKeyDown) handlePress(event);
                                    break;
                                }
                                case " ": {
                                    const wasSpaceKeyDown = isSpaceKeyDown;
                                    setIsSpaceKeyDown(false);
                                    if (wasSpaceKeyDown) handlePress(event);
                                    break;
                                }
                            }
                        },
                    })}
                    ref={setSortableNodeRef}
                    backgroundColor={
                        isPressed || hasActiveContextMenu
                            ? "grey-5"
                            : isDragOverlay
                              ? "grey-0"
                              : undefined
                    }
                    boxShadow={isDragOverlay ? "elevation-30" : undefined}
                    paddingX={
                        platform !== "mobile" ? searchEntityViewDefaultPaddingX : screenPaddingX
                    }
                    borderRadius={platform !== "mobile" ? "1.5" : undefined}
                    opacity={isDragging ? "0" : undefined}
                    style={{
                        transform:
                            dndContextActive && sortableTransform
                                ? `translate(${sortableTransform.x}px, ${sortableTransform.y}px)`
                                : undefined,
                        transition: dndContextActive ? sortableTransition : undefined,
                    }}
                >
                    <SearchAffinityEntityView
                        result={result}
                        // Clamp to only one line so each favorite has the same height which
                        // `@dnd-kit/sortable` appears to need.
                        lineClamp={1}
                    />
                </Box>
            </FocusRing>
        </ContextMenuActions>
    );
}

function SearchFavoritesViewShortcutDivider({isDragOverlay}: {isDragOverlay?: boolean}) {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();
    const dndContext = useDndContext();

    const {
        attributes: sortableAttributes,
        listeners: sortableListeners,
        setNodeRef: setSortableNodeRef,
        transform: sortableTransform,
        transition: sortableTransition,
        isDragging,
    } = useSortable({
        id: "ShortcutDivider",
        disabled: {
            draggable: isDragOverlay,
            // Only allow sorting `ShortcutDivider` if we're actively dragging
            // `ShortcutDivider`. Otherwise it should stay in the same position while other
            // items move around it.
            droppable: dndContext.active?.id !== "ShortcutDivider",
        },
    });

    // We intentionally aren't animating the shortcut divider's position. The
    // shortcut divider stays at the same index even when items around it are
    // moving.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    sortableTransform;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    sortableTransition;

    const [isPointerDown, setIsPointerDown] = useState(false);

    if (isDragging || isDragOverlay) {
        if (isPointerDown) setIsPointerDown(false);
    }

    return (
        <Box
            ref={setSortableNodeRef}
            position="relative"
            display="flex"
            alignItems="center"
            paddingX={platform !== "mobile" ? searchEntityViewDefaultPaddingX : screenPaddingX}
            style={{height: searchAffinityEntityViewMinHeightPx[spacingScale]}}
        >
            <FocusRing isDisabled={isDragging || isDragOverlay} offset="0.5" insetY="3">
                <Box
                    {...mergeProps(sortableAttributes, sortableListeners, {
                        onPointerDown: () => {
                            if (isDragging || isDragOverlay) return;
                            setIsPointerDown(true);
                        },
                        onPointerUp: () => setIsPointerDown(false),
                        onPointerOut: () => setIsPointerDown(false),
                        onPointerCancel: () => setIsPointerDown(false),
                    })}
                    width="full"
                    paddingTop="4"
                    paddingBottom="2"
                    marginBottom="2"
                    cursor={isPointerDown ? "grabbing" : "grab"}
                    opacity={isDragging ? "0" : undefined}
                >
                    <Box
                        position="relative"
                        zIndex="-10"
                        width="full"
                        height="border"
                        backgroundColor={
                            platform === "mobile" && (isPointerDown || isDragOverlay)
                                ? "grey-10"
                                : // Using a semi-transparent color so it looks better when dragging.
                                  "grey-5-translucent"
                        }
                    >
                        <Box
                            position="absolute"
                            right="0"
                            top="-4"
                            fontSize="25"
                            display="flex"
                            alignItems="center"
                            gap="0.5"
                            color={
                                platform === "mobile" && (isPointerDown || isDragOverlay)
                                    ? "grey-50"
                                    : "grey-40"
                            }
                        >
                            Shortcuts <DotsSixVertical size={spacing["3"]} />
                        </Box>
                    </Box>
                    {platform === "mobile" && (isPointerDown || isDragOverlay) && (
                        <Box
                            position="absolute"
                            zIndex="-20"
                            inset="0"
                            backgroundColor="grey-5-translucent"
                        />
                    )}
                </Box>
            </FocusRing>
        </Box>
    );
}
