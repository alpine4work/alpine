import {useDndContext} from "@dnd-kit/core";
import {DotsThreeVertical, Link as LinkIcon} from "phosphor-react";
import {
    Memo,
    Ref,
    RefObject,
    memo,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/web/design/scrollbar.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {
    useStateWithDependencies,
    useStateWithDependenciesWithoutDispatch,
} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    navigationBarStyles,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
    tasksStyles,
} from "~/client/web/styles/styles.js";
import {
    taskGridViewColumnHeaderHeight,
    taskGridViewPaddingBottomWithNext,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {TaskFloatingCreateButton} from "~/client/web/tasks/internal/task_floating_create_button.js";
import {TaskGridViewCapabilities} from "~/client/web/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewColumnHeader} from "~/client/web/tasks/internal/task_grid_view_column_header.js";
import {TaskGridViewHasDndContext} from "~/client/web/tasks/internal/task_grid_view_has_dnd_context.js";
import {
    useTaskGridViewVirtualizedListBase,
    useTaskGridViewVirtualizedListItemAnimation,
    useTaskGridViewVirtualizedListScrollToAvoidBottomBarsAndMobileKeyboard,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {
    TaskGridViewVirtualizedListAnimation,
    taskAnimationDurationMs,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_state.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {TaskPersonalNavigationBarCollectionsButton} from "~/client/web/tasks/internal/task_personal_navigation_bar_collections_button.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {
    TaskUndoStackEntry,
    useTaskUndoStackState,
} from "~/client/web/tasks/internal/use_task_undo_stack_state.js";
import {TaskGridViewDraggableData} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {interFontCapHeight, interFontXHeight} from "~/shared/design/core/font_metrics.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {OutOfRangeError} from "~/shared/error/error.js";
import {concatReadonlyArrays} from "~/shared/helpers/array/concat_readonly_arrays.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";

type TaskPersonalViewSection = "Active" | "Overdue" | "DueToday" | "DueSoon" | "Remaining";
type TaskPersonalViewVisibleSection = Exclude<TaskPersonalViewSection, "Remaining">;

const initialTaskPersonalViewVisibleSectionState = {section: null, previousSections: emptySet};

export function TaskPersonalView({
    store,
    activeQuery,
    overdueQuery,
    dueTodayQuery,
    dueSoonQuery,
    remainingQuery,
    affinityManager,
    initialIsFavorite,
}: {
    store: TaskClientStore;
    activeQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    overdueQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    dueTodayQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    dueSoonQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    remainingQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialIsFavorite: boolean;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {isAppleDevice, timeZone} = useClientInfo();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    // Retain our queries.
    useEffect(() => {
        activeQuery.query.retain();
        overdueQuery.query.retain();
        dueTodayQuery.query.retain();
        dueSoonQuery.query.retain();
        remainingQuery.query.retain();

        return () => {
            // Release after a microtask in case the effect re-runs in which case we'll
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                activeQuery.query.release();
                overdueQuery.query.release();
                dueTodayQuery.query.release();
                dueSoonQuery.query.release();
                remainingQuery.query.release();
            });
        };
    }, [
        activeQuery.query,
        dueSoonQuery.query,
        dueTodayQuery.query,
        overdueQuery.query,
        remainingQuery.query,
    ]);

    assert(
        useContext(TaskGridViewHasDndContext),
        "Expected task grid view virtualized list to be rendered inside `<TaskGridViewDndContext>`",
    );

    const dndContext = useDndContext();
    const isDragging = !!dndContext.active;

    const draggingData = useStateWithDependenciesWithoutDispatch(
        ([isDragging]) => {
            if (!isDragging) return null;

            const draggingData = dndContext.active?.data.current as
                | TaskGridViewDraggableData
                | undefined;
            if (draggingData?.type !== "Row") return null;
            return draggingData;
        },
        [isDragging],
    );

    /* ========================================================================== *\
     *                                 Undo/Redo                                  *
    \* ========================================================================== */

    const {
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        popUndoStackEntry,
        popRedoStackEntry,
    } = useTaskUndoStackState<TaskPersonalViewSection>();

    const undo = () => {
        // Keep trying to undo until we find an entry we can apply.
        while (true) {
            const undoStackEntry = popUndoStackEntry();
            if (!undoStackEntry) break;

            let applyUndoStackEntry: (
                type: "Undo" | "Redo",
                entry: DistributiveOmit<TaskUndoStackEntry, "release">,
                options: {pushUndoStackEntry: TaskClientStoreUndoManager["pushUndoStackEntry"]},
            ) => boolean;

            switch (undoStackEntry.extra) {
                case "Active":
                    applyUndoStackEntry = activeGridViewResult.applyUndoStackEntry;
                    break;
                case "Overdue":
                    applyUndoStackEntry = overdueGridViewResult.applyUndoStackEntry;
                    break;
                case "DueToday":
                    applyUndoStackEntry = dueTodayGridViewResult.applyUndoStackEntry;
                    break;
                case "DueSoon":
                    applyUndoStackEntry = dueSoonGridViewResult.applyUndoStackEntry;
                    break;
                case "Remaining":
                    applyUndoStackEntry = remainingGridViewResult.applyUndoStackEntry;
                    break;
                default:
                    throw exhaustive(undoStackEntry.extra);
            }

            if (
                applyUndoStackEntry("Undo", undoStackEntry, {
                    pushUndoStackEntry: entry => {
                        pushRedoStackEntry({
                            type: "Actions",
                            rootParentTaskId: undoStackEntry.rootParentTaskId,
                            extra: undoStackEntry.extra,
                            undoActions: entry.undoActions,
                            removedFromQueries: entry.removedFromQueries,
                            leaseId: entry.leaseId,
                            release: entry.release,
                        });
                    },
                })
            ) {
                break;
            }
        }
    };

    const redo = () => {
        // Keep trying to redo until we find an entry we can apply.
        while (true) {
            const undoStackEntry = popRedoStackEntry();
            if (!undoStackEntry) break;

            let applyUndoStackEntry: (
                type: "Undo" | "Redo",
                entry: DistributiveOmit<TaskUndoStackEntry, "release">,
                options: {pushUndoStackEntry: TaskClientStoreUndoManager["pushUndoStackEntry"]},
            ) => boolean;

            switch (undoStackEntry.extra) {
                case "Active":
                    applyUndoStackEntry = activeGridViewResult.applyUndoStackEntry;
                    break;
                case "Overdue":
                    applyUndoStackEntry = overdueGridViewResult.applyUndoStackEntry;
                    break;
                case "DueToday":
                    applyUndoStackEntry = dueTodayGridViewResult.applyUndoStackEntry;
                    break;
                case "DueSoon":
                    applyUndoStackEntry = dueSoonGridViewResult.applyUndoStackEntry;
                    break;
                case "Remaining":
                    applyUndoStackEntry = remainingGridViewResult.applyUndoStackEntry;
                    break;
                default:
                    throw exhaustive(undoStackEntry.extra);
            }

            if (
                applyUndoStackEntry("Redo", undoStackEntry, {
                    pushUndoStackEntry: entry => {
                        pushUndoStackEntryFromRedo({
                            type: "Actions",
                            rootParentTaskId: undoStackEntry.rootParentTaskId,
                            extra: undoStackEntry.extra,
                            undoActions: entry.undoActions,
                            removedFromQueries: entry.removedFromQueries,
                            leaseId: entry.leaseId,
                            release: entry.release,
                        });
                    },
                })
            ) {
                break;
            }
        }
    };

    const onGlobalKeyDown = (event: KeyboardEvent) => {
        switch (event.key) {
            case "z": {
                if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (event.shiftKey) {
                        redo();
                    } else if ((isAppleDevice ? !event.ctrlKey : !event.metaKey) && !event.altKey) {
                        undo();
                    }
                    break;
                }
                break;
            }
            // https://en.wikipedia.org/wiki/Control-Y
            case "y": {
                if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (
                        (isAppleDevice ? !event.ctrlKey : !event.metaKey) &&
                        !event.altKey &&
                        !event.shiftKey
                    ) {
                        redo();
                    }
                    break;
                }
                break;
            }
        }
    };

    /* ========================================================================== *\
     *                              Visible section                               *
    \* ========================================================================== */

    const [visibleSectionState, setVisibleSectionState] = useState<{
        section: TaskPersonalViewVisibleSection | null;
        previousSections: ReadonlySet<TaskPersonalViewVisibleSection>;
    }>(initialTaskPersonalViewVisibleSectionState);

    const visibleSectionPositionStateRef = useRef<{
        activeHeaderPosition: {offset: number; height: number} | null;
        overdueHeaderPosition: {offset: number; height: number} | null;
        dueTodayHeaderPosition: {offset: number; height: number} | null;
        dueSoonHeaderPosition: {offset: number; height: number} | null;
        remainingHeaderPosition: {offset: number; height: number} | null;
    } | null>(null);

    const handleScroll = () => {
        const view = assertExists(viewRef.current);

        // When the user scrolls, only update state if it hasn't been initialized yet.
        // Just because the user scrolled doesn't mean virtualized scroll view state
        // will change.
        if (visibleSectionPositionStateRef.current === null) {
            visibleSectionPositionStateRef.current = {
                activeHeaderPosition: view.getPositionByKeyIfExists("ActiveHeader"),
                overdueHeaderPosition: view.getPositionByKeyIfExists("OverdueHeader"),
                dueTodayHeaderPosition: view.getPositionByKeyIfExists("DueTodayHeader"),
                dueSoonHeaderPosition: view.getPositionByKeyIfExists("DueSoonHeader"),
                remainingHeaderPosition: view.getPositionByKeyIfExists("RemainingHeader"),
            };
        }

        handleScrollOrStateChange(view, visibleSectionPositionStateRef.current);
    };

    const handleStateChange = () => {
        const view = assertExists(viewRef.current);

        // Always reset state when the virtualized scroll view state changes. Any
        // position may have updated.
        visibleSectionPositionStateRef.current = {
            activeHeaderPosition: view.getPositionByKeyIfExists("ActiveHeader"),
            overdueHeaderPosition: view.getPositionByKeyIfExists("OverdueHeader"),
            dueTodayHeaderPosition: view.getPositionByKeyIfExists("DueTodayHeader"),
            dueSoonHeaderPosition: view.getPositionByKeyIfExists("DueSoonHeader"),
            remainingHeaderPosition: view.getPositionByKeyIfExists("RemainingHeader"),
        };

        handleScrollOrStateChange(view, visibleSectionPositionStateRef.current);
    };

    const navigationBarHeightPx = useMemo(
        () => convertRemLengthToPx(navigationBarHeight, spacingScale),
        [spacingScale],
    );

    const handleScrollOrStateChange = (
        view: VirtualizedScrollViewRef,
        visibleSectionPositionState: {
            activeHeaderPosition: {offset: number; height: number} | null;
            overdueHeaderPosition: {offset: number; height: number} | null;
            dueTodayHeaderPosition: {offset: number; height: number} | null;
            dueSoonHeaderPosition: {offset: number; height: number} | null;
            remainingHeaderPosition: {offset: number; height: number} | null;
        },
    ) => {
        const scrollOffset = view.getScrollOffset();

        let newVisibleSection: TaskPersonalViewVisibleSection | null = null;

        if (
            visibleSectionPositionState.remainingHeaderPosition !== null &&
            scrollOffset + navigationBarHeightPx >
                visibleSectionPositionState.remainingHeaderPosition.offset
        ) {
            newVisibleSection = null;
        } else if (
            visibleSectionPositionState.dueSoonHeaderPosition !== null &&
            scrollOffset + navigationBarHeightPx >
                visibleSectionPositionState.dueSoonHeaderPosition.offset
        ) {
            newVisibleSection = "DueSoon";
        } else if (
            visibleSectionPositionState.dueTodayHeaderPosition !== null &&
            scrollOffset + navigationBarHeightPx >
                visibleSectionPositionState.dueTodayHeaderPosition.offset
        ) {
            newVisibleSection = "DueToday";
        } else if (
            visibleSectionPositionState.overdueHeaderPosition !== null &&
            scrollOffset + navigationBarHeightPx >
                visibleSectionPositionState.overdueHeaderPosition.offset
        ) {
            newVisibleSection = "Overdue";
        } else if (
            visibleSectionPositionState.activeHeaderPosition !== null &&
            scrollOffset + navigationBarHeightPx >
                visibleSectionPositionState.activeHeaderPosition.offset
        ) {
            newVisibleSection = "Active";
        }

        setVisibleSectionState(visibleSectionState => {
            if (visibleSectionState.section === newVisibleSection) return visibleSectionState;

            if (
                visibleSectionState.section !== null &&
                visibleSectionState.previousSections.has(visibleSectionState.section)
            ) {
                return {...visibleSectionState, section: newVisibleSection};
            }

            return {
                section: newVisibleSection,
                previousSections:
                    visibleSectionState.section !== null
                        ? new Set([
                              ...visibleSectionState.previousSections,
                              visibleSectionState.section,
                          ])
                        : visibleSectionState.previousSections,
            };
        });
    };

    /* ========================================================================== *\
     *                               Navigation Bar                               *
    \* ========================================================================== */

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction("TaskPersonal", initialIsFavorite);

    const navigationBarMenuActions = useMemo(
        (): ReadonlyArray<MenuAction> => [
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn’t copy link",
                onPress: async () => {
                    const url = new URL(`/s/${space.id}/tasks`, window.location.href);
                    await writeTextToClipboard(url.toString());
                },
            },
            ...(favoriteMenuAction ? [favoriteMenuAction] : []),
        ],
        [favoriteMenuAction, space.id],
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: routeLayout !== "narrow",
        withoutDisappearingTitle: true,
        title:
            platform === "mobile" ? (
                "My tasks"
            ) : (
                <TaskPersonalNavigationBarTitleDesktop
                    paddingLeft="0"
                    visibleSectionState={visibleSectionState}
                />
            ),
        menuActions: navigationBarMenuActions,
    });

    /* ========================================================================== *\
     *                                   Events                                   *
    \* ========================================================================== */

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const events = useEvents({
        getActiveItemCount: () => activeGridViewResult.itemCount,
        getOverdueItemCount: () => overdueGridViewResult.itemCount,
        getDueTodayItemCount: () => dueTodayGridViewResult.itemCount,
        getDueSoonItemCount: () => dueSoonGridViewResult.itemCount,
        getRemainingItemCount: () => remainingGridViewResult.itemCount,
    });

    /* ========================================================================== *\
     *                              Mobile Scrolling                              *
    \* ========================================================================== */

    const {scrollToAnchorPosition} =
        useTaskGridViewVirtualizedListScrollToAvoidBottomBarsAndMobileKeyboard(viewRef);

    /* ========================================================================== *\
     *                           Virtualized list state                           *
    \* ========================================================================== */

    const gridViewCapabilities: Memo<TaskGridViewCapabilities> = useMemo(() => {
        if (routeLayout !== "narrow") {
            return {
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: false,
                hasColumns: true,
                withoutAssigneeField: true,
                hasDenseFields: false,
            };
        } else {
            return {
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: true,
                hasColumns: false,
                withoutAssigneeField: true,
                hasDenseFields: true,
            };
        }
    }, [routeLayout]);

    let runningItemCount = 0;
    let hasFirstHeader = false;
    const alwaysRenderAdditionalItemIndexes: Array<number> = [];

    alwaysRenderAdditionalItemIndexes.push(runningItemCount);
    runningItemCount += 1;

    // `ActiveHeader` (must be before `useTaskGridViewVirtualizedListViewRef()` to
    // shift indexes correctly)
    runningItemCount += 1;

    const activeGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "Active-",
        capabilities: gridViewCapabilities,
        store,
        query: activeQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getActiveItemCount,
        ),
        getMoveTaskToQueryActions: (taskId, position): Array<TaskActionModel> => {
            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: currentAccount.id,
                            assignerId: currentAccount.id,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time1,
                                setterTimeZone: timeZone,
                            }),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: timeZone,
                            }),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: time3,
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: currentAccount.id,
                        position: getNewTaskPositionForQuerySortedByPosition(
                            time3,
                            activeQuery.query,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: null,
                },
            },
        ],
        withoutColumnHeader: true,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow" && !hasFirstHeader,
        withoutBottomGhostTask: true,
        withoutDecorativeGhostRows: true,
        isDragging,
        draggingData,
        pushUndoStackEntry: entry => {
            pushUndoStackEntry({...entry, extra: "Active"});
        },
        scrollToAnchorPosition,
        nextGridView: {
            focusFirstTaskTitleStart: () => {
                if (!isOverdueGridViewEmpty) {
                    overdueGridViewResult.focusFirstTaskTitleStart();
                } else if (!isDueTodayGridViewEmpty) {
                    dueTodayGridViewResult.focusFirstTaskTitleStart();
                } else if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskTitleStart();
                } else {
                    remainingGridViewResult.focusFirstTaskTitleStart();
                }
            },
            focusFirstTaskTitleCoord: coord => {
                if (!isOverdueGridViewEmpty) {
                    overdueGridViewResult.focusFirstTaskTitleCoord(coord);
                } else if (!isDueTodayGridViewEmpty) {
                    dueTodayGridViewResult.focusFirstTaskTitleCoord(coord);
                } else if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskTitleCoord(coord);
                } else {
                    remainingGridViewResult.focusFirstTaskTitleCoord(coord);
                }
            },
            focusFirstTaskCell: column => {
                if (!isOverdueGridViewEmpty) {
                    overdueGridViewResult.focusFirstTaskCell(column);
                } else if (!isDueTodayGridViewEmpty) {
                    dueTodayGridViewResult.focusFirstTaskCell(column);
                } else if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskCell(column);
                } else {
                    remainingGridViewResult.focusFirstTaskCell(column);
                }
            },
        },
    });

    const isActiveGridViewEmpty =
        activeGridViewResult.stateItemCount === 0 &&
        activeGridViewResult.loadedState === "FullyLoaded";

    if (isActiveGridViewEmpty) {
        // We won't show the `ActiveHeader` item we added previously if this grid view
        // is empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view
        // items if we determine it to be empty. That way if the effects in the
        // virtualized scroll view check `viewRef.current.getRenderedRange()` we'll
        // accurately return null.
        assert(activeGridViewResult.itemCount === 0);
    } else {
        // Always render the first header since its column names will be
        // `position: sticky`.
        if (!hasFirstHeader) {
            hasFirstHeader = true;
            alwaysRenderAdditionalItemIndexes.push(runningItemCount - 1);
        }

        for (const index of activeGridViewResult.alwaysRenderAdditionalItemIndexes) {
            alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
        }

        runningItemCount += activeGridViewResult.itemCount;
    }

    const activeGridViewHeaderAnimations =
        useTaskPersonalViewHeaderAnimations(activeGridViewResult);

    let previousGridViewAnimations = useMemo(
        () => concatReadonlyArrays(activeGridViewHeaderAnimations, activeGridViewResult.animations),
        [activeGridViewHeaderAnimations, activeGridViewResult.animations],
    );

    // `OverdueHeader` (must be before `useTaskGridViewVirtualizedListViewRef()` to
    // shift indexes correctly)
    runningItemCount += 1;

    const overdueGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "Overdue-",
        capabilities: gridViewCapabilities,
        store,
        query: overdueQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getOverdueItemCount,
        ),
        getMoveTaskToQueryActions: (taskId, position): Array<TaskActionModel> => {
            assert(
                overdueQuery.query.filters.dueDateFilter?.type === "Range" &&
                    overdueQuery.query.filters.dueDateFilter.exclusiveUpperBoundDate,
            );

            // By default, set due date to yesterday.
            const currentDate =
                overdueQuery.query.filters.dueDateFilter.exclusiveUpperBoundDate.subtract({
                    days: 1,
                });

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: currentAccount.id,
                            assignerId: currentAccount.id,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time1,
                                setterTimeZone: timeZone,
                            }),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateDueDate",
                        dueDate: currentDate,
                    },
                },
                {
                    type: "UpdateTask",
                    time: time3,
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: currentAccount.id,
                        position: getNewTaskPositionForQuerySortedByPosition(
                            time3,
                            overdueQuery.query,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: null,
                },
            },
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: null,
                },
            },
        ],
        withoutColumnHeader: true,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow" && !hasFirstHeader,
        withoutBottomGhostTask: true,
        withoutDecorativeGhostRows: true,
        isDragging,
        draggingData,
        pushUndoStackEntry: entry => {
            pushUndoStackEntry({...entry, extra: "Overdue"});
        },
        scrollToAnchorPosition,
        previousGridView: !isActiveGridViewEmpty ? activeGridViewResult : undefined,
        previousGridViewAnimations,
        nextGridView: {
            focusFirstTaskTitleStart: () => {
                if (!isDueTodayGridViewEmpty) {
                    dueTodayGridViewResult.focusFirstTaskTitleStart();
                } else if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskTitleStart();
                } else {
                    remainingGridViewResult.focusFirstTaskTitleStart();
                }
            },
            focusFirstTaskTitleCoord: coord => {
                if (!isDueTodayGridViewEmpty) {
                    dueTodayGridViewResult.focusFirstTaskTitleCoord(coord);
                } else if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskTitleCoord(coord);
                } else {
                    remainingGridViewResult.focusFirstTaskTitleCoord(coord);
                }
            },
            focusFirstTaskCell: column => {
                if (!isDueTodayGridViewEmpty) {
                    dueTodayGridViewResult.focusFirstTaskCell(column);
                } else if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskCell(column);
                } else {
                    remainingGridViewResult.focusFirstTaskCell(column);
                }
            },
        },
    });

    const isOverdueGridViewEmpty =
        overdueGridViewResult.stateItemCount === 0 &&
        overdueGridViewResult.loadedState === "FullyLoaded";

    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForOverdueHeader} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            !isOverdueGridViewEmpty ? runningItemCount - 1 : null,
        );

    if (isOverdueGridViewEmpty) {
        // We won't show the `OverdueHeader` item we added previously if this grid view
        // is empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view
        // items if we determine it to be empty. That way if the effects in the
        // virtualized scroll view check `viewRef.current.getRenderedRange()` we'll
        // accurately return null.
        assert(overdueGridViewResult.itemCount === 0);
    } else {
        // Always render the first header since its column names will be
        // `position: sticky`.
        if (!hasFirstHeader) {
            hasFirstHeader = true;
            alwaysRenderAdditionalItemIndexes.push(runningItemCount - 1);
        }

        for (const index of overdueGridViewResult.alwaysRenderAdditionalItemIndexes) {
            alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
        }

        runningItemCount += overdueGridViewResult.itemCount;
    }

    const overdueGridViewHeaderAnimations =
        useTaskPersonalViewHeaderAnimations(overdueGridViewResult);

    previousGridViewAnimations = useMemo(
        () =>
            concatReadonlyArrays(
                previousGridViewAnimations,
                overdueGridViewHeaderAnimations,
                overdueGridViewResult.animations,
            ),
        [
            overdueGridViewHeaderAnimations,
            overdueGridViewResult.animations,
            previousGridViewAnimations,
        ],
    );

    // `DueTodayHeader` (must be before `useTaskGridViewVirtualizedListViewRef()`
    // to shift indexes correctly)
    runningItemCount += 1;

    const dueTodayGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "DueToday-",
        capabilities: gridViewCapabilities,
        store,
        query: dueTodayQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getDueTodayItemCount,
        ),
        getMoveTaskToQueryActions: (taskId, position): Array<TaskActionModel> => {
            assert(
                dueTodayQuery.query.filters.dueDateFilter?.type === "Range" &&
                    dueTodayQuery.query.filters.dueDateFilter.exclusiveLowerBoundDate,
            );
            const currentDate =
                dueTodayQuery.query.filters.dueDateFilter.exclusiveLowerBoundDate.add({days: 1});

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: currentAccount.id,
                            assignerId: currentAccount.id,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time1,
                                setterTimeZone: timeZone,
                            }),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateDueDate",
                        dueDate: currentDate,
                    },
                },
                {
                    type: "UpdateTask",
                    time: time3,
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: currentAccount.id,
                        position: getNewTaskPositionForQuerySortedByPosition(
                            time3,
                            dueTodayQuery.query,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: null,
                },
            },
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: null,
                },
            },
        ],
        withoutColumnHeader: true,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow" && !hasFirstHeader,
        withoutBottomGhostTask: true,
        withoutDecorativeGhostRows: true,
        isDragging,
        draggingData,
        pushUndoStackEntry: entry => {
            pushUndoStackEntry({...entry, extra: "DueToday"});
        },
        scrollToAnchorPosition,
        previousGridView: !isOverdueGridViewEmpty
            ? overdueGridViewResult
            : !isActiveGridViewEmpty
            ? activeGridViewResult
            : undefined,
        previousGridViewAnimations,
        nextGridView: {
            focusFirstTaskTitleStart: () => {
                if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskTitleStart();
                } else {
                    remainingGridViewResult.focusFirstTaskTitleStart();
                }
            },
            focusFirstTaskTitleCoord: coord => {
                if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskTitleCoord(coord);
                } else {
                    remainingGridViewResult.focusFirstTaskTitleCoord(coord);
                }
            },
            focusFirstTaskCell: column => {
                if (!isDueSoonGridViewEmpty) {
                    dueSoonGridViewResult.focusFirstTaskCell(column);
                } else {
                    remainingGridViewResult.focusFirstTaskCell(column);
                }
            },
        },
    });

    const isDueTodayGridViewEmpty =
        dueTodayGridViewResult.stateItemCount === 0 &&
        dueTodayGridViewResult.loadedState === "FullyLoaded";

    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForDueTodayHeader} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            !isDueTodayGridViewEmpty ? runningItemCount - 1 : null,
        );

    if (isDueTodayGridViewEmpty) {
        // We won't show the `DueTodayHeader` item we added previously if this grid
        // view is empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view
        // items if we determine it to be empty. That way if the effects in the
        // virtualized scroll view check `viewRef.current.getRenderedRange()` we'll
        // accurately return null.
        assert(dueTodayGridViewResult.itemCount === 0);
    } else {
        // Always render the first header since its column names will be
        // `position: sticky`.
        if (!hasFirstHeader) {
            hasFirstHeader = true;
            alwaysRenderAdditionalItemIndexes.push(runningItemCount - 1);
        }

        for (const index of dueTodayGridViewResult.alwaysRenderAdditionalItemIndexes) {
            alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
        }

        runningItemCount += dueTodayGridViewResult.itemCount;
    }

    const dueTodayGridViewHeaderAnimations =
        useTaskPersonalViewHeaderAnimations(dueTodayGridViewResult);

    previousGridViewAnimations = useMemo(
        () =>
            concatReadonlyArrays(
                previousGridViewAnimations,
                dueTodayGridViewHeaderAnimations,
                dueTodayGridViewResult.animations,
            ),
        [
            dueTodayGridViewHeaderAnimations,
            dueTodayGridViewResult.animations,
            previousGridViewAnimations,
        ],
    );

    // `DueSoonHeader` (must be before `useTaskGridViewVirtualizedListViewRef()`
    // to shift indexes correctly)
    runningItemCount += 1;

    const dueSoonGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "DueSoon-",
        capabilities: gridViewCapabilities,
        store,
        query: dueSoonQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getDueSoonItemCount,
        ),
        getMoveTaskToQueryActions: (taskId, position): Array<TaskActionModel> => {
            assert(
                dueSoonQuery.query.filters.dueDateFilter?.type === "Range" &&
                    dueSoonQuery.query.filters.dueDateFilter.exclusiveUpperBoundDate,
            );

            // By default, set due date to one week from today (7 days from now). This
            // should be the same as the upper bound of the due soon date range.
            const currentDate =
                dueSoonQuery.query.filters.dueDateFilter.exclusiveUpperBoundDate.subtract({
                    days: 1,
                });

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: currentAccount.id,
                            assignerId: currentAccount.id,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time1,
                                setterTimeZone: timeZone,
                            }),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateDueDate",
                        dueDate: currentDate,
                    },
                },
                {
                    type: "UpdateTask",
                    time: time3,
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: currentAccount.id,
                        position: getNewTaskPositionForQuerySortedByPosition(
                            time3,
                            dueSoonQuery.query,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: null,
                },
            },
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: null,
                },
            },
        ],
        withoutColumnHeader: true,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow" && !hasFirstHeader,
        withoutBottomGhostTask: true,
        withoutDecorativeGhostRows: true,
        isDragging,
        draggingData,
        pushUndoStackEntry: entry => {
            pushUndoStackEntry({...entry, extra: "DueSoon"});
        },
        scrollToAnchorPosition,
        previousGridView: !isDueTodayGridViewEmpty
            ? dueTodayGridViewResult
            : !isOverdueGridViewEmpty
            ? overdueGridViewResult
            : !isActiveGridViewEmpty
            ? activeGridViewResult
            : undefined,
        previousGridViewAnimations,
        nextGridView: {
            focusFirstTaskTitleStart: () => {
                remainingGridViewResult.focusFirstTaskTitleStart();
            },
            focusFirstTaskTitleCoord: coord => {
                remainingGridViewResult.focusFirstTaskTitleCoord(coord);
            },
            focusFirstTaskCell: column => {
                remainingGridViewResult.focusFirstTaskCell(column);
            },
        },
    });

    const isDueSoonGridViewEmpty =
        dueSoonGridViewResult.stateItemCount === 0 &&
        dueSoonGridViewResult.loadedState === "FullyLoaded";

    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForDueSoonHeader} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            !isDueSoonGridViewEmpty ? runningItemCount - 1 : null,
        );

    if (isDueSoonGridViewEmpty) {
        // We won't show the `DueSoonHeader` item we added previously if this grid view
        // is empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view
        // items if we determine it to be empty. That way if the effects in the
        // virtualized scroll view check `viewRef.current.getRenderedRange()` we'll
        // accurately return null.
        assert(dueSoonGridViewResult.itemCount === 0);
    } else {
        // Always render the first header since its column names will be
        // `position: sticky`.
        if (!hasFirstHeader) {
            hasFirstHeader = true;
            alwaysRenderAdditionalItemIndexes.push(runningItemCount - 1);
        }

        for (const index of dueSoonGridViewResult.alwaysRenderAdditionalItemIndexes) {
            alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
        }

        runningItemCount += dueSoonGridViewResult.itemCount;
    }

    const dueSoonGridViewHeaderAnimations =
        useTaskPersonalViewHeaderAnimations(dueSoonGridViewResult);

    previousGridViewAnimations = useMemo(
        () =>
            concatReadonlyArrays(
                previousGridViewAnimations,
                dueSoonGridViewHeaderAnimations,
                dueSoonGridViewResult.animations,
            ),
        [
            dueSoonGridViewHeaderAnimations,
            dueSoonGridViewResult.animations,
            previousGridViewAnimations,
        ],
    );

    const isRemainingGridViewHeaderVisible =
        !isActiveGridViewEmpty ||
        !isOverdueGridViewEmpty ||
        !isDueTodayGridViewEmpty ||
        !isDueSoonGridViewEmpty;

    // `RemainingHeader`
    //
    // This is conditional since if `RemainingHeader` isn't visible because none of
    // the other grid views are visible we don't want to shift the remaining grid
    // view items incorrectly because the remaining grid view will always be
    // visible. It's ok if we incorrectly shift other grid views when they have an
    // item count of 0 so the shift won't matter.
    if (isRemainingGridViewHeaderVisible) {
        runningItemCount += 1;
    }

    const remainingGridViewHeaderAnimations = useTaskPersonalViewRemainingHeaderAnimations(
        isRemainingGridViewHeaderVisible,
    );

    previousGridViewAnimations = useMemo(
        () => concatReadonlyArrays(previousGridViewAnimations, remainingGridViewHeaderAnimations),
        [previousGridViewAnimations, remainingGridViewHeaderAnimations],
    );

    const remainingGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "Remaining-",
        capabilities: gridViewCapabilities,
        store,
        query: remainingQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getRemainingItemCount,
        ),
        getMoveTaskToQueryActions: (taskId, position): Array<TaskActionModel> => {
            const time1 = store.clock.now();
            const time2 = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: currentAccount.id,
                            assignerId: currentAccount.id,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time1,
                                setterTimeZone: timeZone,
                            }),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: currentAccount.id,
                        position: getNewTaskPositionForQuerySortedByPosition(
                            time2,
                            remainingQuery.query,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: null,
                },
            },
        ],
        withoutColumnHeader: true,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow" && !hasFirstHeader,
        isDragging,
        draggingData,
        pushUndoStackEntry: entry => {
            pushUndoStackEntry({...entry, extra: "Remaining"});
        },
        scrollToAnchorPosition,
        previousGridView: !isDueSoonGridViewEmpty
            ? dueSoonGridViewResult
            : !isDueTodayGridViewEmpty
            ? dueTodayGridViewResult
            : !isOverdueGridViewEmpty
            ? overdueGridViewResult
            : !isActiveGridViewEmpty
            ? activeGridViewResult
            : undefined,
        previousGridViewAnimations,
    });

    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForRemainingHeader} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            isRemainingGridViewHeaderVisible ? runningItemCount - 1 : null,
        );

    for (const index of remainingGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += remainingGridViewResult.itemCount;

    /* ========================================================================== *\
     *                                   Render                                   *
    \* ========================================================================== */

    const focusEnd = () => {
        if (remainingGridViewResult.itemCount > 0) {
            remainingGridViewResult.focusEnd();
        } else if (dueSoonGridViewResult.itemCount > 0) {
            dueSoonGridViewResult.focusEnd();
        } else if (dueTodayGridViewResult.itemCount > 0) {
            dueTodayGridViewResult.focusEnd();
        } else if (overdueGridViewResult.itemCount > 0) {
            overdueGridViewResult.focusEnd();
        } else if (activeGridViewResult.itemCount > 0) {
            activeGridViewResult.focusEnd();
        }
    };

    // Extract the `renderItem` property so we can call it in `useCallback()`
    // without depending on the whole `activeGridViewResult` object. If we
    // called `activeGridViewResult.renderItem()` then
    // `activeGridViewResult` would be assigned to `this` in `renderItem`
    // and React would need to add a dependency on `activeGridViewResult`
    // to the `useCallback()`.
    const renderActiveGridViewItem = activeGridViewResult.renderItem;
    const renderOverdueGridViewItem = overdueGridViewResult.renderItem;
    const renderDueTodayGridViewItem = dueTodayGridViewResult.renderItem;
    const renderDueSoonGridViewItem = dueSoonGridViewResult.renderItem;
    const renderRemainingGridViewItem = remainingGridViewResult.renderItem;

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            // We don't need to modify the `key` for our items because the queries should
            // be exclusive. If a task shows up in one section it should not show up in
            // any other section.

            let hasFirstHeader = false;

            if (index === 0) {
                if (routeLayout === "narrow") {
                    return {
                        key: "NavigationBar",
                        minHeight: spacing[navigationBarHeight],
                        node: (
                            <>
                                <Box height="safe-area-inset-top" />
                                <Box height={navigationBarHeight} />
                            </>
                        ),
                    };
                } else {
                    return {
                        key: "NavigationBar",
                        minHeight: !isRemainingGridViewHeaderVisible
                            ? addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight)
                            : spacing[navigationBarHeight],
                        withManualLayout: true,
                        render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                            <TaskPersonalNavigationBar
                                itemRef={ref}
                                store={store}
                                offset={offset}
                                shouldRenderWithRelativePositioning={
                                    shouldRenderWithRelativePositioning
                                }
                                withoutRemainingGridViewHeader={!isRemainingGridViewHeaderVisible}
                                visibleSectionState={visibleSectionState}
                                menuActions={navigationBarMenuActions}
                            />
                        ),
                    };
                }
            }

            index -= 1;

            if (!isActiveGridViewEmpty) {
                if (index === 0) {
                    if (routeLayout === "narrow" || hasFirstHeader) {
                        return {
                            key: "ActiveHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            zIndex: "40",
                            node: <TaskPersonalViewHeader name="Active" />,
                        };
                    } else {
                        return {
                            key: "ActiveHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            withManualLayout: true,
                            render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                                <TaskPersonalViewFirstHeaderDesktop
                                    itemRef={ref}
                                    offset={offset}
                                    shouldRenderWithRelativePositioning={
                                        shouldRenderWithRelativePositioning
                                    }
                                    name="Active"
                                />
                            ),
                        };
                    }
                }

                hasFirstHeader = true;
                index -= 1;

                if (index < activeGridViewResult.itemCount) {
                    return renderActiveGridViewItem(index);
                }

                index -= activeGridViewResult.itemCount;
            }

            if (!isOverdueGridViewEmpty) {
                if (index === 0) {
                    if (routeLayout === "narrow" || hasFirstHeader) {
                        return {
                            key: "OverdueHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            zIndex: "40",
                            node: <TaskPersonalViewHeader name="Overdue" />,
                        };
                    } else {
                        return {
                            key: "OverdueHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            withManualLayout: true,
                            render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                                <TaskPersonalViewFirstHeaderDesktop
                                    itemRef={ref}
                                    offset={offset}
                                    shouldRenderWithRelativePositioning={
                                        shouldRenderWithRelativePositioning
                                    }
                                    name="Overdue"
                                />
                            ),
                        };
                    }
                }

                hasFirstHeader = true;
                index -= 1;

                if (index < overdueGridViewResult.itemCount) {
                    return renderOverdueGridViewItem(index);
                }

                index -= overdueGridViewResult.itemCount;
            }

            if (!isDueTodayGridViewEmpty) {
                if (index === 0) {
                    if (routeLayout === "narrow" || hasFirstHeader) {
                        return {
                            key: "DueTodayHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            zIndex: "40",
                            node: <TaskPersonalViewHeader name="Due today" />,
                        };
                    } else {
                        return {
                            key: "DueTodayHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            withManualLayout: true,
                            render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                                <TaskPersonalViewFirstHeaderDesktop
                                    itemRef={ref}
                                    offset={offset}
                                    shouldRenderWithRelativePositioning={
                                        shouldRenderWithRelativePositioning
                                    }
                                    name="Due today"
                                />
                            ),
                        };
                    }
                }

                hasFirstHeader = true;
                index -= 1;

                if (index < dueTodayGridViewResult.itemCount) {
                    return renderDueTodayGridViewItem(index);
                }

                index -= dueTodayGridViewResult.itemCount;
            }

            if (!isDueSoonGridViewEmpty) {
                if (index === 0) {
                    if (routeLayout === "narrow" || hasFirstHeader) {
                        return {
                            key: "DueSoonHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            zIndex: "40",
                            node: <TaskPersonalViewHeader name="Due soon" />,
                        };
                    } else {
                        return {
                            key: "DueSoonHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            withManualLayout: true,
                            render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                                <TaskPersonalViewFirstHeaderDesktop
                                    itemRef={ref}
                                    offset={offset}
                                    shouldRenderWithRelativePositioning={
                                        shouldRenderWithRelativePositioning
                                    }
                                    name="Due soon"
                                />
                            ),
                        };
                    }
                }

                hasFirstHeader = true;
                index -= 1;

                if (index < dueSoonGridViewResult.itemCount) {
                    return renderDueSoonGridViewItem(index);
                }

                index -= dueSoonGridViewResult.itemCount;
            }

            if (isRemainingGridViewHeaderVisible) {
                if (index === 0) {
                    return {
                        key: "RemainingHeader",
                        minHeight: taskPersonalViewHeaderHeight[routeLayout],
                        zIndex: "40",
                        node: <TaskPersonalViewHeader name="Tasks" />,
                    };
                }

                index -= 1;
            }

            if (index < remainingGridViewResult.itemCount) {
                return renderRemainingGridViewItem(index);
            }

            index -= remainingGridViewResult.itemCount;

            throw new OutOfRangeError("Index out of personal task view bounds");
        },
        [
            isActiveGridViewEmpty,
            isOverdueGridViewEmpty,
            isDueTodayGridViewEmpty,
            isDueSoonGridViewEmpty,
            isRemainingGridViewHeaderVisible,
            remainingGridViewResult.itemCount,
            routeLayout,
            store,
            visibleSectionState,
            navigationBarMenuActions,
            activeGridViewResult.itemCount,
            renderActiveGridViewItem,
            overdueGridViewResult.itemCount,
            renderOverdueGridViewItem,
            dueTodayGridViewResult.itemCount,
            renderDueTodayGridViewItem,
            dueSoonGridViewResult.itemCount,
            renderDueSoonGridViewItem,
            renderRemainingGridViewItem,
        ],
    );

    return (
        <Box
            position="relative"
            zIndex="0"
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            className={tasksStyles.textCursorNotInherited2ClassName}
            {...useOutOfBoundsClickSelection({
                // Accept clicks on our `<VirtualizedScrollView>` child too.
                accept: event =>
                    event.target === event.currentTarget ||
                    (event.target instanceof Element &&
                        event.target.parentElement === event.currentTarget),
                onSelect: focusEnd,
                onSelectAll: focusEnd,
            })}
        >
            {activeGridViewResult.modals}
            {overdueGridViewResult.modals}
            {dueTodayGridViewResult.modals}
            {dueSoonGridViewResult.modals}
            {remainingGridViewResult.modals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={scrollViewRef}
                    bufferedItemHeight={spacing[taskRowViewMinHeight]}
                    itemCount={
                        // `NavigationBar`
                        1 +
                        (!isActiveGridViewEmpty
                            ? // `ActiveHeader`
                              1 + activeGridViewResult.itemCount
                            : 0) +
                        (!isOverdueGridViewEmpty
                            ? // `OverdueHeader`
                              1 + overdueGridViewResult.itemCount
                            : 0) +
                        (!isDueTodayGridViewEmpty
                            ? // `DueTodayHeader`
                              1 + dueTodayGridViewResult.itemCount
                            : 0) +
                        (!isDueSoonGridViewEmpty
                            ? // `DueSoonHeader`
                              1 + dueSoonGridViewResult.itemCount
                            : 0) +
                        (!isActiveGridViewEmpty ||
                        !isOverdueGridViewEmpty ||
                        !isDueTodayGridViewEmpty ||
                        !isDueSoonGridViewEmpty
                            ? // `RemainingHeader`
                              1
                            : 0) +
                        remainingGridViewResult.itemCount
                    }
                    alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalItemIndexes}
                    scrollbarInsetTop={
                        routeLayout === "narrow"
                            ? scrollbarInsetTop ?? safeAreaOnlyScrollbarInsetTop
                            : undefined
                    }
                    scrollbarInsetTopItemIndex={
                        routeLayout !== "narrow"
                            ? isRemainingGridViewHeaderVisible
                                ? 1
                                : 0
                            : undefined
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={range => {
                        let runningItemCount = 0;

                        // `NavigationBar`
                        runningItemCount += 1;

                        if (!isActiveGridViewEmpty) {
                            // `ActiveHeader`
                            runningItemCount += 1;

                            activeGridViewResult.onRenderedRangeChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    activeGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += activeGridViewResult.itemCount;
                        }

                        if (!isOverdueGridViewEmpty) {
                            // `OverdueHeader`
                            runningItemCount += 1;

                            overdueGridViewResult.onRenderedRangeChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    overdueGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += overdueGridViewResult.itemCount;
                        }

                        if (!isDueTodayGridViewEmpty) {
                            // `DueTodayHeader`
                            runningItemCount += 1;

                            dueTodayGridViewResult.onRenderedRangeChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    dueTodayGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += dueTodayGridViewResult.itemCount;
                        }

                        if (!isDueSoonGridViewEmpty) {
                            // `DueSoonHeader`
                            runningItemCount += 1;

                            dueSoonGridViewResult.onRenderedRangeChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    dueSoonGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += dueSoonGridViewResult.itemCount;
                        }

                        if (
                            !isActiveGridViewEmpty ||
                            !isOverdueGridViewEmpty ||
                            !isDueTodayGridViewEmpty ||
                            !isDueSoonGridViewEmpty
                        ) {
                            // `RemainingHeader`
                            runningItemCount += 1;
                        }

                        remainingGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                remainingGridViewResult.itemCount,
                                range,
                            ),
                        );
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onRenderedRangeLayoutChangeForOverdueHeader();
                        onRenderedRangeLayoutChangeForDueTodayHeader();
                        onRenderedRangeLayoutChangeForDueSoonHeader();
                        onRenderedRangeLayoutChangeForRemainingHeader();

                        let runningItemCount = 0;

                        // `NavigationBar`
                        runningItemCount += 1;

                        if (!isActiveGridViewEmpty) {
                            // `ActiveHeader`
                            runningItemCount += 1;

                            activeGridViewResult.onRenderedRangeLayoutChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    activeGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += activeGridViewResult.itemCount;
                        }

                        if (!isOverdueGridViewEmpty) {
                            // `OverdueHeader`
                            runningItemCount += 1;

                            overdueGridViewResult.onRenderedRangeLayoutChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    overdueGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += overdueGridViewResult.itemCount;
                        }

                        if (!isDueTodayGridViewEmpty) {
                            // `DueTodayHeader`
                            runningItemCount += 1;

                            dueTodayGridViewResult.onRenderedRangeLayoutChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    dueTodayGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += dueTodayGridViewResult.itemCount;
                        }

                        if (!isDueSoonGridViewEmpty) {
                            // `DueSoonHeader`
                            runningItemCount += 1;

                            dueSoonGridViewResult.onRenderedRangeLayoutChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    dueSoonGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += dueSoonGridViewResult.itemCount;
                        }

                        if (
                            !isActiveGridViewEmpty ||
                            !isOverdueGridViewEmpty ||
                            !isDueTodayGridViewEmpty ||
                            !isDueSoonGridViewEmpty
                        ) {
                            // `RemainingHeader`
                            runningItemCount += 1;
                        }

                        remainingGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                remainingGridViewResult.itemCount,
                                range,
                            ),
                        );
                    }}
                    onScroll={handleScroll}
                    onStateChange={handleStateChange}
                    extraChildren={navigationBar}
                />
            </GlobalKeyDownEvent>
            <TaskFloatingCreateButton />
        </Box>
    );
}

function useTaskGridViewVirtualizedListViewRef(
    viewRef: RefObject<VirtualizedScrollViewRef>,
    previousItemCount: number,
    getItemCount: Memo<() => number>,
): RefObject<TaskGridViewVirtualizedListViewRef> {
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const getPreviousItemCount = useEvent(() => previousItemCount);

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of
    // items which precede our children grid view.
    useImperativeHandle(
        gridViewRef,
        () => ({
            getHeight: () => assertExists(viewRef.current).getHeight(),
            getContentHeight: () => assertExists(viewRef.current).getContentHeight(),
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: scrollOffset =>
                assertExists(viewRef.current).setScrollOffset(scrollOffset),
            scrollToIndex: (index, options) => {
                if (index < 0 || index >= getItemCount())
                    throw new OutOfRangeError("Index out of bounds (in task sub-grid view)");

                index += getPreviousItemCount();

                assertExists(viewRef.current).scrollToIndex(index, options);
            },
            getRenderedRange: () =>
                shiftRenderedRange(
                    getPreviousItemCount(),
                    getItemCount(),
                    assertExists(viewRef.current).getRenderedRange(),
                ),
            getKeyByIndexIfExists: index => {
                if (index < 0 || index >= getItemCount())
                    throw new OutOfRangeError("Index out of bounds (in task sub-grid view)");

                index += getPreviousItemCount();

                return assertExists(viewRef.current).getKeyByIndexIfExists(index);
            },
            getIndexByKeyIfExists: key => {
                let index = assertExists(viewRef.current).getIndexByKeyIfExists(key);
                if (index === null) return index;
                index -= getPreviousItemCount();
                if (index < 0 || index >= getItemCount()) return null;
                return index;
            },
            getPositionByIndex: index => {
                if (index < 0 || index >= getItemCount())
                    throw new OutOfRangeError("Index out of bounds (in task sub-grid view)");

                index += getPreviousItemCount();

                return assertExists(viewRef.current).getPositionByIndex(index);
            },
            getPositionByKeyIfExists: key =>
                assertExists(viewRef.current).getPositionByKeyIfExists(key),
            peekRenderedRangeAfterSetScrollOffset: scrollOffset => {
                return shiftRenderedRange(
                    getPreviousItemCount(),
                    getItemCount(),
                    assertExists(viewRef.current).peekRenderedRangeAfterSetScrollOffset(
                        scrollOffset,
                    ),
                );
            },
            getElement: () => assertExists(viewRef.current).getElement(),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getElementByKeyIfExists: key =>
                assertExists(viewRef.current).getElementByKeyIfExists(key),
        }),
        [getItemCount, getPreviousItemCount, viewRef],
    );

    return gridViewRef;
}

function shiftRenderedRange(
    previousItemCount: number,
    itemCount: number,
    range: {startIndex: number; endIndex: number} | null,
) {
    if (!range) return null;
    if (itemCount === 0) return null;

    const startIndex = range.startIndex - previousItemCount;
    const endIndex = range.endIndex - previousItemCount;

    if (endIndex < 0 || startIndex >= itemCount) {
        return null;
    } else {
        return {
            startIndex: Math.max(startIndex, 0),
            endIndex: Math.min(endIndex, itemCount - 1),
        };
    }
}

const TaskPersonalNavigationBar = memo(function TaskPersonalNavigationBar({
    itemRef,
    store,
    offset,
    shouldRenderWithRelativePositioning,
    withoutRemainingGridViewHeader,
    visibleSectionState,
    menuActions,
}: {
    itemRef: Ref<HTMLDivElement>;
    store: TaskClientStore;
    offset: number;
    shouldRenderWithRelativePositioning: boolean;
    withoutRemainingGridViewHeader: boolean;
    visibleSectionState: {
        section: TaskPersonalViewVisibleSection | null;
        previousSections: ReadonlySet<TaskPersonalViewVisibleSection>;
    };
    menuActions: ReadonlyArray<MenuAction>;
}) {
    return (
        <div
            className={pointerEventsNoneNotInheritedClassName}
            style={{
                zIndex: "50",
                ...(shouldRenderWithRelativePositioning
                    ? {position: "relative"}
                    : {
                          position: "absolute",
                          top: offset,
                          bottom: 0,
                          left: 0,
                          right: 0,
                      }),
            }}
        >
            <Box
                ref={itemRef}
                position="sticky"
                top="0"
                paddingTop="safe-area-inset"
                backgroundColor="grey-0"
            >
                <Box display="flex" alignItems="center" paddingRight={screenPaddingX.desktop}>
                    <TaskPersonalNavigationBarTitleDesktop
                        paddingLeft="10"
                        visibleSectionState={visibleSectionState}
                    />
                    <Box flexGrow="1" />
                    <TaskPersonalNavigationBarCollectionsButton store={store} />
                    <Box paddingLeft="4" flexShrink="0">
                        <MenuButton placement="bottom-end" actions={menuActions}>
                            <IconButton size="md" description="More" withoutTooltip={true}>
                                <DotsThreeVertical />
                            </IconButton>
                        </MenuButton>
                    </Box>
                </Box>
                {withoutRemainingGridViewHeader && (
                    <>
                        <TaskGridViewColumnHeader withoutAssigneeField />
                        <Box zIndex="-10" position="absolute" inset="0" backgroundColor="grey-0">
                            <Box
                                position="absolute"
                                left={screenPaddingX}
                                right={screenPaddingX}
                                height="border"
                                backgroundColor="grey-5-translucent"
                                style={{bottom: -1}}
                            />
                        </Box>
                    </>
                )}
            </Box>
        </div>
    );
});

const TaskPersonalNavigationBarTitleDesktop = memo(function TaskPersonalNavigationBarTitleDesktop({
    paddingLeft,
    visibleSectionState,
}: {
    paddingLeft: Spacing;
    visibleSectionState: {
        section: TaskPersonalViewVisibleSection | null;
        previousSections: ReadonlySet<TaskPersonalViewVisibleSection>;
    };
}) {
    const spacingScale = useSpacingScale();

    const hasActivePreviousVisibleSection = visibleSectionState.previousSections.has("Active");
    const hasOverduePreviousVisibleSection = visibleSectionState.previousSections.has("Overdue");
    const hasDueTodayPreviousVisibleSection = visibleSectionState.previousSections.has("DueToday");
    const hasDueSoonPreviousVisibleSection = visibleSectionState.previousSections.has("DueSoon");

    const isActiveVisibleSection = visibleSectionState.section === "Active";
    const isOverdueVisibleSection = visibleSectionState.section === "Overdue";
    const isDueTodayVisibleSection = visibleSectionState.section === "DueToday";
    const isDueSoonVisibleSection = visibleSectionState.section === "DueSoon";

    return (
        <Box
            flexShrink="0"
            display="flex"
            alignItems="center"
            height={navigationBarHeight}
            paddingLeft={paddingLeft}
        >
            <Box display="flex" alignItems="baseline" gap="3">
                <h1 className={sprinkles({fontSize: "400", fontStyle: "bold"})}>My tasks</h1>
                <Box
                    position="relative"
                    width="24"
                    fontSize="100"
                    fontStyle="semi-bold"
                    color="grey-50"
                    style={{
                        fontSize:
                            fontSizesBySpacingScale["400"][spacingScale].fontSize *
                            (interFontXHeight / interFontCapHeight),
                    }}
                >
                    <Box
                        aria-hidden={!isActiveVisibleSection}
                        // We can only use fade in/out animation classes if the section has previously
                        // been visible. Otherwise we animate on initial mount which is wrong.
                        opacity={
                            !hasActivePreviousVisibleSection && !isActiveVisibleSection
                                ? "0"
                                : undefined
                        }
                        className={
                            isActiveVisibleSection
                                ? navigationBarStyles.titleFadeInAnimationClassName
                                : hasActivePreviousVisibleSection
                                ? navigationBarStyles.titleFadeOutAnimationClassName
                                : undefined
                        }
                    >
                        Active
                    </Box>
                    <Box
                        aria-hidden={!isOverdueVisibleSection}
                        // We can only use fade in/out animation classes if the section has previously
                        // been visible. Otherwise we animate on initial mount which is wrong.
                        opacity={
                            !hasOverduePreviousVisibleSection && !isOverdueVisibleSection
                                ? "0"
                                : undefined
                        }
                        className={
                            isOverdueVisibleSection
                                ? navigationBarStyles.titleFadeInAnimationClassName
                                : hasOverduePreviousVisibleSection
                                ? navigationBarStyles.titleFadeOutAnimationClassName
                                : undefined
                        }
                        position="absolute"
                        left="0"
                        top="0"
                    >
                        Overdue
                    </Box>
                    <Box
                        aria-hidden={!isDueTodayVisibleSection}
                        // We can only use fade in/out animation classes if the section has previously
                        // been visible. Otherwise we animate on initial mount which is wrong.
                        opacity={
                            !hasDueTodayPreviousVisibleSection && !isDueTodayVisibleSection
                                ? "0"
                                : undefined
                        }
                        className={
                            isDueTodayVisibleSection
                                ? navigationBarStyles.titleFadeInAnimationClassName
                                : hasDueTodayPreviousVisibleSection
                                ? navigationBarStyles.titleFadeOutAnimationClassName
                                : undefined
                        }
                        position="absolute"
                        left="0"
                        top="0"
                    >
                        Due today
                    </Box>
                    <Box
                        aria-hidden={!isDueSoonVisibleSection}
                        // We can only use fade in/out animation classes if the section has previously
                        // been visible. Otherwise we animate on initial mount which is wrong.
                        opacity={
                            !hasDueSoonPreviousVisibleSection && !isDueSoonVisibleSection
                                ? "0"
                                : undefined
                        }
                        className={
                            isDueSoonVisibleSection
                                ? navigationBarStyles.titleFadeInAnimationClassName
                                : hasDueSoonPreviousVisibleSection
                                ? navigationBarStyles.titleFadeOutAnimationClassName
                                : undefined
                        }
                        position="absolute"
                        left="0"
                        top="0"
                    >
                        Due soon
                    </Box>
                </Box>
            </Box>
        </Box>
    );
});

const taskPersonalViewHeaderNameHeight = "10";
const taskPersonalViewHeaderHeight: Record<RouteLayout, RemLength> = {
    wide: addRemLengths(taskPersonalViewHeaderNameHeight, taskGridViewColumnHeaderHeight),
    narrow: spacing[taskPersonalViewHeaderNameHeight],
};

const TaskPersonalViewHeader = memo(function TaskPersonalViewHeader({name}: {name: string}) {
    const routeLayout = useRouteLayout();

    return (
        <>
            <Box
                height={taskPersonalViewHeaderNameHeight}
                display="flex"
                alignItems="center"
                paddingLeft={routeLayout === "narrow" ? "5" : "10"}
            >
                <h2
                    className={sprinkles({
                        fontSize: "200",
                        fontStyle: "bold",
                        color: "grey-90",
                    })}
                >
                    {name}
                </h2>
            </Box>
            {routeLayout !== "narrow" && <TaskGridViewColumnHeader withoutAssigneeField />}
            <Box zIndex="-10" position="absolute" inset="0" backgroundColor="grey-0" />
        </>
    );
});

const TaskPersonalViewFirstHeaderDesktop = memo(function TaskPersonalViewFirstHeaderDesktop({
    itemRef,
    offset,
    shouldRenderWithRelativePositioning,
    name,
}: {
    itemRef: Ref<HTMLDivElement>;
    offset: number;
    shouldRenderWithRelativePositioning: boolean;
    name: string;
}) {
    const routeLayout = useRouteLayout();

    return (
        <div
            className={pointerEventsNoneNotInheritedClassName}
            style={{
                ...(shouldRenderWithRelativePositioning
                    ? {position: "relative"}
                    : {
                          position: "absolute",
                          top: offset,
                          bottom: 0,
                          left: 0,
                          right: 0,
                      }),
            }}
        >
            <Box
                ref={itemRef}
                zIndex="40"
                style={{height: taskPersonalViewHeaderHeight[routeLayout]}}
            >
                <Box
                    height={taskPersonalViewHeaderNameHeight}
                    display="flex"
                    alignItems="center"
                    paddingLeft="10"
                >
                    <h2
                        className={sprinkles({
                            fontSize: "200",
                            fontStyle: "bold",
                            color: "grey-90",
                        })}
                    >
                        {name}
                    </h2>
                </Box>
            </Box>
            <Box
                position="sticky"
                zIndex="50"
                marginTop={
                    routeLayout !== "narrow" ? `-${taskGridViewColumnHeaderHeight}` : undefined
                }
                style={{
                    top: `calc(${spacing[navigationBarHeight]} + var(--safe-area-inset-top, 0px))`,
                }}
            >
                {routeLayout !== "narrow" && <TaskGridViewColumnHeader withoutAssigneeField />}
                <Box zIndex="-10" position="absolute" inset="0" backgroundColor="grey-0">
                    <Box
                        position="absolute"
                        left={screenPaddingX}
                        right={screenPaddingX}
                        height="border"
                        backgroundColor="grey-5-translucent"
                        style={{bottom: -1}}
                    />
                </Box>
            </Box>
        </div>
    );
});

function useTaskPersonalViewHeaderAnimations(gridViewResult: {
    stateItemCount: number;
    itemCount: number;
}) {
    const routeLayout = useRouteLayout();

    const [animations, setAnimations] = useStateWithDependencies(
        (
            [stateItemCount, itemCount]: readonly [number, number],
            previousAnimations: ReadonlyArray<TaskGridViewVirtualizedListAnimation> | undefined,
            previousDependencies: readonly [number, number] | undefined,
        ): ReadonlyArray<TaskGridViewVirtualizedListAnimation> => {
            if (previousAnimations === undefined || previousDependencies === undefined)
                return emptyArray;

            const [previousStateCount, previousItemCount] = previousDependencies;

            const isEmpty = itemCount === 0;
            const previousIsEmpty = previousItemCount === 0;

            // Only add animations if the task grid view is appearing or disappearing.
            if (isEmpty === previousIsEmpty) return previousAnimations;

            const nonStateItemCount = itemCount - stateItemCount;
            const previousNonStateItemCount = previousItemCount - previousStateCount;

            const nonStateItemCountDifference = nonStateItemCount - previousNonStateItemCount;

            if (nonStateItemCountDifference === 0) {
                return previousAnimations;
            } else if (nonStateItemCountDifference < 0) {
                const heightRem =
                    parseRemLength(taskPersonalViewHeaderHeight[routeLayout]) +
                    // We assume all non-state items have a height of `taskRowViewMinHeight`. This
                    // is true for the bottom ghost task and decorative ghost rows. The grid view
                    // shouldn't have a column header so it's safe to assume all non-state items
                    // have a height of `taskRowViewMinHeight`.
                    parseRemLength(taskRowViewMinHeight) * -nonStateItemCountDifference +
                    parseRemLength(taskGridViewPaddingBottomWithNext);

                return [
                    ...previousAnimations,
                    {
                        type: "Delete",
                        startTime: Date.now(),
                        // Take a little longer for header create/delete animations so everything
                        // doesn't move too fast.
                        duration: taskAnimationDurationMs * 2,
                        kind: "Unknown",
                        height: `${heightRem}rem`,
                    },
                ];
            } else {
                assert(nonStateItemCountDifference > 0);

                const heightRem =
                    parseRemLength(taskPersonalViewHeaderHeight[routeLayout]) +
                    // We assume all non-state items have a height of `taskRowViewMinHeight`. This
                    // is true for the bottom ghost task and decorative ghost rows. The grid view
                    // shouldn't have a column header so it's safe to assume all non-state items
                    // have a height of `taskRowViewMinHeight`.
                    parseRemLength(taskRowViewMinHeight) * nonStateItemCountDifference +
                    parseRemLength(taskGridViewPaddingBottomWithNext);

                return [
                    ...previousAnimations,
                    {
                        type: "Create",
                        startTime: Date.now(),
                        // Take a little longer for header create/delete animations so everything
                        // doesn't move too fast.
                        duration: taskAnimationDurationMs * 2,
                        kind: "Unknown",
                        height: `${heightRem}rem`,
                    },
                ];
            }
        },
        [gridViewResult.stateItemCount, gridViewResult.itemCount],
    );

    // Cleanup animations from our state when they finish.
    useEffect(() => {
        const currentTime = Date.now();
        let minDuration = Infinity;

        for (const animation of animations) {
            const endTime = animation.startTime + animation.duration;

            minDuration = Math.min(minDuration, endTime - currentTime);
        }

        const cleanup = () => {
            setAnimations(animations => {
                const currentTime = Date.now();

                const newAnimations: Array<TaskGridViewVirtualizedListAnimation> = [];

                for (const animation of animations) {
                    const endTime = animation.startTime + animation.duration;

                    if (endTime > currentTime) {
                        newAnimations.push(animation);
                    }
                }

                // Optimization: No animations expired. We can avoid a re-render.
                if (newAnimations.length === animations.length) {
                    return animations;
                }

                return newAnimations;
            });
        };

        if (minDuration <= 0) {
            cleanup();
            return;
        }

        // If there are no animations then `minDuration` is `Infinity`
        if (!isFinite(minDuration)) return;

        const timeout = createTimeout(cleanup, minDuration);
        return () => timeout.clear();
    }, [animations, setAnimations]);

    return animations;
}

function useTaskPersonalViewRemainingHeaderAnimations(isRemainingHeaderVisible: boolean) {
    const [animations, setAnimations] = useStateWithDependencies(
        (
            [isRemainingHeaderVisible]: readonly [boolean],
            previousAnimations: ReadonlyArray<TaskGridViewVirtualizedListAnimation> | undefined,
            previousDependencies: readonly [boolean] | undefined,
        ): ReadonlyArray<TaskGridViewVirtualizedListAnimation> => {
            if (previousAnimations === undefined || previousDependencies === undefined)
                return emptyArray;

            const [previousIsRemainingHeaderVisible] = previousDependencies;

            if (isRemainingHeaderVisible === previousIsRemainingHeaderVisible) {
                return previousAnimations;
            } else if (!isRemainingHeaderVisible) {
                return [
                    ...previousAnimations,
                    {
                        type: "Delete",
                        startTime: Date.now(),
                        duration: taskAnimationDurationMs,
                        kind: "Unknown",
                        // Only the header name height since the column height will be added to the
                        // navigation bar item.
                        height: taskPersonalViewHeaderNameHeight,
                    },
                ];
            } else {
                assert(isRemainingHeaderVisible);

                return [
                    ...previousAnimations,
                    {
                        type: "Create",
                        startTime: Date.now(),
                        duration: taskAnimationDurationMs,
                        kind: "Unknown",
                        // Only the header name height since the column height will be added to the
                        // navigation bar item.
                        height: taskPersonalViewHeaderNameHeight,
                    },
                ];
            }
        },
        [isRemainingHeaderVisible],
    );

    // Cleanup animations from our state when they finish.
    useEffect(() => {
        const currentTime = Date.now();
        let minDuration = Infinity;

        for (const animation of animations) {
            const endTime = animation.startTime + animation.duration;

            minDuration = Math.min(minDuration, endTime - currentTime);
        }

        const cleanup = () => {
            setAnimations(animations => {
                const currentTime = Date.now();

                const newAnimations: Array<TaskGridViewVirtualizedListAnimation> = [];

                for (const animation of animations) {
                    const endTime = animation.startTime + animation.duration;

                    if (endTime > currentTime) {
                        newAnimations.push(animation);
                    }
                }

                // Optimization: No animations expired. We can avoid a re-render.
                if (newAnimations.length === animations.length) {
                    return animations;
                }

                return newAnimations;
            });
        };

        if (minDuration <= 0) {
            cleanup();
            return;
        }

        // If there are no animations then `minDuration` is `Infinity`
        if (!isFinite(minDuration)) return;

        const timeout = createTimeout(cleanup, minDuration);
        return () => timeout.clear();
    }, [animations, setAnimations]);

    return animations;
}
