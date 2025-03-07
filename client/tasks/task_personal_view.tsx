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
} from "react";
import {Box} from "~/client/design/box.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {tasksStyles} from "~/client/styles/styles.js";
import {taskRowViewMinHeight} from "~/client/styles/tasks_shared_styles.js";
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
import {spacing} from "~/shared/design/core/spacing.js";
import {OutOfRangeError, UnimplementedError} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";

// TODO(calebmer, 2025-03-07): The `react-compiler` ESLint rule seems to be
// bugged in this file. It's flagging a bunch of valid hook calls as if they're
// inside an `if` branch. Try isolating the bug, filing a bug report, and when
// it's fixed remove this eslint-disable comment.
/* eslint-disable react-compiler/react-compiler */

export function TaskPersonalView({
    store,
    assigneeActiveQuery,
    assigneeOverdueQuery,
    assigneeDueTodayQuery,
    assigneeDueSoonQuery,
    assigneeRemainingQuery,
    affinityManager,
}: {
    store: TaskClientStore;
    assigneeActiveQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    assigneeOverdueQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    assigneeDueTodayQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    assigneeDueSoonQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    assigneeRemainingQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    };
    affinityManager: TaskClientStoreSearchAffinityManager;
}) {
    const routeLayout = useRouteLayout();
    const {isAppleDevice} = useClientInfo();

    // Retain our queries.
    useEffect(() => {
        assigneeActiveQuery.query.retain();
        assigneeOverdueQuery.query.retain();
        assigneeDueTodayQuery.query.retain();
        assigneeDueSoonQuery.query.retain();
        assigneeRemainingQuery.query.retain();

        return () => {
            // Release after a microtask in case the effect re-runs in which case we'll
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                assigneeActiveQuery.query.release();
                assigneeOverdueQuery.query.release();
                assigneeDueTodayQuery.query.release();
                assigneeDueSoonQuery.query.release();
                assigneeRemainingQuery.query.release();
            });
        };
    }, [
        assigneeActiveQuery.query,
        assigneeDueSoonQuery.query,
        assigneeDueTodayQuery.query,
        assigneeOverdueQuery.query,
        assigneeRemainingQuery.query,
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
     *                                   Events                                   *
    \* ========================================================================== */

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const events = useEvents({
        getAssigneeActiveItemCount: () => assigneeActiveGridViewResult.itemCount,
        getAssigneeOverdueItemCount: () => assigneeOverdueGridViewResult.itemCount,
        getAssigneeDueTodayItemCount: () => assigneeDueTodayGridViewResult.itemCount,
        getAssigneeDueSoonItemCount: () => assigneeDueSoonGridViewResult.itemCount,
        getAssigneeRemainingItemCount: () => assigneeRemainingGridViewResult.itemCount,
    });

    /* ========================================================================== *\
     *                           Virtualized list state                           *
    \* ========================================================================== */

    // NOCOMMIT: No assignee column
    const gridViewCapabilities: Memo<TaskGridViewCapabilities> = useMemo(() => {
        if (routeLayout !== "narrow") {
            return {
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: false,
                hasColumns: true,
                hasDenseFields: false,
            };
        } else {
            return {
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: true,
                hasColumns: false,
                hasDenseFields: true,
            };
        }
    }, [routeLayout]);

    let runningItemCount = 0;
    const alwaysRenderAdditionalItemIndexes: Array<number> = [];

    const assigneeActiveGridViewRef = useTaskGridViewVirtualizedListViewRef(
        viewRef,
        runningItemCount,
        events.getAssigneeActiveItemCount,
    );

    const assigneeActiveGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "AssigneeActive-",
        capabilities: gridViewCapabilities,
        store,
        query: assigneeActiveQuery,
        affinityManager,
        viewRef: assigneeActiveGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of assigneeActiveGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += assigneeActiveGridViewResult.itemCount;

    const assigneeOverdueGridViewRef = useTaskGridViewVirtualizedListViewRef(
        viewRef,
        runningItemCount,
        events.getAssigneeOverdueItemCount,
    );

    const assigneeOverdueGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "AssigneeOverdue-",
        capabilities: gridViewCapabilities,
        store,
        query: assigneeOverdueQuery,
        affinityManager,
        viewRef: assigneeOverdueGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of assigneeOverdueGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += assigneeOverdueGridViewResult.itemCount;

    const assigneeDueTodayGridViewRef = useTaskGridViewVirtualizedListViewRef(
        viewRef,
        runningItemCount,
        events.getAssigneeDueTodayItemCount,
    );

    const assigneeDueTodayGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "AssigneeDueToday-",
        capabilities: gridViewCapabilities,
        store,
        query: assigneeDueTodayQuery,
        affinityManager,
        viewRef: assigneeDueTodayGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
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

    const assigneeDueSoonGridViewRef = useTaskGridViewVirtualizedListViewRef(
        viewRef,
        runningItemCount,
        events.getAssigneeDueSoonItemCount,
    );

    const assigneeDueSoonGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "AssigneeDueSoon-",
        capabilities: gridViewCapabilities,
        store,
        query: assigneeDueSoonQuery,
        affinityManager,
        viewRef: assigneeDueSoonGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of assigneeDueSoonGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += assigneeDueSoonGridViewResult.itemCount;

    const assigneeRemainingGridViewRef = useTaskGridViewVirtualizedListViewRef(
        viewRef,
        runningItemCount,
        events.getAssigneeRemainingItemCount,
    );

    const assigneeRemainingGridViewResult = useTaskGridViewVirtualizedListBase({
        structuralItemKeyPrefix: "AssigneeRemaining-",
        capabilities: gridViewCapabilities,
        store,
        query: assigneeRemainingQuery,
        affinityManager,
        viewRef: assigneeRemainingGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            throw new UnimplementedError("NOCOMMIT");
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            throw new UnimplementedError("NOCOMMIT");
        },
        isDragging,
        draggingData,
        pushUndoStackEntry,
        scrollToAnchorPosition: () => {
            throw new UnimplementedError("NOCOMMIT");
        },
    });

    for (const index of assigneeRemainingGridViewResult.alwaysRenderAdditionalItemIndexes) {
        alwaysRenderAdditionalItemIndexes.push(index + runningItemCount);
    }

    runningItemCount += assigneeRemainingGridViewResult.itemCount;

    /* ========================================================================== *\
     *                                   Render                                   *
    \* ========================================================================== */

    const focusEnd = () => {
        if (assigneeRemainingGridViewResult.itemCount > 0) {
            assigneeRemainingGridViewResult.focusEnd();
        } else if (assigneeDueSoonGridViewResult.itemCount > 0) {
            assigneeDueSoonGridViewResult.focusEnd();
        } else if (assigneeDueTodayGridViewResult.itemCount > 0) {
            assigneeDueTodayGridViewResult.focusEnd();
        } else if (assigneeOverdueGridViewResult.itemCount > 0) {
            assigneeOverdueGridViewResult.focusEnd();
        } else if (assigneeActiveGridViewResult.itemCount > 0) {
            assigneeActiveGridViewResult.focusEnd();
        }
    };

    // Extract the `renderItem` property so we can call it in `useCallback()`
    // without depending on the whole `assigneeActiveGridViewResult` object. If we
    // called `assigneeActiveGridViewResult.renderItem()` then
    // `assigneeActiveGridViewResult` would be assigned to `this` in `renderItem`
    // and React would need to add a dependency on `assigneeActiveGridViewResult`
    // to the `useCallback()`.
    const renderAssigneeActiveGridViewItem = assigneeActiveGridViewResult.renderItem;
    const renderAssigneeOverdueGridViewItem = assigneeOverdueGridViewResult.renderItem;
    const renderAssigneeDueTodayGridViewItem = assigneeDueTodayGridViewResult.renderItem;
    const renderAssigneeDueSoonGridViewItem = assigneeDueSoonGridViewResult.renderItem;
    const renderAssigneeRemainingGridViewItem = assigneeRemainingGridViewResult.renderItem;

    const renderItem = useCallback(
        (index: number) => {
            // We don't need to modify the `key` for our items because the queries should
            // be exclusive. If a task shows up in one section it should not show up in
            // any other section.

            if (index < assigneeActiveGridViewResult.itemCount) {
                return renderAssigneeActiveGridViewItem(index);
            }

            index -= assigneeActiveGridViewResult.itemCount;

            if (index < assigneeOverdueGridViewResult.itemCount) {
                return renderAssigneeOverdueGridViewItem(index);
            }

            index -= assigneeOverdueGridViewResult.itemCount;

            if (index < assigneeDueTodayGridViewResult.itemCount) {
                return renderAssigneeDueTodayGridViewItem(index);
            }

            index -= assigneeDueTodayGridViewResult.itemCount;

            if (index < assigneeDueSoonGridViewResult.itemCount) {
                return renderAssigneeDueSoonGridViewItem(index);
            }

            index -= assigneeDueSoonGridViewResult.itemCount;

            if (index < assigneeRemainingGridViewResult.itemCount) {
                return renderAssigneeRemainingGridViewItem(index);
            }

            index -= assigneeRemainingGridViewResult.itemCount;

            throw new OutOfRangeError("Index out of personal task view bounds");
        },
        [
            assigneeActiveGridViewResult.itemCount,
            assigneeDueSoonGridViewResult.itemCount,
            assigneeDueTodayGridViewResult.itemCount,
            assigneeOverdueGridViewResult.itemCount,
            assigneeRemainingGridViewResult.itemCount,
            renderAssigneeActiveGridViewItem,
            renderAssigneeDueSoonGridViewItem,
            renderAssigneeDueTodayGridViewItem,
            renderAssigneeOverdueGridViewItem,
            renderAssigneeRemainingGridViewItem,
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
            {assigneeActiveGridViewResult.modals}
            {assigneeOverdueGridViewResult.modals}
            {assigneeDueTodayGridViewResult.modals}
            {assigneeDueSoonGridViewResult.modals}
            {assigneeRemainingGridViewResult.modals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={spacing[taskRowViewMinHeight]}
                    itemCount={
                        assigneeActiveGridViewResult.itemCount +
                        assigneeOverdueGridViewResult.itemCount +
                        assigneeDueTodayGridViewResult.itemCount +
                        assigneeDueSoonGridViewResult.itemCount +
                        assigneeRemainingGridViewResult.itemCount
                    }
                    alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalItemIndexes}
                    scrollbarInsetTopItemIndex={
                        assigneeActiveGridViewResult.scrollbarInsetTopItemIndex
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={range => {
                        let runningItemCount = 0;

                        assigneeActiveGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeActiveGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeActiveGridViewResult.itemCount;

                        assigneeOverdueGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeOverdueGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeOverdueGridViewResult.itemCount;

                        assigneeDueTodayGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeDueTodayGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeDueTodayGridViewResult.itemCount;

                        assigneeDueSoonGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeDueSoonGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeDueSoonGridViewResult.itemCount;

                        assigneeRemainingGridViewResult.onRenderedRangeChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeRemainingGridViewResult.itemCount,
                                range,
                            ),
                        );
                    }}
                    onRenderedRangeLayoutChange={range => {
                        let runningItemCount = 0;

                        assigneeActiveGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeActiveGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeActiveGridViewResult.itemCount;

                        assigneeOverdueGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeOverdueGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeOverdueGridViewResult.itemCount;

                        assigneeDueTodayGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeDueTodayGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeDueTodayGridViewResult.itemCount;

                        assigneeDueSoonGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeDueSoonGridViewResult.itemCount,
                                range,
                            ),
                        );

                        runningItemCount += assigneeDueSoonGridViewResult.itemCount;

                        assigneeRemainingGridViewResult.onRenderedRangeLayoutChange(
                            shiftRenderedRange(
                                runningItemCount,
                                assigneeRemainingGridViewResult.itemCount,
                                range,
                            ),
                        );
                    }}
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
