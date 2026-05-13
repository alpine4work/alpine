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
import {useAlignFontBaselines} from "~/client/web/design/use_align_font_baselines.js";
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
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {pointerEventsNoneNotInheritedClassName, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskGridViewColumnHeaderHeight,
    taskGridViewPaddingBottomWithNext,
    taskQueryViewCustomizationBarDesktopMarginY,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {getNewTaskPositionsForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_positions_for_query_sorted_by_position.js";
import {TaskFloatingCreateButton} from "~/client/web/tasks/internal/task_floating_create_button.js";
import {TaskGridViewCapabilities} from "~/client/web/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewColumnHeader} from "~/client/web/tasks/internal/task_grid_view_column_header.js";
import {TaskGridViewHasDndContext} from "~/client/web/tasks/internal/task_grid_view_has_dnd_context.js";
import {
    useTaskGridViewVirtualizedListBase,
    useTaskGridViewVirtualizedListItemAnimation,
    useTaskGridViewVirtualizedListScrollToAvoidBottomBarsAndMobileKeyboard,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewDecorativeGhostTaskMemo} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_components.js";
import {
    TaskGridViewVirtualizedListAnimation,
    taskAnimationDurationMs,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_state.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/web/tasks/internal/task_query_view_customization_bar.js";
import {
    TaskQueryViewCustomizationMobileSection,
    TaskQueryViewCustomizationMobileSectionRef,
} from "~/client/web/tasks/internal/task_query_view_customization_mobile_section.js";
import {
    TaskUndoStackEntry,
    useTaskUndoStackState,
} from "~/client/web/tasks/internal/use_task_undo_stack_state.js";
import {TaskGridViewDraggableData} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {
    TaskPersonalViewSectionQueryOptions,
    useTaskPersonalViewQueryState,
} from "~/client/web/tasks/use_task_personal_view_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {
    RemLength,
    addRemLengths,
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {OutOfRangeError} from "~/shared/error/error.js";
import {concatReadonlyArrays} from "~/shared/helpers/array/concat_readonly_arrays.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

type TaskPersonalViewSection =
    | "Active"
    | "Overdue"
    | "DueToday"
    | "DueSoon"
    | "Closed"
    | "Remaining";

const defaultOrderSentence = "Tasks are grouped by status and due date.";
const excludeFilters = new Set<TaskQueryFilter["type"]>(["Assignee"]);

export function TaskPersonalView({
    store,
    activeQuery: initialActiveQuery,
    overdueQuery: initialOverdueQuery,
    dueTodayQuery: initialDueTodayQuery,
    dueSoonQuery: initialDueSoonQuery,
    closedQuery: initialclosedQuery,
    remainingQuery: initialRemainingQuery,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
    affinityManager,
    initialIsFavorite,
}: {
    store: TaskClientStore;
    activeQuery: TaskPersonalViewSectionQueryOptions | null;
    overdueQuery: TaskPersonalViewSectionQueryOptions | null;
    dueTodayQuery: TaskPersonalViewSectionQueryOptions | null;
    dueSoonQuery: TaskPersonalViewSectionQueryOptions | null;
    closedQuery: TaskPersonalViewSectionQueryOptions | null;
    remainingQuery: TaskPersonalViewSectionQueryOptions | null;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialIsFavorite: boolean;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {isAppleDevice, timeZone} = useClientInfo();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    // Filter/sort state for customization bar
    const [{filters, filterReferences}, actuallySetFiltersState] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
    });
    const [sorts, actuallySetSorts] = useState(initialSorts);

    const desktopCustomizationBarRef = useRef<TaskQueryViewCustomizationBarRef>(null);
    const mobileCustomizationSectionRef = useRef<TaskQueryViewCustomizationMobileSectionRef>(null);
    const [customizationState, setCustomizationState] = useState<{
        initiallyFocus: "AddFilter" | "AddSort" | null;
    } | null>(filters.length > 0 || sorts.length > 0 ? {initiallyFocus: null} : null);
    if (!customizationState && (filters.length > 0 || sorts.length > 0)) {
        setCustomizationState({initiallyFocus: null});
    }

    const {
        queries: [
            activeQuery,
            overdueQuery,
            dueTodayQuery,
            dueSoonQuery,
            closedQuery,
            remainingQuery,
        ],
        activeFilters,
    } = useTaskPersonalViewQueryState({
        filters,
        store,
        sorts,
        currentAccount,
        initialActiveQuery,
        initialOverdueQuery,
        initialDueTodayQuery,
        initialDueSoonQuery,
        initialclosedQuery,
        initialRemainingQuery,
    });

    assert(
        activeQuery !== undefined &&
            overdueQuery !== undefined &&
            dueTodayQuery !== undefined &&
            dueSoonQuery !== undefined &&
            closedQuery !== undefined &&
            remainingQuery !== undefined,
    );

    const {updateFilters, setSorts} = useEvents({
        updateFilters: (
            newFilters: ReadonlyArray<TaskQueryFilter>,
            {
                mergeFilterReferences: mergeRefs,
            }: {mergeFilterReferences?: TaskQueryFilterReferences} = {},
        ) => {
            actuallySetFiltersState(({filterReferences: refs}) => ({
                filters: newFilters,
                filterReferences: mergeRefs
                    ? mergeTaskQueryFilterReferences(refs, mergeRefs)
                    : refs,
            }));
            onFiltersChange(newFilters);
        },
        setSorts: (newSorts: ReadonlyArray<TaskQuerySort>) => {
            actuallySetSorts(newSorts);
            onSortsChange(newSorts);
        },
    });

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
                case "Closed":
                    applyUndoStackEntry = closedGridViewResult.applyUndoStackEntry;
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
                case "Closed":
                    applyUndoStackEntry = closedGridViewResult.applyUndoStackEntry;
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
     *                               Navigation Bar                               *
    \* ========================================================================== */

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction("TaskPersonal", initialIsFavorite);

    const navigationBarMenuActions = useMemo((): ReadonlyArray<ReadonlyArray<MenuAction>> => {
        const menuActions: Array<ReadonlyArray<MenuAction>> = [
            [
                {
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    pressErrorTitle: "Couldn\u2019t copy link",
                    onPress: async () => {
                        const url = new URL(`/s/${space.id}/tasks`, window.location.href);
                        await writeTextToClipboard(url.toString());
                    },
                },
                ...(favoriteMenuAction ? [favoriteMenuAction] : []),
            ],
        ];

        if (routeLayout === "narrow") {
            // eslint-disable-next-line react-compiler/react-compiler
            menuActions.push([
                {
                    label: "Add filter",
                    onPress: () => {
                        // Make sure the filter/sort section is visible.
                        assertExists(viewRef.current).setScrollOffset(0);

                        if (!customizationState) {
                            setCustomizationState({initiallyFocus: "AddFilter"});
                        } else {
                            if (platform === "mobile") {
                                assertExists(
                                    mobileCustomizationSectionRef.current,
                                ).openAddFilterMenu();
                            } else {
                                assertExists(
                                    desktopCustomizationBarRef.current,
                                ).openAddFilterMenu();
                            }
                        }
                    },
                },
                {
                    label: "Add sort",
                    onPress: () => {
                        // Make sure the filter/sort section is visible.
                        assertExists(viewRef.current).setScrollOffset(0);

                        if (!customizationState) {
                            setCustomizationState({initiallyFocus: "AddSort"});
                        } else {
                            if (platform === "mobile") {
                                assertExists(
                                    mobileCustomizationSectionRef.current,
                                ).openAddSortMenu();
                            } else {
                                assertExists(desktopCustomizationBarRef.current).openAddSortMenu();
                            }
                        }
                    },
                },
            ]);
        }

        return menuActions;
    }, [favoriteMenuAction, space.id, platform, routeLayout, customizationState]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: routeLayout !== "narrow",
        withoutDisappearingTitle: true,
        title: "My tasks",
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
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
        getClosedItemCount: () => closedGridViewResult.itemCount,
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
                withoutDueDateField: false,
                withoutCollectionsField: false,
                hasDenseFields: false,
                isCreatedCollectionFromGhostTaskPrivate: true,
            };
        } else {
            return {
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: true,
                hasColumns: false,
                withoutAssigneeField: true,
                withoutDueDateField: false,
                withoutCollectionsField: false,
                hasDenseFields: true,
                isCreatedCollectionFromGhostTaskPrivate: true,
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
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            if (!activeQuery) return null;

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time3,
                activeQuery.query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;

                actions.push(
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
                            position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
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
        // We won't show the `ActiveHeader` item we added previously if this grid view is
        // empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view items if we
        // determine it to be empty. That way if the effects in the virtualized scroll view
        // check `viewRef.current.getRenderedRange()` we'll accurately return null.
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
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            if (!overdueQuery) return null;

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

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time3,
                overdueQuery.query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;

                actions.push(
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
                            position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
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
        // We won't show the `OverdueHeader` item we added previously if this grid view is
        // empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view items if we
        // determine it to be empty. That way if the effects in the virtualized scroll view
        // check `viewRef.current.getRenderedRange()` we'll accurately return null.
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

    // `DueTodayHeader` (must be before `useTaskGridViewVirtualizedListViewRef()` to
    // shift indexes correctly)
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
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            if (!dueTodayQuery) return null;

            assert(
                dueTodayQuery.query.filters.dueDateFilter?.type === "Range" &&
                    dueTodayQuery.query.filters.dueDateFilter.exclusiveLowerBoundDate,
            );
            const currentDate =
                dueTodayQuery.query.filters.dueDateFilter.exclusiveLowerBoundDate.add({days: 1});

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time3,
                dueTodayQuery.query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;

                actions.push(
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
                            position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
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
        // We won't show the `DueTodayHeader` item we added previously if this grid view is
        // empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view items if we
        // determine it to be empty. That way if the effects in the virtualized scroll view
        // check `viewRef.current.getRenderedRange()` we'll accurately return null.
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

    // `DueSoonHeader` (must be before `useTaskGridViewVirtualizedListViewRef()` to
    // shift indexes correctly)
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
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            if (!dueSoonQuery) return null;

            assert(
                dueSoonQuery.query.filters.dueDateFilter?.type === "Range" &&
                    dueSoonQuery.query.filters.dueDateFilter.exclusiveUpperBoundDate,
            );

            // By default, set due date to one week from today (7 days from now). This should
            // be the same as the upper bound of the due soon date range.
            const currentDate =
                dueSoonQuery.query.filters.dueDateFilter.exclusiveUpperBoundDate.subtract({
                    days: 1,
                });

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time3,
                dueSoonQuery.query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;

                actions.push(
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
                            position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
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
                if (!isClosedGridViewEmpty) {
                    closedGridViewResult.focusFirstTaskTitleStart();
                } else {
                    remainingGridViewResult.focusFirstTaskTitleStart();
                }
            },
            focusFirstTaskTitleCoord: coord => {
                if (!isClosedGridViewEmpty) {
                    closedGridViewResult.focusFirstTaskTitleCoord(coord);
                } else {
                    remainingGridViewResult.focusFirstTaskTitleCoord(coord);
                }
            },
            focusFirstTaskCell: column => {
                if (!isClosedGridViewEmpty) {
                    closedGridViewResult.focusFirstTaskCell(column);
                } else {
                    remainingGridViewResult.focusFirstTaskCell(column);
                }
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
        // We won't show the `DueSoonHeader` item we added previously if this grid view is
        // empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view items if we
        // determine it to be empty. That way if the effects in the virtualized scroll view
        // check `viewRef.current.getRenderedRange()` we'll accurately return null.
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

    // TODO(ifitzsimmons, closed-tasks-section): The Closed Tasks section should be the
    // last section in the personal task view. However, this component is built on the
    // assumption that the remaining section is always last. To avoid bloat in this
    // change, we'll merge as is and follow up with a refactor to make the "Closed"
    // section the last section in the grid when the closed query is not null.
    //
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/203932h5chns4zj4taetzh7zcg

    // `ClosedHeader` (must be before `useTaskGridViewVirtualizedListViewRef()` to
    // shift indexes correctly)
    runningItemCount += 1;

    const closedGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "Closed-",
        capabilities: gridViewCapabilities,
        store,
        query: closedQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getClosedItemCount,
        ),
        // NOTE(ifitzsimmons, 2026-02-22): The closed section only ever shows up when
        // filters are applied, which means that users can never actually edit grid view
        // items in the closed section.
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            if (!closedQuery) return null;

            const time1 = store.clock.now();
            const time2 = store.clock.now();
            const time3 = store.clock.now();

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time3,
                closedQuery.query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;

                actions.push(
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
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: currentAccount.id,
                                closedTime: new TaskFilterableTime({
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
                            position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
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
                    type: "UpdateStatus",
                    status: {type: "Open"},
                },
            },
        ],
        withoutColumnHeader: true,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow" && !hasFirstHeader,
        withoutBottomGhostTask: true,

        isDragging,
        draggingData,
        pushUndoStackEntry: entry => {
            pushUndoStackEntry({...entry, extra: "Closed"});
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

    const isClosedGridViewEmpty =
        closedGridViewResult.stateItemCount === 0 &&
        closedGridViewResult.loadedState === "FullyLoaded";

    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForClosedHeader} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            !isClosedGridViewEmpty ? runningItemCount - 1 : null,
        );

    if (isClosedGridViewEmpty) {
        // We won't show the `ClosedHeader` item we added previously if this grid view is
        // empty.
        runningItemCount -= 1;

        // Safety check: Make sure the grid view has no virtualized scroll view items if we
        // determine it to be empty. That way if the effects in the virtualized scroll view
        // check `viewRef.current.getRenderedRange()` we'll accurately return null.
        assert(closedGridViewResult.itemCount === 0);
    } else {
        // Always render the first header since its column names will be
        // `position: sticky`.
        if (!hasFirstHeader) {
            hasFirstHeader = true;
            alwaysRenderAdditionalItemIndexes.push(runningItemCount - 1);
        }

        for (const index of closedGridViewResult.alwaysRenderAdditionalItemIndexes) {
            alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
        }

        runningItemCount += closedGridViewResult.itemCount;
    }

    const closedGridViewHeaderAnimations =
        useTaskPersonalViewHeaderAnimations(closedGridViewResult);

    previousGridViewAnimations = useMemo(
        () =>
            concatReadonlyArrays(
                previousGridViewAnimations,
                closedGridViewHeaderAnimations,
                closedGridViewResult.animations,
            ),
        [
            closedGridViewHeaderAnimations,
            closedGridViewResult.animations,
            previousGridViewAnimations,
        ],
    );

    // At this point, we don't really know if the remaining grid view header should be
    // visible or not. It is visible when either
    //
    // 1. There are no applied filters and at least one other section is not empty
    //     - The absence of filters means that we always show the remaining tasks
    //       section because it always renders a ghost task row ("Add a task" row)
    // 2. There are filters applied and the remaining section is not empty.
    //     - When filters are applied, users can't add tasks to the grid, so the the
    //       remaining section will not include a ghost task row.
    //     - however, at this point, we don't know if the remaining section is empty or
    //       not.
    const isMaybeRemainingGridViewHeaderVisible =
        !isActiveGridViewEmpty ||
        !isOverdueGridViewEmpty ||
        !isDueTodayGridViewEmpty ||
        !isDueSoonGridViewEmpty ||
        !isClosedGridViewEmpty;

    // `RemainingHeader`
    //
    // This is conditional since if `RemainingHeader` isn't visible because none of the
    // other grid views are visible we don't want to shift the remaining grid view
    // items incorrectly. It's ok if we incorrectly shift other grid views when they
    // have an item count of 0 so the shift won't matter.
    if (isMaybeRemainingGridViewHeaderVisible) {
        runningItemCount += 1;
    }

    const remainingGridViewHeaderAnimations = useTaskPersonalViewRemainingHeaderAnimations(
        isMaybeRemainingGridViewHeaderVisible,
    );

    previousGridViewAnimations = useMemo(
        () => concatReadonlyArrays(previousGridViewAnimations, remainingGridViewHeaderAnimations),
        [previousGridViewAnimations, remainingGridViewHeaderAnimations],
    );

    const remainingStructuralItemKeyPrefix = "Remaining-";

    const remainingPreviousGridViewResult = !isClosedGridViewEmpty
        ? closedGridViewResult
        : !isDueSoonGridViewEmpty
          ? dueSoonGridViewResult
          : !isDueTodayGridViewEmpty
            ? dueTodayGridViewResult
            : !isOverdueGridViewEmpty
              ? overdueGridViewResult
              : !isActiveGridViewEmpty
                ? activeGridViewResult
                : undefined;

    const remainingPreviousFocusLastTaskTitleEnd =
        remainingPreviousGridViewResult?.focusLastTaskTitleEnd;
    const remainingPreviousFocusLastTaskTitleAll =
        remainingPreviousGridViewResult?.focusLastTaskTitleAll;

    const remainingGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: remainingStructuralItemKeyPrefix,
        capabilities: gridViewCapabilities,
        store,
        query: remainingQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getRemainingItemCount,
        ),
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            if (!remainingQuery) return null;

            const time1 = store.clock.now();
            const time2 = store.clock.now();

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time2,
                remainingQuery.query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;

                actions.push(
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
                            position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
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
        previousGridView: remainingPreviousGridViewResult,
        previousGridViewAnimations,
    });

    const isRemainingGridViewEmpty =
        remainingGridViewResult.stateItemCount === 0 &&
        remainingGridViewResult.loadedState === "FullyLoaded";

    const allSectionsExceptRemainingEmpty = !isMaybeRemainingGridViewHeaderVisible;

    const shouldRenderRemainingSection =
        !isRemainingGridViewEmpty ||
        allSectionsExceptRemainingEmpty ||
        // If the user has not applied any filters, always show the remaining section.
        activeFilters.length === 0;

    const isRemainingGridViewHeaderVisible =
        shouldRenderRemainingSection && isMaybeRemainingGridViewHeaderVisible;

    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForRemainingHeader} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            isRemainingGridViewHeaderVisible ? runningItemCount - 1 : null,
        );

    // When a user applies a filter such that there non-empty sections, we can get into
    // the following state:
    //
    // 1. There are tasks within the filter criteria in the Active and Overdue sections
    // 2. Because there are non-empty sections, `isRemainingGridViewHeaderVisible` is
    //    true and we increment the `runningItemCount` by 1 to render the
    //    `RemainingHeader`
    // 3. There aren't any tasks within the filter criteria in the Remaining section,
    //    so we don't render it. Meaning that we also don't render the
    //    `RemainingHeader` item.
    //
    // This check ensures that the `runningItemCount` is correct.
    if (!shouldRenderRemainingSection) {
        if (isRemainingGridViewHeaderVisible) {
            // We won't show the `RemainingHeader` item we added previously if we don't render
            // the remaining grid view
            runningItemCount -= 1;
        }
    } else {
        for (const index of remainingGridViewResult.alwaysRenderAdditionalItemIndexes) {
            alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
        }

        runningItemCount += remainingGridViewResult.itemCount;
    }

    /* ========================================================================== *\
     *                                   Render                                   *
    \* ========================================================================== */

    const itemCount =
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
        (!isClosedGridViewEmpty
            ? // `ClosedHeader`
              1 + closedGridViewResult.itemCount
            : 0) +
        (shouldRenderRemainingSection
            ? (isRemainingGridViewHeaderVisible ? 1 : 0) + remainingGridViewResult.itemCount
            : // Decorative ghost row rendering decorative ghost row background.
              1);

    // Make sure we animate that last decorative ghost row!
    const {onRenderedRangeLayoutChange: onRenderedRangeLayoutChangeForLastDecorativeGhostRow} =
        useTaskGridViewVirtualizedListItemAnimation(
            viewRef,
            previousGridViewAnimations,
            !shouldRenderRemainingSection ? itemCount - 1 : null,
        );

    // Extract the `renderItem` property so we can call it in `useCallback()` without
    // depending on the whole `activeGridViewResult` object. If we called
    // `activeGridViewResult.renderItem()` then `activeGridViewResult` would be
    // assigned to `this` in `renderItem` and React would need to add a dependency on
    // `activeGridViewResult` to the `useCallback()`.
    const renderActiveGridViewItem = activeGridViewResult.renderItem;
    const renderOverdueGridViewItem = overdueGridViewResult.renderItem;
    const renderDueTodayGridViewItem = dueTodayGridViewResult.renderItem;
    const renderDueSoonGridViewItem = dueSoonGridViewResult.renderItem;
    const renderClosedGridViewItem = closedGridViewResult.renderItem;
    const renderRemainingGridViewItem = remainingGridViewResult.renderItem;

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            // We don't need to modify the `key` for our items because the queries should be
            // exclusive. If a task shows up in one section it should not show up in any other
            // section.

            let hasFirstHeader = false;

            if (index === 0) {
                if (routeLayout === "narrow") {
                    return {
                        key: "NavigationBar",
                        minHeight: spacing[navigationBarHeight],
                        node: (
                            <Box paddingTop="safe-area-inset">
                                <Box height={navigationBarHeight} />
                                {customizationState &&
                                    (platform === "mobile" ? (
                                        <TaskQueryViewCustomizationMobileSection
                                            ref={mobileCustomizationSectionRef}
                                            store={store}
                                            queryReferencesForUrlGrant={null}
                                            initiallyFocus={customizationState.initiallyFocus}
                                            defaultOrderSentence={defaultOrderSentence}
                                            filters={filters}
                                            filterReferences={filterReferences}
                                            onFiltersChange={updateFilters}
                                            sorts={sorts}
                                            onSortsChange={setSorts}
                                            excludeFilters={excludeFilters}
                                        />
                                    ) : (
                                        <Box
                                            paddingX={screenPaddingX}
                                            paddingTop="1"
                                            paddingBottom="5"
                                        >
                                            <TaskQueryViewCustomizationBar
                                                ref={desktopCustomizationBarRef}
                                                store={store}
                                                queryReferencesForUrlGrant={null}
                                                shouldCollapseWhenFiltersAreEmpty={true}
                                                defaultOrderSentence={defaultOrderSentence}
                                                filters={filters}
                                                filterReferences={filterReferences}
                                                onFiltersChange={updateFilters}
                                                sorts={sorts}
                                                onSortsChange={setSorts}
                                                initiallyFocus={customizationState.initiallyFocus}
                                                excludeFilters={excludeFilters}
                                            />
                                        </Box>
                                    ))}
                            </Box>
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
                            <TaskPersonalViewDesktopNavigationBar
                                itemRef={ref}
                                store={store}
                                offset={offset}
                                shouldRenderWithRelativePositioning={
                                    shouldRenderWithRelativePositioning
                                }
                                // When all other sections are empty and the remaining section doesn't have its own
                                // header, we show the column header directly in the navigation bar instead. This
                                // avoids having a blank space where the section header would be.
                                //
                                // We should only show this UX if the remaining section is the first (only)
                                // rendered section.
                                withoutRemainingGridViewHeader={
                                    !isRemainingGridViewHeaderVisible &&
                                    shouldRenderRemainingSection
                                }
                                menuActions={navigationBarMenuActions}
                                filters={filters}
                                filterReferences={filterReferences}
                                onFiltersChange={updateFilters}
                                sorts={sorts}
                                onSortsChange={setSorts}
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

            if (!isClosedGridViewEmpty) {
                if (index === 0) {
                    if (routeLayout === "narrow" || hasFirstHeader) {
                        return {
                            key: "ClosedHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            zIndex: "40",
                            node: <TaskPersonalViewHeader name="Closed" />,
                        };
                    } else {
                        return {
                            key: "ClosedHeader",
                            minHeight: taskPersonalViewHeaderHeight[routeLayout],
                            withManualLayout: true,
                            render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                                <TaskPersonalViewFirstHeaderDesktop
                                    itemRef={ref}
                                    offset={offset}
                                    shouldRenderWithRelativePositioning={
                                        shouldRenderWithRelativePositioning
                                    }
                                    name="Closed"
                                />
                            ),
                        };
                    }
                }

                hasFirstHeader = true;
                index -= 1;

                if (index < closedGridViewResult.itemCount) {
                    return renderClosedGridViewItem(index);
                }

                index -= closedGridViewResult.itemCount;
            }

            if (shouldRenderRemainingSection) {
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
            }

            // If we're not rendering the remaining section (because of filters) then we render
            // a decorative ghost task to get our repeating grid view lines at the end of
            // personal task view. Otherwise the remaining section is responsible for rendering
            // our decorative ghost task background.
            if (!shouldRenderRemainingSection && index === 0) {
                // We only render this when there's a section that's not the remaining section
                // visible. If all sections are hidden then we render the remaining section.
                //
                // This assert is a precaution to make sure we don't get in a state this code
                // doesn't expect.
                assert(!allSectionsExceptRemainingEmpty);

                return {
                    key: `${remainingStructuralItemKeyPrefix}DecorativeGhostTask:${index}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewDecorativeGhostTaskMemo
                            rowMaxWidth={null}
                            isInert={gridViewCapabilities.isReadOnly}
                            structuralItemKeyPrefix={remainingStructuralItemKeyPrefix}
                            relativeItemIndex={index}
                            isFirstRow={false}
                            withoutBorderTopIfFirstRow={false}
                            // HACK: The previous section will have padding bottom of
                            // `taskGridViewPaddingBottomWithNext`. Add some padding top to create space
                            // equivalent to a task row.
                            paddingTop={subtractRemLengths(
                                taskRowViewMinHeight,
                                taskGridViewPaddingBottomWithNext,
                            )}
                            withPaddingBottom={true}
                            hasNextGridView={false}
                            hasDecorativeGhostRowBackground={true}
                            focusPreviousTaskTitleEnd={remainingPreviousFocusLastTaskTitleEnd}
                            focusPreviousTaskTitleAll={remainingPreviousFocusLastTaskTitleAll}
                        />
                    ),
                };
            }

            throw new OutOfRangeError("Index out of personal task view bounds");
        },
        [
            isActiveGridViewEmpty,
            isOverdueGridViewEmpty,
            isDueTodayGridViewEmpty,
            isDueSoonGridViewEmpty,
            isClosedGridViewEmpty,
            shouldRenderRemainingSection,
            routeLayout,
            customizationState,
            platform,
            store,
            filters,
            filterReferences,
            updateFilters,
            sorts,
            setSorts,
            isRemainingGridViewHeaderVisible,
            navigationBarMenuActions,
            activeGridViewResult.itemCount,
            renderActiveGridViewItem,
            overdueGridViewResult.itemCount,
            renderOverdueGridViewItem,
            dueTodayGridViewResult.itemCount,
            renderDueTodayGridViewItem,
            dueSoonGridViewResult.itemCount,
            renderDueSoonGridViewItem,
            closedGridViewResult.itemCount,
            renderClosedGridViewItem,
            remainingGridViewResult.itemCount,
            renderRemainingGridViewItem,
            allSectionsExceptRemainingEmpty,
            gridViewCapabilities.isReadOnly,
            remainingPreviousFocusLastTaskTitleEnd,
            remainingPreviousFocusLastTaskTitleAll,
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
        >
            {activeGridViewResult.modals}
            {overdueGridViewResult.modals}
            {dueTodayGridViewResult.modals}
            {dueSoonGridViewResult.modals}
            {closedGridViewResult.modals}
            {remainingGridViewResult.modals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={scrollViewRef}
                    bufferedItemHeight={spacing[taskRowViewMinHeight]}
                    itemCount={itemCount}
                    alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalItemIndexes}
                    scrollbarInsetTop={
                        routeLayout === "narrow"
                            ? (scrollbarInsetTop ?? safeAreaOnlyScrollbarInsetTop)
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

                        if (!isClosedGridViewEmpty) {
                            // `ClosedHeader`
                            runningItemCount += 1;

                            closedGridViewResult.onRenderedRangeChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    closedGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += closedGridViewResult.itemCount;
                        }

                        if (shouldRenderRemainingSection) {
                            if (isRemainingGridViewHeaderVisible) {
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
                        }
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onRenderedRangeLayoutChangeForOverdueHeader();
                        onRenderedRangeLayoutChangeForDueTodayHeader();
                        onRenderedRangeLayoutChangeForDueSoonHeader();
                        onRenderedRangeLayoutChangeForClosedHeader();
                        onRenderedRangeLayoutChangeForRemainingHeader();
                        onRenderedRangeLayoutChangeForLastDecorativeGhostRow();

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

                        if (!isClosedGridViewEmpty) {
                            // `ClosedHeader`
                            runningItemCount += 1;

                            closedGridViewResult.onRenderedRangeLayoutChange(
                                shiftRenderedRange(
                                    runningItemCount,
                                    closedGridViewResult.itemCount,
                                    range,
                                ),
                            );

                            runningItemCount += closedGridViewResult.itemCount;
                        }

                        if (shouldRenderRemainingSection) {
                            if (isRemainingGridViewHeaderVisible) {
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
                        }
                    }}
                    extraChildren={navigationBar}
                />
            </GlobalKeyDownEvent>
            <TaskFloatingCreateButton />
        </Box>
    );
}

function useTaskGridViewVirtualizedListViewRef(
    viewRef: RefObject<VirtualizedScrollViewRef | null>,
    previousItemCount: number,
    getItemCount: Memo<() => number>,
): RefObject<TaskGridViewVirtualizedListViewRef | null> {
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const getPreviousItemCount = useEvent(() => previousItemCount);

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of items
    // which precede our children grid view.
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

const TaskPersonalViewDesktopNavigationBar = memo(function TaskPersonalViewDesktopNavigationBar({
    itemRef,
    store,
    offset,
    shouldRenderWithRelativePositioning,
    withoutRemainingGridViewHeader,
    menuActions,
    filters,
    filterReferences,
    onFiltersChange,
    sorts,
    onSortsChange,
}: {
    itemRef: Ref<HTMLDivElement>;
    store: TaskClientStore;
    offset: number;
    shouldRenderWithRelativePositioning: boolean;
    withoutRemainingGridViewHeader: boolean;
    menuActions: ReadonlyArray<ReadonlyArray<MenuAction>>;
    filters: ReadonlyArray<TaskQueryFilter>;
    filterReferences: TaskQueryFilterReferences;
    onFiltersChange: (
        filters: ReadonlyArray<TaskQueryFilter>,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
    sorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
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
                <Box minHeight={navigationBarHeight} display="flex" paddingRight={screenPaddingX}>
                    <Box
                        flexShrink="0"
                        display="flex"
                        alignItems="center"
                        height={navigationBarHeight}
                        paddingLeft="10"
                    >
                        <h1
                            className={sprinkles({fontSize: "400", fontStyle: "bold"})}
                            style={{marginTop: useAlignFontBaselines("400", "75")}}
                        >
                            My tasks
                        </h1>
                    </Box>
                    <Box
                        flexShrink="0"
                        alignSelf="stretch"
                        marginY="4"
                        marginX={screenPaddingX}
                        borderLeft="grey-5"
                    />
                    <Box
                        flexGrow="1"
                        style={{
                            paddingTop: taskQueryViewCustomizationBarDesktopMarginY,
                            paddingBottom: taskQueryViewCustomizationBarDesktopMarginY,
                        }}
                    >
                        <TaskQueryViewCustomizationBar
                            store={store}
                            queryReferencesForUrlGrant={null}
                            shouldCollapseWhenFiltersAreEmpty={true}
                            defaultOrderSentence={defaultOrderSentence}
                            filters={filters}
                            filterReferences={filterReferences}
                            onFiltersChange={onFiltersChange}
                            sorts={sorts}
                            onSortsChange={onSortsChange}
                            excludeFilters={excludeFilters}
                        />
                    </Box>
                    <Box
                        flexShrink="0"
                        alignSelf="stretch"
                        marginY="4"
                        marginX={screenPaddingX}
                        borderLeft="grey-5"
                    />
                    <Box
                        flexShrink="0"
                        height={navigationBarHeight}
                        display="flex"
                        alignItems="center"
                        gap="2"
                    >
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
                    // We assume all non-state items have a height of `taskRowViewMinHeight`. This is
                    // true for the bottom ghost task and decorative ghost rows. The grid view
                    // shouldn't have a column header so it's safe to assume all non-state items have a
                    // height of `taskRowViewMinHeight`.
                    parseRemLength(taskRowViewMinHeight) * -nonStateItemCountDifference +
                    parseRemLength(taskGridViewPaddingBottomWithNext);

                return [
                    ...previousAnimations,
                    {
                        type: "Delete",
                        startTime: Date.now(),
                        // Take a little longer for header create/delete animations so everything doesn't
                        // move too fast.
                        duration: taskAnimationDurationMs * 2,
                        kind: "Unknown",
                        height: `${heightRem}rem`,
                    },
                ];
            } else {
                assert(nonStateItemCountDifference > 0);

                const heightRem =
                    parseRemLength(taskPersonalViewHeaderHeight[routeLayout]) +
                    // We assume all non-state items have a height of `taskRowViewMinHeight`. This is
                    // true for the bottom ghost task and decorative ghost rows. The grid view
                    // shouldn't have a column header so it's safe to assume all non-state items have a
                    // height of `taskRowViewMinHeight`.
                    parseRemLength(taskRowViewMinHeight) * nonStateItemCountDifference +
                    parseRemLength(taskGridViewPaddingBottomWithNext);

                return [
                    ...previousAnimations,
                    {
                        type: "Create",
                        startTime: Date.now(),
                        // Take a little longer for header create/delete animations so everything doesn't
                        // move too fast.
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
