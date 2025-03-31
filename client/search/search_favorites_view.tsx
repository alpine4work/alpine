import {
    DndContext,
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
import {ArrowUp, Link as LinkIcon, Star} from "phosphor-react";
import {Fragment, KeyboardEvent, useCallback, useMemo, useState} from "react";
import {mergeProps} from "react-aria";
import {createPortal} from "react-dom";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions, useContextMenuActions} from "~/client/design/context_menu.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuAction} from "~/client/design/menu.js";
import {useReporter} from "~/client/design/reporter.js";
import {useInitialAppRenderId} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useStateWithOptimisticUpdates} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {searchFavoriteEntityIconColor} from "~/client/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {getSearchEntityPath} from "~/client/search/internal/get_search_entity_path.js";
import {SearchAffinityEntityView} from "~/client/search/search_affinity_entity_view.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {SpaceRouteScrollView} from "~/client/spaces/layout/space_route_scroll_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {peekNarrowLayoutWidth} from "~/client/styles/peek_shared_styles.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityViewDefaultPaddingX,
    searchEntityViewMediaSize,
    searchEntityViewTitleTypeDisplayGap,
} from "~/client/styles/search_shared_styles.js";
import {grey5SemiTransparentColorVar, sprinkles} from "~/client/styles/styles.js";
import {
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {
    moveSearchFavoriteEntity,
    unfavoriteSearchEntity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {updateSpaceAccountSettings} from "~/shared/rpc/spaces_rpc_definitions.js";
import {SearchFavoriteEntityResult} from "~/shared/search/search_affinity_entity_result.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {
    searchShortcutFavoriteEntityMaxCount,
    searchShortcutFavoriteEntityMinCount,
} from "~/shared/spaces/space_account_settings.js";

const searchFavoriteEntitiesTitleStarIconSize = "5";
const searchFavoriteEntitiesTitleStarMarginX = `${
    (parseRemLength(searchEntityViewMediaSize) -
        parseRemLength(searchFavoriteEntitiesTitleStarIconSize)) /
    2
}rem`;

const screenPaddingXWithoutSearchEntityViewPaddingX = mapObjectValues(
    screenPaddingX,
    screenPaddingX => subtractRemLengths(screenPaddingX, searchEntityViewDefaultPaddingX),
);

export function SearchFavoritesView({
    initialShortcutFavoriteEntityCount,
    initialResults,
}: {
    initialShortcutFavoriteEntityCount: number;
    initialResults: ReadonlyArray<SearchFavoriteEntityResult>;
}) {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const maxWidth = routeLayout !== "narrow" ? peekNarrowLayoutWidth : undefined;

    const [shortcutFavoriteEntityCount, , updateShortcutFavoriteEntityCountOptimistically] =
        useStateWithOptimisticUpdates(initialShortcutFavoriteEntityCount);

    const [results, updateResults, updateResultsOptimistically] =
        useStateWithOptimisticUpdates(initialResults);

    // NOCOMMIT: Zero favorites

    const pointerSensor = useSensor(
        PointerSensor,
        // Needs to be `useMemo()`d to avoid unnecessary re-renders.
        // https://github.com/clauderic/dnd-kit/blob/00f749bc0cc3e6582f4f887f64c1f1de65ee0081/packages/core/src/sensors/useSensor.ts#L15
        useMemo(
            () => ({
                activationConstraint: {
                    // The pointer must move to activate dragging. That way a plain click can be
                    // used to open the favorite.
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
                    // Instead of starting the keyboard drag with the default "Enter" or "Space"
                    // keys, we start the drag with the "m" key. That way the default "Enter" or
                    // "Space" key can be used to navigate to the favorite.
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

    return (
        <SpaceRouteScrollView
            title={
                // The spacing here is carefully constructed to align with
                // `<SearchEntityViewTitle>` on desktop. If `<SearchEntityViewTitle>` updates
                // then this will need to update too.
                <Box display="flex" alignItems="center" gap={searchEntityViewTitleTypeDisplayGap}>
                    <Star
                        size={spacing[searchFavoriteEntitiesTitleStarIconSize]}
                        weight="fill"
                        className={sprinkles({fill: searchFavoriteEntityIconColor})}
                        style={{
                            marginLeft: searchFavoriteEntitiesTitleStarMarginX,
                            marginRight: searchFavoriteEntitiesTitleStarMarginX,
                        }}
                    />
                    <Box>Favorites</Box>
                </Box>
            }
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
                    <Box width="full" height="border" backgroundColor="grey-5" />
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
                        onDragEnd={event => {
                            const {active, over} = event;
                            if (!over || active.id === over.id) return;

                            if (active.id === "ShortcutDivider") {
                                let overIndex = results.findIndex(result => result.id === over.id);
                                if (overIndex > shortcutDividerIndex) overIndex++;
                                overIndex = clamp(
                                    searchShortcutFavoriteEntityMinCount,
                                    overIndex,
                                    searchShortcutFavoriteEntityMaxCount,
                                );

                                const movePromise = updateSpaceAccountSettings(context, {
                                    spaceId: space.id,
                                    update: {searchShortcutFavoriteEntityCount: overIndex},
                                });

                                // 1. Show an error if the update fails.
                                movePromise.catch(error => {
                                    reporter.displayError("Couldn’t move shortcut divider", error);
                                });

                                // 2. Show a loading indicator if the update takes a while (this will also stop
                                //    the user from closing the browser).
                                addGlobalLoadingIndicator(movePromise, {type: "Saving"});

                                // 3. Optimistically update our `results` state. Will revert the update if the
                                //    promise rejects.
                                updateShortcutFavoriteEntityCountOptimistically(
                                    movePromise,
                                    () => overIndex,
                                );
                                return;
                            }

                            const activeIndex = results.findIndex(
                                result => result.id === active.id,
                            );
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

                            // 1. Show an error if the update fails.
                            movePromise.catch(error => {
                                reporter.displayError("Couldn’t move favorite", error);
                            });

                            // 2. Show a loading indicator if the update takes a while (this will also stop
                            //    the user from closing the browser).
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
                                        defaultCompareStrings(
                                            result1.favoriteOrderKey,
                                            result2.favoriteOrderKey,
                                        ),
                                    );

                                return newResults;
                            });
                        }}
                    >
                        <SearchFavoritesViewInner
                            shortcutDividerIndex={shortcutDividerIndex}
                            results={results}
                            updateResults={updateResults}
                        />
                    </DndContext>
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="flex-end"
                    paddingX={screenPaddingX}
                    style={{height: searchAffinityEntityViewMinHeightPx[spacingScale] / 2}}
                >
                    <Box width="full" height="border" backgroundColor="grey-5" />
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
    results: ReadonlyArray<SearchFavoriteEntityResult>;
    updateResults: (
        update: (
            value: ReadonlyArray<SearchFavoriteEntityResult>,
        ) => ReadonlyArray<SearchFavoriteEntityResult>,
    ) => void;
    shortcutDividerIndex: number;
}) {
    const initialAppRenderId = useInitialAppRenderId();
    const dndContext = useDndContext();

    const [randomSeed] = useState(() => initialAppRenderId ?? generateId());

    const sortableIds = useMemo(() => {
        const sortableIds: Array<string> = [];

        if (dndContext.active?.id === "ShortcutDivider" && shortcutDividerIndex === -1)
            sortableIds.push("ShortcutDivider");

        for (let index = 0; index < results.length; index++) {
            const result = results[index]!;
            sortableIds.push(result.id);

            // Only allow sorting `ShortcutDivider` if we're actively dragging `ShortcutDivider`.
            // Otherwise it should stay in the same position while other items move
            // around it.
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

                    // Don't allow `ShortcutDivider` to be dragged below more than the max entity count.
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
            {shortcutDividerIndex === -1 && <SearchFavoritesViewShortcutDivider />}
            {results.map((result, index) => (
                <Fragment key={result.id}>
                    <SearchFavoritesViewItem
                        randomSeed={randomSeed}
                        result={result}
                        onResultRemove={() => {
                            updateResults(results =>
                                results.filter(otherResult => otherResult.id !== result.id),
                            );
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
    results: ReadonlyArray<SearchFavoriteEntityResult>;
}) {
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
                    <DragOverlay zIndex={70}>
                        <SearchFavoritesViewItem
                            randomSeed={randomSeed}
                            result={activeResult}
                            onResultRemove={noop}
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
    onResultRemove,
    isDragOverlay = false,
}: {
    randomSeed: string;
    result: SearchFavoriteEntityResult;
    onResultRemove: () => void;
    isDragOverlay?: boolean;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const context = useAppContext();
    const navigate = useNavigate();
    const {space} = useSpaceContext();
    const currentTime = useCurrentTimeRoundedToHour();
    const activeContextMenuActions = useContextMenuActions();

    const path = useMemo(
        () =>
            getSearchEntityPath({
                spaceId: space.id,
                entityId: result.id,
                randomSeed,
                currentTime,
                routeLayout,
            }),
        [currentTime, randomSeed, result.id, routeLayout, space.id],
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

    const handlePress = () => {
        if (isPending) return;

        runPromiseWithoutAwaiting(async () => {
            setIsPending(true);

            try {
                await navigate(path, {
                    // If we're on desktop then don't open in a peek. Instead navigate the
                    // full page.
                    stopPropagation: true,
                });
            } finally {
                setIsPending(false);
            }
        });
    };

    const handleRemovePress = useEvent(async () => {
        await unfavoriteSearchEntity(context, {
            spaceId: space.id,
            entityId: result.id,
        });

        onResultRemove();
    });

    const contextMenuActions = useMemo(
        (): ReadonlyArray<ReadonlyArray<MenuAction>> => [
            [
                {
                    key: result.id,
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    pressErrorTitle: "Couldn’t copy link",
                    onPress: async () => {
                        const url = new URL(path, window.location.href);
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
            [
                {
                    label: "Remove from favorites",
                    pressErrorTitle: "Couldn’t remove from favorite",
                    onPress: handleRemovePress,
                },
            ],
        ],
        [path, handleRemovePress, result.id],
    );

    const hasActiveContextMenu = useMemo(
        () =>
            activeContextMenuActions?.some(actions =>
                actions.some(action => !action.withCustomLayout && action.key === result.id),
            ) ?? false,
        [activeContextMenuActions, result.id],
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
                        onPointerUp: () => {
                            const wasPressed = isPressed;
                            setIsPointerDown(false);
                            if (wasPressed) handlePress();
                        },
                        onPointerOut: () => setIsPointerDown(false),
                        onPointerCancel: () => setIsPointerDown(false),
                        onKeyDown: (event: KeyboardEvent) => {
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
                        onKeyUp: (event: KeyboardEvent) => {
                            switch (event.key) {
                                case "Enter": {
                                    const wasEnterKeyDown = isEnterKeyDown;
                                    setIsEnterKeyDown(false);
                                    if (wasEnterKeyDown) handlePress();
                                    break;
                                }
                                case " ": {
                                    const wasSpaceKeyDown = isSpaceKeyDown;
                                    setIsSpaceKeyDown(false);
                                    if (wasSpaceKeyDown) handlePress();
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
            // Only allow sorting `ShortcutDivider` if we're actively dragging `ShortcutDivider`.
            // Otherwise it should stay in the same position while other items move
            // around it.
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
                    paddingY="3"
                    cursor={isPointerDown ? "grabbing" : "grab"}
                    opacity={isDragging ? "0" : undefined}
                >
                    <Box
                        position="relative"
                        zIndex="-10"
                        width="full"
                        height="border"
                        style={{
                            // Using a semi-transparent color so it looks better when dragging.
                            backgroundColor: grey5SemiTransparentColorVar,
                        }}
                    >
                        <Box
                            position="absolute"
                            right="0"
                            top="-4"
                            fontSize="25"
                            display="flex"
                            alignItems="center"
                            gap="0.5"
                            color="grey-40"
                        >
                            Shortcuts <ArrowUp size={spacing["3"]} />
                        </Box>
                    </Box>
                </Box>
            </FocusRing>
        </Box>
    );
}
