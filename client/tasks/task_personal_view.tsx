import {useDndContext} from "@dnd-kit/core";
import {
    Memo,
    RefObject,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {navigationBarStyles, tasksStyles} from "~/client/styles/styles.js";
import {
    taskGridViewColumnHeaderHeight,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/tasks/core/task_client_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewHasDndContext} from "~/client/tasks/internal/task_grid_view_has_dnd_context.js";
import {useTaskGridViewVirtualizedListBase} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/tasks/internal/task_grid_view_virtualized_list_types.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {useTaskUndoStackState} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {TaskGridViewDraggableData} from "~/client/tasks/task_grid_view_dnd_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {interFontCapHeight, interFontXHeight} from "~/shared/design/core/font_metrics.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {OutOfRangeError, UnimplementedError} from "~/shared/error/error.js";
import {emptySet} from "~/shared/helpers/array/empty_set.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";

type TaskPersonalViewVisibleSection = "Active" | "Overdue" | "DueToday" | "DueSoon" | "Remaining";

export function TaskPersonalView({
    store,
    activeQuery,
    overdueQuery,
    assigneeDueTodayQuery,
    dueSoonQuery,
    remainingQuery,
    affinityManager,
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
    assigneeDueTodayQuery: {
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
}) {
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {isAppleDevice} = useClientInfo();

    // Retain our queries.
    useEffect(() => {
        activeQuery.query.retain();
        overdueQuery.query.retain();
        assigneeDueTodayQuery.query.retain();
        dueSoonQuery.query.retain();
        remainingQuery.query.retain();

        return () => {
            // Release after a microtask in case the effect re-runs in which case we'll
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                activeQuery.query.release();
                overdueQuery.query.release();
                assigneeDueTodayQuery.query.release();
                dueSoonQuery.query.release();
                remainingQuery.query.release();
            });
        };
    }, [
        activeQuery.query,
        dueSoonQuery.query,
        assigneeDueTodayQuery.query,
        overdueQuery.query,
        remainingQuery.query,
    ]);

    assert(
        useContext(TaskGridViewHasDndContext),
        "Expected task grid view virtualized list to be rendered inside `<TaskGridViewDndContext>`",
    );

    const dndContext = useDndContext();
    const isDragging = !!dndContext.active;

    const [draggingData] = useStateWithDependencies(
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
    } = useTaskUndoStackState();

    const undo = () => {
        throw new UnimplementedError("NOCOMMIT");
    };

    const redo = () => {
        throw new UnimplementedError("NOCOMMIT");
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
        section: TaskPersonalViewVisibleSection;
        previousSections: ReadonlySet<TaskPersonalViewVisibleSection>;
    }>({section: "Active", previousSections: emptySet});

    const visibleSectionPositionStateRef = useRef<{
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
            overdueHeaderPosition: view.getPositionByKeyIfExists("OverdueHeader"),
            dueTodayHeaderPosition: view.getPositionByKeyIfExists("DueTodayHeader"),
            dueSoonHeaderPosition: view.getPositionByKeyIfExists("DueSoonHeader"),
            remainingHeaderPosition: view.getPositionByKeyIfExists("RemainingHeader"),
        };

        handleScrollOrStateChange(view, visibleSectionPositionStateRef.current);
    };

    const columnHeaderHeight = useMemo(
        () =>
            convertRemLengthToPx(
                addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight),
                spacingScale,
            ),
        [spacingScale],
    );

    const handleScrollOrStateChange = (
        view: VirtualizedScrollViewRef,
        visibleSectionPositionState: {
            overdueHeaderPosition: {offset: number; height: number} | null;
            dueTodayHeaderPosition: {offset: number; height: number} | null;
            dueSoonHeaderPosition: {offset: number; height: number} | null;
            remainingHeaderPosition: {offset: number; height: number} | null;
        },
    ) => {
        const scrollOffset = view.getScrollOffset();

        let newVisibleSection: TaskPersonalViewVisibleSection = "Active";

        if (
            visibleSectionPositionState.remainingHeaderPosition !== null &&
            scrollOffset + columnHeaderHeight >=
                visibleSectionPositionState.remainingHeaderPosition.offset
        ) {
            newVisibleSection = "Remaining";
        } else if (
            visibleSectionPositionState.dueSoonHeaderPosition !== null &&
            scrollOffset + columnHeaderHeight >=
                visibleSectionPositionState.dueSoonHeaderPosition.offset
        ) {
            newVisibleSection = "DueSoon";
        } else if (
            visibleSectionPositionState.dueTodayHeaderPosition !== null &&
            scrollOffset + columnHeaderHeight >=
                visibleSectionPositionState.dueTodayHeaderPosition.offset
        ) {
            newVisibleSection = "DueToday";
        } else if (
            visibleSectionPositionState.overdueHeaderPosition !== null &&
            scrollOffset + columnHeaderHeight >=
                visibleSectionPositionState.overdueHeaderPosition.offset
        ) {
            newVisibleSection = "Overdue";
        }

        setVisibleSectionState(visibleSectionState => {
            if (visibleSectionState.section === newVisibleSection) return visibleSectionState;

            if (visibleSectionState.previousSections.has(visibleSectionState.section)) {
                return {...visibleSectionState, section: newVisibleSection};
            }

            return {
                section: newVisibleSection,
                previousSections: new Set([
                    ...visibleSectionState.previousSections,
                    visibleSectionState.section,
                ]),
            };
        });
    };

    /* ========================================================================== *\
     *                                   Events                                   *
    \* ========================================================================== */

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const events = useEvents({
        getActiveItemCount: () => activeGridViewResult.itemCount,
        getOverdueItemCount: () => overdueGridViewResult.itemCount,
        getDueTodayItemCount: () => assigneeDueTodayGridViewResult.itemCount,
        getDueSoonItemCount: () => dueSoonGridViewResult.itemCount,
        getRemainingItemCount: () => remainingGridViewResult.itemCount,
    });

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
                withoutAssigneeColumn: true,
                hasDenseFields: false,
            };
        } else {
            return {
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: true,
                hasColumns: false,
                withoutAssigneeColumn: true,
                hasDenseFields: true,
            };
        }
    }, [routeLayout]);

    let runningItemCount = 0;
    const alwaysRenderAdditionalItemIndexes: Array<number> = [];

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
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        columnHeaderControls: useMemo(() => {
            const hasAnyPreviousVisibleSection = visibleSectionState.previousSections.size > 0;

            const hasActivePreviousVisibleSection =
                visibleSectionState.previousSections.has("Active");
            const hasOverduePreviousVisibleSection =
                visibleSectionState.previousSections.has("Overdue");
            const hasDueTodayPreviousVisibleSection =
                visibleSectionState.previousSections.has("DueToday");
            const hasDueSoonPreviousVisibleSection =
                visibleSectionState.previousSections.has("DueSoon");

            const isActiveVisibleSection = visibleSectionState.section === "Active";
            const isOverdueVisibleSection = visibleSectionState.section === "Overdue";
            const isDueTodayVisibleSection = visibleSectionState.section === "DueToday";
            const isDueSoonVisibleSection = visibleSectionState.section === "DueSoon";

            return {
                minHeight: spacing[navigationBarHeight],
                node: (
                    <Box
                        display="flex"
                        alignItems="center"
                        height={navigationBarHeight}
                        paddingLeft="10"
                    >
                        <Box display="flex" alignItems="baseline" gap="3">
                            <Box fontSize="400" fontStyle="bold">
                                My tasks
                            </Box>
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
                                        hasAnyPreviousVisibleSection && isActiveVisibleSection
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
                                        !hasOverduePreviousVisibleSection &&
                                        !isOverdueVisibleSection
                                            ? "0"
                                            : undefined
                                    }
                                    className={
                                        hasAnyPreviousVisibleSection && isOverdueVisibleSection
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
                                        !hasDueTodayPreviousVisibleSection &&
                                        !isDueTodayVisibleSection
                                            ? "0"
                                            : undefined
                                    }
                                    className={
                                        hasAnyPreviousVisibleSection && isDueTodayVisibleSection
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
                                        !hasDueSoonPreviousVisibleSection &&
                                        !isDueSoonVisibleSection
                                            ? "0"
                                            : undefined
                                    }
                                    className={
                                        hasAnyPreviousVisibleSection && isDueSoonVisibleSection
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
                ),
            };
        }, [spacingScale, visibleSectionState]),
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of activeGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += activeGridViewResult.itemCount;

    // `OverdueHeader`
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
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        withoutColumnHeader: true,
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of overdueGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += overdueGridViewResult.itemCount;

    // `DueTodayHeader`
    runningItemCount += 1;

    const assigneeDueTodayGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "DueToday-",
        capabilities: gridViewCapabilities,
        store,
        query: assigneeDueTodayQuery,
        affinityManager,
        viewRef: useTaskGridViewVirtualizedListViewRef(
            viewRef,
            runningItemCount,
            events.getDueTodayItemCount,
        ),
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        withoutColumnHeader: true,
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of assigneeDueTodayGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += assigneeDueTodayGridViewResult.itemCount;

    // `DueSoonHeader`
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
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        withoutColumnHeader: true,
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of dueSoonGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += dueSoonGridViewResult.itemCount;

    // `RemainingHeader`
    runningItemCount += 1;

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
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        withoutColumnHeader: true,
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

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
        } else if (assigneeDueTodayGridViewResult.itemCount > 0) {
            assigneeDueTodayGridViewResult.focusEnd();
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
    const renderDueTodayGridViewItem = assigneeDueTodayGridViewResult.renderItem;
    const renderDueSoonGridViewItem = dueSoonGridViewResult.renderItem;
    const renderRemainingGridViewItem = remainingGridViewResult.renderItem;

    const renderItem = useCallback(
        (index: number) => {
            // We don't need to modify the `key` for our items because the queries should
            // be exclusive. If a task shows up in one section it should not show up in
            // any other section.

            if (index < activeGridViewResult.itemCount) {
                return renderActiveGridViewItem(index);
            }

            index -= activeGridViewResult.itemCount;

            if (index === 0) {
                const height = "14";

                return {
                    key: "OverdueHeader",
                    minHeight: spacing[height],
                    node: (
                        <Box
                            display="flex"
                            alignItems="center"
                            height={height}
                            paddingTop="2"
                            paddingLeft="10"
                        >
                            <Box fontSize="200" fontStyle="bold">
                                Overdue
                            </Box>
                        </Box>
                    ),
                };
            }

            index -= 1;

            if (index < overdueGridViewResult.itemCount) {
                return renderOverdueGridViewItem(index);
            }

            index -= overdueGridViewResult.itemCount;

            if (index === 0) {
                const height = "14";

                return {
                    key: "DueTodayHeader",
                    minHeight: spacing[height],
                    node: (
                        <Box
                            display="flex"
                            alignItems="center"
                            height={height}
                            paddingTop="2"
                            paddingLeft="10"
                        >
                            <Box fontSize="200" fontStyle="bold">
                                Due today
                            </Box>
                        </Box>
                    ),
                };
            }

            index -= 1;

            if (index < assigneeDueTodayGridViewResult.itemCount) {
                return renderDueTodayGridViewItem(index);
            }

            index -= assigneeDueTodayGridViewResult.itemCount;

            if (index === 0) {
                const height = "14";

                return {
                    key: "DueSoonHeader",
                    minHeight: spacing[height],
                    node: (
                        <Box
                            display="flex"
                            alignItems="center"
                            height={height}
                            paddingTop="2"
                            paddingLeft="10"
                        >
                            <Box fontSize="200" fontStyle="bold">
                                Due soon
                            </Box>
                        </Box>
                    ),
                };
            }

            index -= 1;

            if (index < dueSoonGridViewResult.itemCount) {
                return renderDueSoonGridViewItem(index);
            }

            index -= dueSoonGridViewResult.itemCount;

            if (index === 0) {
                const height = "14";

                return {
                    key: "RemainingHeader",
                    minHeight: spacing[height],
                    node: (
                        <Box
                            display="flex"
                            alignItems="center"
                            height={height}
                            paddingTop="2"
                            paddingLeft="10"
                        >
                            <Box fontSize="200" fontStyle="bold">
                                My tasks
                            </Box>
                        </Box>
                    ),
                };
            }

            index -= 1;

            if (index < remainingGridViewResult.itemCount) {
                return renderRemainingGridViewItem(index);
            }

            index -= remainingGridViewResult.itemCount;

            throw new OutOfRangeError("Index out of personal task view bounds");
        },
        [
            activeGridViewResult.itemCount,
            dueSoonGridViewResult.itemCount,
            assigneeDueTodayGridViewResult.itemCount,
            overdueGridViewResult.itemCount,
            remainingGridViewResult.itemCount,
            renderActiveGridViewItem,
            renderDueSoonGridViewItem,
            renderDueTodayGridViewItem,
            renderOverdueGridViewItem,
            renderRemainingGridViewItem,
        ],
    );

    return (
        <Box
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
            {assigneeDueTodayGridViewResult.modals}
            {dueSoonGridViewResult.modals}
            {remainingGridViewResult.modals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={spacing[taskRowViewMinHeight]}
                    itemCount={
                        activeGridViewResult.itemCount +
                        // `OverdueHeader`
                        1 +
                        overdueGridViewResult.itemCount +
                        // `DueTodayHeader`
                        1 +
                        assigneeDueTodayGridViewResult.itemCount +
                        // `DueSoonHeader`
                        1 +
                        dueSoonGridViewResult.itemCount +
                        // `RemainingHeader`
                        1 +
                        remainingGridViewResult.itemCount
                    }
                    alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalItemIndexes}
                    scrollbarInsetTopItemIndex={activeGridViewResult.scrollbarInsetTopItemIndex}
                    renderItem={renderItem}
                    onRenderedRangeChange={range => {
                        let runningItemCount = 0;

                        activeGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                activeGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += activeGridViewResult.itemCount;

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

                        // `DueTodayHeader`
                        runningItemCount += 1;

                        assigneeDueTodayGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeDueTodayGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeDueTodayGridViewResult.itemCount;

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

                        // `RemainingHeader`
                        runningItemCount += 1;

                        remainingGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                remainingGridViewResult.itemCount,
                                range,
                            ),
                        );
                    }}
                    onRenderedRangeLayoutChange={range => {
                        let runningItemCount = 0;

                        activeGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                activeGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += activeGridViewResult.itemCount;

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

                        // `DueTodayHeader`
                        runningItemCount += 1;

                        assigneeDueTodayGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeDueTodayGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeDueTodayGridViewResult.itemCount;

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

                        // `RemainingHeader`
                        runningItemCount += 1;

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
                />
            </GlobalKeyDownEvent>
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
    if (!range) {
        return null;
    }

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
