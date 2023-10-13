import {SpinnerGap} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {
    Dispatch,
    Key,
    Memo,
    MutableRefObject,
    ReactNode,
    Ref,
    RefObject,
    SetStateAction,
    memo,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {MemoObject, useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/task_delete_confirmation_modal_dialog.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {TaskGridViewVirtualizedListState} from "~/client/tasks/internal/task_grid_view_virtualized_list_state.js";
import {TaskRowShimmer} from "~/client/tasks/internal/task_row_shimmer.js";
import {
    TaskGridViewColumn,
    TaskRowView,
    TaskRowViewRef,
} from "~/client/tasks/internal/task_row_view.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {useTaskGridViewExpansionState} from "~/client/tasks/internal/use_task_grid_view_expansion_state.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll} from "~/client/virtualized/helpers/render_virtualized_scroll_view_item_with_expensive_features_disabled_during_scroll.js";
import {
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

const undefinedConstStore = new ConstStore(undefined);

const taskGridViewMoreUnloadedTasksSpinnerHeight = addRemLengths(
    spacing[taskRowViewMinHeight],
    spacing[taskRowViewMinHeight],
    spacing[taskRowViewMinHeight],
    spacing["4"],
    spacing["6"],
    spacing["4"],
);

export type TaskGridViewVirtualizedListViewRef = {
    getHeight: () => number;
    getContentHeight: () => number;
    getScrollOffset: () => number;
    setScrollOffset: (scrollOffset: number) => void;
    getRenderedRange: () => {startIndex: number; endIndex: number} | null;
    getKeyByIndexIfExists: (index: number) => Key | null;
    getIndexByKeyIfExists: (key: Key) => number | null;
    getPositionByIndex: (index: number) => {offset: number; height: number};
    peekRenderedRangeAfterSetScrollOffset: (
        scrollOffset: number,
    ) => {startIndex: number; endIndex: number} | null;
};

// Should be able to pass `VirtualizedScrollViewRef` in for
// `TaskGridViewVirtualizedListViewRef`. Often our virtualized grid view will
// have other stuff besides tasks so a modified ref object may be passed in.
assertAssignableTypes<VirtualizedScrollViewRef, TaskGridViewVirtualizedListViewRef>();

/**
 * Encapsulates the ability to render a virtualized list of tasks. You are
 * responsible for using ALL of the returned props in a
 * `<VirtualizedScrollView>` component. If you don't use one of the props in
 * the documented way your grid view may be broken.
 */
export function useTaskGridViewVirtualizedList({
    capabilities,
    query: rootQuery,
    initialExpansionState,
    initialBottomGhostTaskId,
    viewRef,
    getMoveTaskToQueryActions: _getMoveTaskToRootQueryActions,
    getMaybeRemoveTaskFromQueryActions: _getMaybeRemoveTaskFromRootQueryActions,
    withColumnHeaderBorderTop = false,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    query: TaskClientQuery;
    initialExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
    getMoveTaskToQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
    withColumnHeaderBorderTop?: boolean;
}): {
    /**
     * The number of items. Should be passed to `<VirtualizedScrollView>`.
     */
    itemCount: number;

    /**
     * Render an item. Should be passed to `<VirtualizedScrollView>`.
     */
    renderItem: Memo<(index: number) => VirtualizedScrollViewItem>;

    /**
     * Should be called when the rendered range changes. Should be passed to
     * `<VirtualizedScrollView>`.
     */
    onRenderedRangeChange: (renderedRange: {startIndex: number; endIndex: number} | null) => void;

    /**
     * Item indexes to always render regardless of the rendered range. Should be
     * passed to `<VirtualizedScrollView>`.
     */
    alwaysRenderAdditionalItemIndexes: Memo<ReadonlyArray<number>>;

    /**
     * Item index the scrollbar should be inset after. Should be passed to
     * `<VirtualizedScrollView>`.
     */
    insetScrollbarItemIndex: number | undefined;

    /**
     * Modals opened during operation of the grid view (e.g. delete confirmation
     * modal). Should be rendered unconditionally alongside the grid view.
     */
    modals: ReactNode;

    /**
     * (Optional.) Focuses the start of the grid view.
     */
    focusStart: Memo<() => void>;

    /**
     * (Optional.) Focuses the end of the grid view.
     */
    focusEnd: Memo<() => void>;
} {
    const context = useAppContext();
    const remPx = useRemPx();

    const [bottomGhostTaskId, setBottomGhostTaskId] = useState(initialBottomGhostTaskId);

    const {
        getAreChildTasksExpandedStore,
        toggleAreChildTasksExpanded,
        iterateExpandedTaskIdsUnderPath,
    } = useTaskGridViewExpansionState({
        query: rootQuery,
        initialState: initialExpansionState,
    });

    const loadedState = useStore(rootQuery.loadedStateStore);

    const stateStore = useMemo(
        () => TaskGridViewVirtualizedListState.new(rootQuery, getAreChildTasksExpandedStore),
        [getAreChildTasksExpandedStore, rootQuery],
    );

    const state = useStore(stateStore);

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        taskId: TaskId;
        onAfterDelete?: () => void;
    } | null>(null);

    const taskRowByTaskKeyRef = useRef(new Map<TaskGridViewTaskKey, TaskRowViewRef>());

    const onRenderedRangeChangeCallbacksRef = useRef<
        Array<(renderedRange: {startIndex: number; endIndex: number} | null) => void>
    >([]);
    const onTaskDeleteConfirmationModalDialogClosedCallbacksRef = useRef<Array<() => void>>([]);

    useEffect(() => {
        if (!taskDeleteConfirmationState) {
            const callbacks = onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current;
            onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current = [];

            for (const callback of callbacks) {
                callback();
            }
        }
    }, [taskDeleteConfirmationState]);

    const lastArrowNavigationCoordRef = useRef<{setTime: Date; coord: number} | null>(null);

    // Clear the last arrow navigation X position whenever the user's caret moves
    // somewhere else.
    useEffect(() => {
        const clearLastArrowNavigationCoord = () => {
            if (
                lastArrowNavigationCoordRef.current &&
                // If we just set this ref, don't clear it. We're processing browser events
                // that happened because of the arrow navigation.
                new Date().getTime() - lastArrowNavigationCoordRef.current.setTime.getTime() > 10
            ) {
                lastArrowNavigationCoordRef.current = null;
            }
        };

        document.addEventListener("focus", clearLastArrowNavigationCoord);
        document.addEventListener("blur", clearLastArrowNavigationCoord);
        document.addEventListener("selectionchange", clearLastArrowNavigationCoord);
        return () => {
            document.removeEventListener("focus", clearLastArrowNavigationCoord);
            document.removeEventListener("blur", clearLastArrowNavigationCoord);
            document.removeEventListener("selectionchange", clearLastArrowNavigationCoord);
        };
    }, []);

    const stateItemCount = state.getItemCount();

    const itemCountBeforeState = capabilities.hasColumns ? 1 : 0;

    const itemCount =
        itemCountBeforeState +
        (loadedState !== "FullyLoaded"
            ? stateItemCount + 1
            : Math.max(stateItemCount + (!capabilities.isReadOnly ? 1 : 0), 3));

    const tryLoadingMoreData = useEvent(
        (renderedRange: {startIndex: number; endIndex: number} | null) => {
            if (!renderedRange) return;

            batchStoreUpdates(() => {
                // If we are rendering the `MoreUnloadedTasks` item then load more tasks into
                // our query.
                if (loadedState !== "FullyLoaded") {
                    const moreUnloadedTasksIndex = state.getItemCount() + itemCountBeforeState;

                    if (
                        renderedRange.startIndex <= moreUnloadedTasksIndex &&
                        moreUnloadedTasksIndex <= renderedRange.endIndex
                    ) {
                        rootQuery.loadMoreTasks(
                            getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                        );
                    }
                }

                // Load more tasks for any tasks that are rendering `UnloadedChildTask`
                // child items.
                const parentTaskIdsToLoad = new Set<TaskId>();

                for (
                    let i = Math.max(renderedRange.startIndex, itemCountBeforeState);
                    i < Math.min(renderedRange.endIndex, stateItemCount + itemCountBeforeState);
                    i++
                ) {
                    const item = state.getItem(i - itemCountBeforeState);

                    if (item.type === "UnloadedChildTask") {
                        parentTaskIdsToLoad.add(
                            getTaskQuerySortCursorTaskId(
                                item.parents[item.parents.length - 1]!.cursor,
                            ),
                        );
                    }
                }

                if (parentTaskIdsToLoad.size > 0) {
                    const retainedChildrenQueries: Array<TaskClientQuery> = [];

                    // We want to immediately release the references to any queries we load after a
                    // microtask. When our expansion state hook sees there's a new query for an
                    // expanded task it will grab its own reference. So wait a microtask for that to
                    // happen and release our reference to let the expanded state hook manage the
                    // query's lifetime.
                    scheduleMicrotask(() => {
                        batchStoreUpdates(() => {
                            for (const query of retainedChildrenQueries) {
                                query.release();
                            }
                        });
                    });

                    for (const taskId of parentTaskIdsToLoad) {
                        const childrenQuery =
                            rootQuery.store.ensureAndRetainTaskChildrenQuery(taskId);
                        retainedChildrenQueries.push(childrenQuery);

                        childrenQuery?.loadMoreTasks(
                            getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                        );

                        // In addition to loading the root task query, children queries for any of its
                        // expanded child tasks so they all pop in at the same time.
                        for (const {taskId: expandedChildTaskId} of iterateExpandedTaskIdsUnderPath(
                            [taskId],
                        )) {
                            const childrenQuery =
                                rootQuery.store.ensureAndRetainTaskChildrenQuery(
                                    expandedChildTaskId,
                                );
                            retainedChildrenQueries.push(childrenQuery);

                            childrenQuery?.loadMoreTasks(
                                getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                            );
                        }
                    }
                }
            });
        },
    );

    // Whenever our list changes, try rendering more data. Maybe a task was
    // expanded and we haven't loaded the children of that task?
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [state, tryLoadingMoreData, viewRef]);

    const events: TaskGridViewVirtualizedListEvents = useEvents({
        getMoveTaskToRootQueryActions: _getMoveTaskToRootQueryActions,
        getMaybeRemoveTaskFromRootQueryActions: _getMaybeRemoveTaskFromRootQueryActions,

        getState: () => state,
        getItemCountBeforeState: () => itemCountBeforeState,

        onGhostTaskCreated: () => {
            setBottomGhostTaskId(generateId<TaskId>());
        },

        getTaskRowByIndexIfExists: (index: number): TaskRowViewRef | null => {
            const stateIndex = index - itemCountBeforeState;
            if (!(0 <= stateIndex && stateIndex < state.getItemCount())) {
                if (stateIndex === state.getItemCount() && loadedState === "FullyLoaded") {
                    return taskRowByTaskKeyRef.current.get(bottomGhostTaskId) ?? null;
                }
                return null;
            }

            const item = state.getItem(stateIndex);
            if (item.type !== "Task") return null;

            const taskId = getTaskQuerySortCursorTaskId(item.cursor);

            const taskKey: TaskGridViewTaskKey =
                item.parents.length > 0
                    ? `${getTaskQuerySortCursorTaskId(item.parents[0]!.cursor)}-${taskId}`
                    : taskId;

            return taskRowByTaskKeyRef.current.get(taskKey) ?? null;
        },

        focusStart: () => {
            for (let index = 0; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleStart();
                break;
            }
        },

        focusEnd: () => {
            for (let index = itemCount - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleEnd();
                break;
            }
        },

        focusPreviousTaskTitleEnd: (key: Key) => {
            const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(key));

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleEnd();
                break;
            }
        },

        focusPreviousTaskTitleAll: (key: Key) => {
            const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(key));

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleAll();
                break;
            }
        },

        focusTaskTitleStart: (taskKey: TaskGridViewTaskKey) => {
            taskRowByTaskKeyRef.current.get(taskKey)?.focusTitleStart();
        },

        focusTaskTitleSelection: (taskKey: TaskGridViewTaskKey, selection: Selection) => {
            taskRowByTaskKeyRef.current.get(taskKey)?.focusTitleSelection(selection);
        },

        focusNextTaskTitleCoord: (taskKey: TaskGridViewTaskKey, coord: number) => {
            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${taskKey}`),
            );

            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

            for (let index = itemIndex + 1; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleCoord(coord, "top");
                break;
            }

            lastArrowNavigationCoordRef.current = {
                setTime: new Date(),
                coord,
            };
        },

        focusPreviousTaskTitleCoord: (taskKey: TaskGridViewTaskKey, coord: number) => {
            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${taskKey}`),
            );

            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleCoord(coord, "bottom");
                break;
            }

            lastArrowNavigationCoordRef.current = {
                setTime: new Date(),
                coord,
            };
        },

        focusNextTaskCell: (taskKey: TaskGridViewTaskKey, column: TaskGridViewColumn) => {
            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${taskKey}`),
            );

            for (let index = itemIndex + 1; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusCell(column);
                break;
            }
        },

        focusPreviousTaskCell: (taskKey: TaskGridViewTaskKey, column: TaskGridViewColumn) => {
            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${taskKey}`),
            );

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusCell(column);
                break;
            }
        },

        preserveLastTaskTitleArrowNavigationCoord: () => {
            if (lastArrowNavigationCoordRef.current) {
                lastArrowNavigationCoordRef.current = {
                    setTime: new Date(),
                    coord: lastArrowNavigationCoordRef.current.coord,
                };
            }
        },

        getFirstVisibleTaskRowIfExists: (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
                const position = view.getPositionByIndex(index);

                // Look for the first visible item in the scroll window...
                if (
                    position.offset < scrollOffset ||
                    position.offset + position.height > scrollOffset + height
                ) {
                    continue;
                }

                const key = view.getKeyByIndexIfExists(index);

                // We want the first visible task row. Ignore everything else.
                if (typeof key !== "string" || !key.startsWith("Task:")) continue;

                return assertExists(
                    taskRowByTaskKeyRef.current.get(
                        key.slice("Task:".length) as TaskGridViewTaskKey,
                    ),
                );
            }

            return null;
        },

        focusFirstVisibleTaskTitleStart: () => {
            const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
            if (!firstVisibleTaskRow) return;

            // If the first visible task title is already focused then we want to scroll
            // one page up and focus the first task after scrolling.
            if (firstVisibleTaskRow.isTitleFocused()) {
                events.focusFirstPageUpTaskTitleStart();
            } else {
                firstVisibleTaskRow.focusTitleStart();
            }
        },

        focusFirstPageUpTaskTitleStart: () => {
            const view = assertExists(viewRef.current);

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            const newScrollOffset = Math.max(
                0,
                scrollOffset -
                    (height -
                        // We want to keep some overlap between tasks when paging up/down so the user
                        // doesn't completely lose their context.
                        convertRemLengthToPx(
                            spacing[taskRowViewMinHeight],
                            getRemPxWithoutListening(),
                        ) *
                            2),
            );

            const renderedRange = view.getRenderedRange();
            const expectedRenderedRange =
                view.peekRenderedRangeAfterSetScrollOffset(newScrollOffset);

            view.setScrollOffset(newScrollOffset);

            if (!expectedRenderedRange) return;

            if (isDeepEqual(renderedRange, expectedRenderedRange)) {
                const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
                firstVisibleTaskRow?.focusTitleStart();
            } else {
                onRenderedRangeChangeCallbacksRef.current.push(() => {
                    const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
                    firstVisibleTaskRow?.focusTitleStart();
                });
            }
        },

        getLastVisibleTaskRowIfExists: (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            for (let index = renderedRange.endIndex; index >= renderedRange.startIndex; index--) {
                const position = view.getPositionByIndex(index);

                // Look for the last visible item in the scroll window...
                if (
                    position.offset < scrollOffset ||
                    position.offset + position.height > scrollOffset + height
                ) {
                    continue;
                }

                const key = view.getKeyByIndexIfExists(index);

                // We want the first visible task row. Ignore everything else.
                if (typeof key !== "string" || !key.startsWith("Task:")) continue;

                return assertExists(
                    taskRowByTaskKeyRef.current.get(
                        key.slice("Task:".length) as TaskGridViewTaskKey,
                    ),
                );
            }

            return null;
        },

        focusLastVisibleTaskTitleEnd: () => {
            const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
            if (!lastVisibleTaskRow) return;

            // If the last visible task title is already focused then we want to scroll
            // one page down and focus the last task after scrolling.
            if (lastVisibleTaskRow.isTitleFocused()) {
                events.focusLastPageDownTaskTitleEnd();
            } else {
                lastVisibleTaskRow.focusTitleEnd();
            }
        },

        focusLastPageDownTaskTitleEnd: () => {
            const view = assertExists(viewRef.current);

            const height = view.getHeight();
            const contentHeight = view.getContentHeight();
            const scrollOffset = view.getScrollOffset();

            const newScrollOffset = Math.min(
                contentHeight - height,
                scrollOffset +
                    (height -
                        // We want to keep some overlap between tasks when paging up/down so the user
                        // doesn't completely lose their context.
                        convertRemLengthToPx(
                            spacing[taskRowViewMinHeight],
                            getRemPxWithoutListening(),
                        ) *
                            2),
            );

            const renderedRange = view.getRenderedRange();
            const expectedRenderedRange =
                view.peekRenderedRangeAfterSetScrollOffset(newScrollOffset);

            view.setScrollOffset(newScrollOffset);

            if (!expectedRenderedRange) return;

            if (isDeepEqual(renderedRange, expectedRenderedRange)) {
                const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
                lastVisibleTaskRow?.focusTitleEnd();
            } else {
                onRenderedRangeChangeCallbacksRef.current.push(() => {
                    const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
                    lastVisibleTaskRow?.focusTitleEnd();
                });
            }
        },
    });

    const renderItem = useMemo(() => {
        return (itemIndex: number): VirtualizedScrollViewItem => {
            // If this item is above our task list then render it.
            if (itemIndex < itemCountBeforeState) {
                const minHeight =
                    convertRemLengthToPx("1.25rem", remPx) +
                    // We add one extra pixel of bottom padding so the focus ring on the first row
                    // is not covered by our header.
                    1;

                return {
                    key: "ColumnHeader",
                    minHeight,
                    withManualLayout: true,
                    render: ({ref, offset, height, shouldRenderWithRelativePositioning}) => (
                        <TaskGridViewColumnHeaderMemo
                            withColumnHeaderBorderTop={withColumnHeaderBorderTop}
                            minHeight={minHeight}
                            virtualizedItemRef={ref}
                            offset={offset}
                            height={height}
                            shouldRenderWithRelativePositioning={
                                shouldRenderWithRelativePositioning
                            }
                        />
                    ),
                };
            }

            // If this item is below our task list then render either a ghost row or empty
            // decorative rows.
            if (itemIndex >= itemCountBeforeState + stateItemCount) {
                let relativeItemIndex = itemIndex - stateItemCount - itemCountBeforeState;

                if (loadedState !== "FullyLoaded") {
                    return {
                        key: "MoreUnloadedTasks",
                        minHeight: taskGridViewMoreUnloadedTasksSpinnerHeight,
                        node: (
                            <TaskGridViewMoreUnloadedTasksMemo
                                capabilities={capabilities}
                                focusPreviousTaskTitleEnd={events.focusPreviousTaskTitleEnd}
                                focusPreviousTaskTitleAll={events.focusPreviousTaskTitleAll}
                            />
                        ),
                    };
                }

                if (relativeItemIndex === 0) {
                    return {
                        // We want to use the same key and component as a regular task so we can turn a
                        // ghost task into a regular task without losing focus.
                        key: `Task:${bottomGhostTaskId}`,
                        minHeight: spacing[taskRowViewMinHeight],
                        withManualLayout: true,
                        render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                            disableExpensiveFeaturesDuringScroll => (
                                <TaskRowViewMemo
                                    context={context}
                                    capabilities={capabilities}
                                    rootQuery={rootQuery}
                                    query={rootQuery}
                                    taskKey={bottomGhostTaskId}
                                    cursor={null}
                                    ghostTaskId={bottomGhostTaskId}
                                    parents={emptyArray}
                                    disableExpensiveFeaturesDuringScroll={
                                        disableExpensiveFeaturesDuringScroll
                                    }
                                    isFirstRow={stateItemCount === 0}
                                    nextIndentation={0}
                                    // NOCOMMIT: Ghost row placeholder sequence!
                                    titlePlaceholder={
                                        !capabilities.isReadOnly ? "Add a task…" : undefined
                                    }
                                    viewRef={viewRef}
                                    events={events}
                                    taskRowByTaskKeyRef={taskRowByTaskKeyRef}
                                    getAreChildTasksExpandedStore={getAreChildTasksExpandedStore}
                                    toggleAreChildTasksExpanded={toggleAreChildTasksExpanded}
                                    setTaskDeleteConfirmationState={setTaskDeleteConfirmationState}
                                    onTaskDeleteConfirmationModalDialogClosedCallbacksRef={
                                        onTaskDeleteConfirmationModalDialogClosedCallbacksRef
                                    }
                                    // If there are no task rows, the padding just makes our ghost row placeholder
                                    // look misaligned. So remove it.
                                    withoutPaddingLeft={stateItemCount === 0}
                                    withPaddingBottom={itemIndex === itemCount - 1}
                                />
                            ),
                        ),
                    };
                }

                relativeItemIndex -= 1;

                return {
                    key: `DecorativeGhostTask:${relativeItemIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewDecorativeGhostTaskMemo
                            capabilities={capabilities}
                            relativeItemIndex={relativeItemIndex}
                            isLastItem={itemIndex === itemCount - 1}
                            focusPreviousTaskTitleEnd={events.focusPreviousTaskTitleEnd}
                            focusPreviousTaskTitleAll={events.focusPreviousTaskTitleAll}
                        />
                    ),
                };
            }

            const item = state.getItem(itemIndex - itemCountBeforeState);

            if (item.type === "Task") {
                const taskId = getTaskQuerySortCursorTaskId(item.cursor);

                const taskKey: TaskGridViewTaskKey =
                    item.parents.length > 0
                        ? `${getTaskQuerySortCursorTaskId(item.parents[0]!.cursor)}-${taskId}`
                        : taskId;

                return {
                    key: `Task:${taskKey}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    withManualLayout: true,
                    render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                        disableExpensiveFeaturesDuringScroll => (
                            <TaskRowViewMemo
                                context={context}
                                capabilities={capabilities}
                                rootQuery={rootQuery}
                                query={item.query}
                                taskKey={taskKey}
                                cursor={item.cursor}
                                parents={item.parents}
                                disableExpensiveFeaturesDuringScroll={
                                    disableExpensiveFeaturesDuringScroll
                                }
                                isFirstRow={itemIndex - itemCountBeforeState === 0}
                                nextIndentation={
                                    itemIndex + 1 < itemCountBeforeState + stateItemCount
                                        ? // This doesn't mess up the `state.getItem(n + 1)` optimization since
                                          // repeatedly calling `state.getItem(n)` preserves the internal iterator.
                                          state.getItem(itemIndex - itemCountBeforeState + 1)
                                              .parents.length
                                        : 0
                                }
                                viewRef={viewRef}
                                events={events}
                                taskRowByTaskKeyRef={taskRowByTaskKeyRef}
                                getAreChildTasksExpandedStore={getAreChildTasksExpandedStore}
                                toggleAreChildTasksExpanded={toggleAreChildTasksExpanded}
                                setTaskDeleteConfirmationState={setTaskDeleteConfirmationState}
                                onTaskDeleteConfirmationModalDialogClosedCallbacksRef={
                                    onTaskDeleteConfirmationModalDialogClosedCallbacksRef
                                }
                            />
                        ),
                    ),
                };
            } else {
                cast<"UnloadedChildTask">(item.type);

                assert(item.parents.length > 0);

                const parentTaskId = getTaskQuerySortCursorTaskId(
                    item.parents[item.parents.length - 1]!.cursor,
                );

                const parentTaskKey: TaskGridViewTaskKey =
                    item.parents.length > 1
                        ? `${getTaskQuerySortCursorTaskId(item.parents[0]!.cursor)}-${parentTaskId}`
                        : parentTaskId;

                return {
                    key: `UnloadedChildTask:${parentTaskKey}-${item.unloadedChildTaskIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewUnloadedChildTaskMemo
                            capabilities={capabilities}
                            parentTaskKey={parentTaskKey}
                            unloadedChildTaskIndex={item.unloadedChildTaskIndex}
                            indentation={item.parents.length}
                            focusPreviousTaskTitleEnd={events.focusPreviousTaskTitleEnd}
                            focusPreviousTaskTitleAll={events.focusPreviousTaskTitleAll}
                        />
                    ),
                };
            }
        };
    }, [
        bottomGhostTaskId,
        capabilities,
        context,
        events,
        getAreChildTasksExpandedStore,
        itemCount,
        itemCountBeforeState,
        state,
        stateItemCount,
        loadedState,
        rootQuery,
        remPx,
        toggleAreChildTasksExpanded,
        viewRef,
        withColumnHeaderBorderTop,
    ]);

    return {
        itemCount,
        renderItem,
        onRenderedRangeChange: (renderedRange: {startIndex: number; endIndex: number} | null) => {
            tryLoadingMoreData(renderedRange);

            const callbacks = onRenderedRangeChangeCallbacksRef.current;
            onRenderedRangeChangeCallbacksRef.current = [];

            for (const callback of callbacks) {
                callback(renderedRange);
            }
        },
        alwaysRenderAdditionalItemIndexes: useMemo(
            () => (capabilities.hasColumns ? [0] : emptyArray),
            [capabilities.hasColumns],
        ),
        insetScrollbarItemIndex: capabilities.hasColumns ? 0 : undefined,
        modals: taskDeleteConfirmationState && (
            <TaskDeleteConfirmationModalDialog
                store={rootQuery.store}
                taskId={taskDeleteConfirmationState.taskId}
                onClose={() => setTaskDeleteConfirmationState(null)}
                onAfterDelete={taskDeleteConfirmationState.onAfterDelete}
            />
        ),
        focusStart: events.focusStart,
        focusEnd: events.focusEnd,
    };
}

type TaskGridViewVirtualizedListEvents = MemoObject<{
    readonly getMoveTaskToRootQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    readonly getMaybeRemoveTaskFromRootQueryActions: (taskId: TaskId) => Array<TaskAction>;
    readonly getState: () => TaskGridViewVirtualizedListState;
    readonly getItemCountBeforeState: () => number;
    readonly onGhostTaskCreated: () => void;
    readonly getTaskRowByIndexIfExists: (index: number) => TaskRowViewRef | null;
    readonly focusStart: () => void;
    readonly focusEnd: () => void;
    readonly focusPreviousTaskTitleEnd: (key: Key) => void;
    readonly focusPreviousTaskTitleAll: (key: Key) => void;
    readonly focusTaskTitleStart: (taskKey: TaskGridViewTaskKey) => void;
    readonly focusTaskTitleSelection: (taskKey: TaskGridViewTaskKey, selection: Selection) => void;
    readonly focusNextTaskTitleCoord: (taskKey: TaskGridViewTaskKey, coord: number) => void;
    readonly focusPreviousTaskTitleCoord: (taskKey: TaskGridViewTaskKey, coord: number) => void;
    readonly focusNextTaskCell: (taskKey: TaskGridViewTaskKey, column: TaskGridViewColumn) => void;
    readonly focusPreviousTaskCell: (
        taskKey: TaskGridViewTaskKey,
        column: TaskGridViewColumn,
    ) => void;
    readonly preserveLastTaskTitleArrowNavigationCoord: () => void;
    readonly getFirstVisibleTaskRowIfExists: () => TaskRowViewRef | null;
    readonly focusFirstVisibleTaskTitleStart: () => void;
    readonly focusFirstPageUpTaskTitleStart: () => void;
    readonly getLastVisibleTaskRowIfExists: () => TaskRowViewRef | null;
    readonly focusLastVisibleTaskTitleEnd: () => void;
    readonly focusLastPageDownTaskTitleEnd: () => void;
}>;

const TaskGridViewColumnHeaderMemo = memo(function TaskGridViewColumnHeaderMemo({
    withColumnHeaderBorderTop,
    minHeight,
    virtualizedItemRef,
    offset,
    height,
    shouldRenderWithRelativePositioning,
}: {
    withColumnHeaderBorderTop: boolean;
    minHeight: number;
    virtualizedItemRef: Ref<HTMLDivElement>;
    offset: number;
    height: number;
    shouldRenderWithRelativePositioning: boolean;
}) {
    return (
        <>
            {withColumnHeaderBorderTop && (
                // `grey-10` top border that replaces `<TaskLayoutTopBar>` border when column
                // header is not overlaying tasks. You should configure `<TaskLayoutTopBar>` to
                // not have a bottom border and this will render instead.
                //
                // It's notable that we use this `position: sticky` strategy for border
                // replacement so browsers can synchronously render the border replacement off
                // the main thread without requiring blocking JavaScript code in the scroll hot
                // path.
                //
                // See this explainer on scroll-linked effects:
                // https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html
                <Box
                    position="absolute"
                    left="0"
                    right="0"
                    top="0"
                    style={{height: offset}}
                    // Render above overlays which are at `zIndex="50"`
                    zIndex="60"
                    pointerEvents="none"
                >
                    <Box position="sticky" top="0" left="0" right="0" borderBottom="grey-10" />
                </Box>
            )}
            {withColumnHeaderBorderTop && (
                // `grey-5` top border that replaces `<TaskLayoutTopBar>` border when column
                // header overlays tasks to make it feel like column header is part of the
                // same material as the header.
                <Box
                    position="absolute"
                    left="0"
                    right="0"
                    bottom="0"
                    style={{top: offset}}
                    // Render above overlays which are at `zIndex="50"`
                    zIndex="80"
                    pointerEvents="none"
                >
                    <Box
                        position="sticky"
                        top="0"
                        left="0"
                        right="0"
                        zIndex="10"
                        borderBottom="grey-5"
                    />
                    {offset > 0 && (
                        <Box
                            position="absolute"
                            top="0"
                            left="0"
                            right="0"
                            zIndex="20"
                            borderBottom="grey-0"
                        />
                    )}
                </Box>
            )}
            <Box
                // `grey-10` bottom border of column header that slides in when the column
                // header overlays tasks.
                position="absolute"
                left="0"
                right="0"
                bottom="0"
                style={{top: offset - 1}}
                // Render above overlays which are at `zIndex="50"`
                zIndex="60"
                pointerEvents="none"
            >
                <Box
                    position="sticky"
                    top="0"
                    left="0"
                    right="0"
                    borderBottom="grey-10"
                    style={{height: height - 1}}
                />
            </Box>
            <Box
                style={{
                    minHeight,
                    ...(shouldRenderWithRelativePositioning
                        ? {position: "relative"}
                        : {
                              position: "absolute",
                              top: offset,
                              left: 0,
                              right: 0,
                              bottom: 0,
                          }),
                }}
                // Render above overlays which are at `zIndex="50"`
                zIndex="70"
                pointerEvents="none"
            >
                <Box
                    ref={virtualizedItemRef}
                    position="sticky"
                    top="0"
                    pointerEvents="auto"
                    style={{
                        // One pixel of bottom padding so the focus ring on the first row is not covered
                        // by our header.
                        paddingBottom: 1,
                    }}
                >
                    <Box
                        zIndex="-10"
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        // Render background color with an absolute positioned `<div>` so we don't
                        // cover the border rendered by `<TaskRowView>` (or our separate sticky div).
                        style={{bottom: 2}}
                        backgroundColor="grey-0"
                    />
                    <Box paddingTop="0.5" display="flex">
                        <Box
                            flexShrink="0"
                            width="32"
                            paddingLeft="5"
                            paddingBottom="1"
                            color="grey-50"
                            fontSize="50"
                        >
                            Name
                        </Box>
                        <Box flexGrow="1" />
                        <Box
                            flexShrink="0"
                            style={{
                                width: taskRowViewFirstColumnWidth,
                                paddingLeft: taskRowViewFirstColumnPaddingLeft,
                            }}
                            paddingX={taskRowViewColumnPaddingX}
                            paddingBottom="1"
                            color="grey-50"
                            fontSize="50"
                        >
                            Assignee
                        </Box>
                        <Box
                            flexShrink="0"
                            width={taskRowViewColumnWidth}
                            paddingX={taskRowViewColumnPaddingX}
                            paddingBottom="1"
                            color="grey-50"
                            fontSize="50"
                        >
                            Priority
                        </Box>
                        <Box
                            flexShrink="0"
                            width={taskRowViewColumnWidth}
                            paddingX={taskRowViewColumnPaddingX}
                            paddingBottom="1"
                            color="grey-50"
                            fontSize="50"
                        >
                            Due date
                        </Box>
                        <Box
                            flexShrink="0"
                            width={taskRowViewCollectionsColumnWidth}
                            paddingLeft={taskRowViewColumnPaddingX}
                            paddingRight={taskRowViewLastColumnPaddingRight}
                            paddingBottom="1"
                            color="grey-50"
                            fontSize="50"
                        >
                            Collections
                        </Box>
                        <Box flexShrink="0" width="5" />
                    </Box>
                </Box>
            </Box>
        </>
    );
});

const TaskGridViewMoreUnloadedTasksMemo = memo(function TaskGridViewMoreUnloadedTasksMemo({
    capabilities,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    focusPreviousTaskTitleEnd: Memo<(key: string) => void>;
    focusPreviousTaskTitleAll: Memo<(key: string) => void>;
}) {
    return (
        <>
            <TaskRowShimmer
                capabilities={capabilities}
                randomSeed="MoreUnloadedTasks"
                index={0}
                indentation={0}
                focusPreviousTaskTitleEnd={() => focusPreviousTaskTitleEnd("MoreUnloadedTasks")}
                focusPreviousTaskTitleAll={() => focusPreviousTaskTitleAll("MoreUnloadedTasks")}
            />
            <TaskRowShimmer
                capabilities={capabilities}
                randomSeed="MoreUnloadedTasks"
                index={1}
                indentation={0}
                focusPreviousTaskTitleEnd={() => focusPreviousTaskTitleEnd("MoreUnloadedTasks")}
                focusPreviousTaskTitleAll={() => focusPreviousTaskTitleAll("MoreUnloadedTasks")}
            />
            <TaskRowShimmer
                capabilities={capabilities}
                randomSeed="MoreUnloadedTasks"
                index={2}
                indentation={0}
                focusPreviousTaskTitleEnd={() => focusPreviousTaskTitleEnd("MoreUnloadedTasks")}
                focusPreviousTaskTitleAll={() => focusPreviousTaskTitleAll("MoreUnloadedTasks")}
            />
            <Box
                display="flex"
                justifyContent="center"
                color="grey-60"
                paddingY="4"
                pointerEvents="none"
            >
                <SpinnerGap className={spinAnimationClassName} size={spacing["6"]} weight="light" />
            </Box>
        </>
    );
});

const TaskGridViewDecorativeGhostTaskMemo = memo(function TaskGridViewDecorativeGhostTaskMemo({
    capabilities,
    relativeItemIndex,
    isLastItem,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    relativeItemIndex: number;
    isLastItem: boolean;
    focusPreviousTaskTitleEnd: Memo<(key: string) => void>;
    focusPreviousTaskTitleAll: Memo<(key: string) => void>;
}) {
    return (
        <Box
            paddingX="5"
            height={taskRowViewMinHeight}
            // Create an illusion that the text editor extends into the margins by giving
            // the margin a text cursor and making it clickable putting focus in the task.
            // A double click selects the task text.
            //
            // This is an affordance for mouse users, does not need to be usable
            // by keyboard.
            cursor={!capabilities.isReadOnly ? "text" : undefined}
            {...useOutOfBoundsClickSelection({
                isDisabled: capabilities.isReadOnly,
                onSelect: () =>
                    focusPreviousTaskTitleEnd(`DecorativeGhostTask:${relativeItemIndex}`),
                onSelectAll: () =>
                    focusPreviousTaskTitleAll(`DecorativeGhostTask:${relativeItemIndex}`),
            })}
        >
            <Box
                width="full"
                height="full"
                pointerEvents="none"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            />
            {isLastItem && <Box width="full" height="2" pointerEvents="none" />}
        </Box>
    );
});

// NOCOMMIT: Test scrolling into a bunch of unloaded tasks
const TaskGridViewUnloadedChildTaskMemo = memo(function TaskGridViewUnloadedChildTaskMemo({
    capabilities,
    parentTaskKey,
    unloadedChildTaskIndex,
    indentation,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    parentTaskKey: TaskGridViewTaskKey;
    unloadedChildTaskIndex: number;
    indentation: number;
    focusPreviousTaskTitleEnd: Memo<(key: string) => void>;
    focusPreviousTaskTitleAll: Memo<(key: string) => void>;
}) {
    return (
        <TaskRowShimmer
            capabilities={capabilities}
            randomSeed={parentTaskKey}
            index={unloadedChildTaskIndex}
            indentation={indentation}
            focusPreviousTaskTitleEnd={() =>
                focusPreviousTaskTitleEnd(
                    `UnloadedChildTask:${parentTaskKey}-${unloadedChildTaskIndex}`,
                )
            }
            focusPreviousTaskTitleAll={() =>
                focusPreviousTaskTitleAll(
                    `UnloadedChildTask:${parentTaskKey}-${unloadedChildTaskIndex}`,
                )
            }
        />
    );
});

const TaskRowViewMemo = memo(function TaskRowViewMemo({
    context,
    capabilities,
    rootQuery,
    query,
    taskKey,
    cursor,
    ghostTaskId,
    parents,
    disableExpensiveFeaturesDuringScroll,
    isFirstRow,
    nextIndentation,
    titlePlaceholder,
    viewRef,
    events,
    taskRowByTaskKeyRef,
    getAreChildTasksExpandedStore,
    toggleAreChildTasksExpanded,
    setTaskDeleteConfirmationState,
    onTaskDeleteConfirmationModalDialogClosedCallbacksRef,
    withoutPaddingLeft,
    withPaddingBottom,
}: {
    context: AppContext;
    capabilities: Memo<TaskGridViewCapabilities>;
    rootQuery: TaskClientQuery;
    query: TaskClientQuery;
    taskKey: TaskGridViewTaskKey;
    cursor: TaskQuerySortCursor | null;
    ghostTaskId?: TaskId | null;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    disableExpensiveFeaturesDuringScroll: boolean;
    isFirstRow: boolean;
    nextIndentation: number;
    titlePlaceholder?: string;
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
    events: TaskGridViewVirtualizedListEvents;
    taskRowByTaskKeyRef: MutableRefObject<Map<TaskGridViewTaskKey, TaskRowViewRef>>;
    getAreChildTasksExpandedStore: Memo<
        (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>
    >;
    toggleAreChildTasksExpanded: Memo<
        (taskPath: ReadonlyArray<TaskId>, options?: {onFinish?: () => void}) => void
    >;
    setTaskDeleteConfirmationState: Dispatch<
        SetStateAction<{
            taskId: TaskId;
            onAfterDelete?: (() => void) | undefined;
        } | null>
    >;
    onTaskDeleteConfirmationModalDialogClosedCallbacksRef: MutableRefObject<Array<() => void>>;
    withoutPaddingLeft?: boolean;
    withPaddingBottom?: boolean;
}) {
    const taskPath = cursor
        ? [
              ...parents.map(({cursor}) => getTaskQuerySortCursorTaskId(cursor)),
              getTaskQuerySortCursorTaskId(cursor),
          ]
        : null;

    // If this is the root query then the new task needs to be added to that query.
    // Otherwise we want to add the new task at the same indentation level that our
    // task is currently at.
    const getMoveTaskToQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction> =
        query === rootQuery
            ? events.getMoveTaskToRootQueryActions
            : (newTaskId, position) => {
                  const time1 = rootQuery.store.clock.now();
                  const time2 = rootQuery.store.clock.now();

                  return [
                      {
                          type: "UpdateTask",
                          time: time1,
                          taskId: newTaskId,
                          taskAction: {
                              type: "UpdateParentTaskId",
                              parentTaskId: getTaskQuerySortCursorTaskId(
                                  assertExists(parents[parents.length - 1]).cursor,
                              ),
                          },
                      },
                      {
                          type: "UpdateTask",
                          time: time2,
                          taskId: newTaskId,
                          taskAction: {
                              type: "UpdateParentPosition",
                              parentPosition: getNewTaskPositionForQuerySortedByPosition(
                                  time2,
                                  query,
                                  position,
                              ),
                          },
                      },
                  ];
              };

    const getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction> =
        query === rootQuery
            ? events.getMaybeRemoveTaskFromRootQueryActions
            : taskId => [
                  {
                      type: "UpdateTask",
                      time: rootQuery.store.clock.now(),
                      taskId,
                      taskAction: {
                          type: "UpdateParentTaskId",
                          parentTaskId: null,
                      },
                  },
              ];

    const nestWithPreviousTaskRowIfExistsAndExpand = (titleSelection: Selection) => {
        if (!cursor) return;

        const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(`Task:${taskKey}`));

        const state = events.getState();
        const itemCountBeforeState = events.getItemCountBeforeState();

        for (let previousItemIndex = itemIndex - 1; previousItemIndex >= 0; previousItemIndex--) {
            const indentation = parents.length;

            const previousItem = state.getItem(previousItemIndex - itemCountBeforeState);
            const previousIndentation = previousItem.parents.length;

            if (previousIndentation > indentation) continue;
            if (previousIndentation < indentation) break;

            if (previousItem.type !== "Task") break;

            const taskId = getTaskQuerySortCursorTaskId(cursor);
            const previousTaskId = getTaskQuerySortCursorTaskId(previousItem.cursor);

            const nest = () => {
                rootQuery.store.commitTaskActionTransaction(context, [
                    // If we are indenting at the root of our query then we want to remove the task
                    // from the query root since it lives in its parent task now.
                    //
                    // Must come first since if we're removing a task from its parent then our
                    // following action needs to set the parent again.
                    ...(query === rootQuery
                        ? events.getMaybeRemoveTaskFromRootQueryActions(taskId)
                        : []),

                    {
                        type: "UpdateTask",
                        time: rootQuery.store.clock.now(),
                        taskId,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: previousTaskId,
                        },
                    },
                ]);

                // Store updates are rendered by React immediately. So focus our task before
                // the next paint.
                requestAnimationFrame(() => {
                    if (previousItem.parents.length === 0) {
                        events.focusTaskTitleSelection(
                            `${previousTaskId}-${taskId}`,
                            titleSelection,
                        );
                    } else {
                        events.focusTaskTitleSelection(
                            `${getTaskQuerySortCursorTaskId(
                                previousItem.parents[0]!.cursor,
                            )}-${taskId}`,
                            titleSelection,
                        );
                    }
                });
            };

            const previousTaskPath = [
                ...previousItem.parents.map(({cursor}) => getTaskQuerySortCursorTaskId(cursor)),
                getTaskQuerySortCursorTaskId(previousItem.cursor),
            ];

            // Expand our new parent task if it's not already expanded.
            if (getAreChildTasksExpandedStore(previousTaskPath).getSnapshot()) {
                nest();
            } else {
                toggleAreChildTasksExpanded(previousTaskPath, {
                    onFinish: nest,
                });
            }
            break;
        }
    };

    const unnestTaskIfNestedRow = (titleSelection: Selection) => {
        if (!cursor || parents.length === 0) return;

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        const oldParentTaskId = query.getLoadedTaskSnapshot(taskId).getParent()?.taskId ?? null;
        if (!oldParentTaskId) return;

        const newParentTaskId =
            parents.length > 1
                ? getTaskQuerySortCursorTaskId(parents[parents.length - 2]!.cursor)
                : null;

        // If our task no longer has any parent then move it into our root query.
        if (!newParentTaskId) {
            rootQuery.store.commitTaskActionTransaction(context, [
                {
                    type: "UpdateTask",
                    time: rootQuery.store.clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                ...events.getMoveTaskToRootQueryActions(taskId, {
                    type: "Below",
                    taskId: oldParentTaskId,
                }),
            ]);
        }
        // Move the task to our parent's parent. If we have access to the new parent's
        // children query then we can pick a position below our old parent.
        else {
            const time1 = rootQuery.store.clock.now();
            const time2 = rootQuery.store.clock.now();

            const newChildrenQuery = rootQuery.store
                .getTaskChildrenQueryStore(newParentTaskId)
                .getSnapshot();

            rootQuery.store.commitTaskActionTransaction(context, [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: newParentTaskId,
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: newChildrenQuery
                            ? getNewTaskPositionForQuerySortedByPosition(time2, newChildrenQuery, {
                                  type: "Below",
                                  taskId: oldParentTaskId,
                              })
                            : {
                                  orderTime: time2,
                                  orderKey: initialOrderKey,
                              },
                    },
                },
            ]);
        }

        // Store updates are rendered by React immediately. So focus our task before
        // the next paint.
        requestAnimationFrame(() => {
            if (parents.length <= 1) {
                events.focusTaskTitleSelection(taskId, titleSelection);
            } else {
                events.focusTaskTitleSelection(
                    `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${taskId}`,
                    titleSelection,
                );
            }
        });
    };

    const deleteTaskAndAllChildren = ({withConfirmation}: {withConfirmation: boolean}) => {
        if (!cursor) return;

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        if (!withConfirmation) {
            rootQuery.store.deleteTaskAndAllChildren(context, taskId);
        } else {
            setTaskDeleteConfirmationState({taskId});
        }
    };

    const deleteTaskAndAllChildrenAndFocusPreviousRow = ({
        withConfirmation,
    }: {
        withConfirmation: boolean;
    }) => {
        // If this is a ghost task then hitting delete should focus the task above it.
        if (!cursor) {
            events.focusPreviousTaskTitleEnd(`Task:${taskKey}`);
            return;
        }

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(`Task:${taskKey}`));

        const focusPreviousRow = (itemIndex: number) => {
            let hasFoundPreviousRow = false;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleEnd();
                hasFoundPreviousRow = true;
                break;
            }

            // If there is no previous row (we're the first row) then we want to focus the
            // start of the next row instead.
            if (!hasFoundPreviousRow) {
                for (let index = itemIndex + 1; index < events.getState().getItemCount(); index++) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleStart();
                    break;
                }
            }
        };

        if (!withConfirmation) {
            rootQuery.store.deleteTaskAndAllChildren(context, taskId);
            focusPreviousRow(itemIndex);
        } else {
            setTaskDeleteConfirmationState({
                taskId,
                onAfterDelete: () => {
                    const view = viewRef.current;
                    if (!view) return;

                    // The item may have moved since we opened the modal (e.g. it shifted down one
                    // place since a task was added above). Focus the title before the task's new
                    // position.
                    const itemIndex = view.getIndexByKeyIfExists(`Task:${taskKey}`);
                    if (itemIndex === null) return;

                    // Once React has closed the modal dialog, focus the previous task. Until the
                    // modal dialog is closed, focus is trapped inside it.
                    onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current.push(() =>
                        focusPreviousRow(itemIndex),
                    );
                },
            });
        }
    };

    return (
        <TaskRowView
            ref={taskRow => {
                if (!taskRow) {
                    taskRowByTaskKeyRef.current.delete(taskKey);
                } else {
                    taskRowByTaskKeyRef.current.set(taskKey, taskRow);
                }
            }}
            capabilities={capabilities}
            // It's important we use the `query` property from `item` since child tasks
            // come from a different query than our root query.
            query={query}
            cursor={cursor}
            ghostTaskId={ghostTaskId}
            onGhostTaskCreated={events.onGhostTaskCreated}
            parents={parents}
            disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
            titlePlaceholder={titlePlaceholder}
            isFirstRow={isFirstRow}
            nextIndentation={nextIndentation}
            areChildTasksExpandedStore={
                taskPath ? getAreChildTasksExpandedStore(taskPath) : undefinedConstStore
            }
            onAreChildTasksExpandedToggle={() => {
                if (!taskPath) return;
                toggleAreChildTasksExpanded(taskPath);
            }}
            withoutPaddingLeft={withoutPaddingLeft}
            withPaddingBottom={withPaddingBottom}
            getMoveTaskToRootQueryActions={events.getMoveTaskToRootQueryActions}
            getMoveTaskToQueryActions={getMoveTaskToQueryActions}
            getMaybeRemoveTaskFromQueryActions={getMaybeRemoveTaskFromQueryActions}
            nestWithPreviousTaskRowIfExistsAndExpand={nestWithPreviousTaskRowIfExistsAndExpand}
            unnestTaskIfNestedRow={unnestTaskIfNestedRow}
            deleteTaskAndAllChildren={deleteTaskAndAllChildren}
            deleteTaskAndAllChildrenAndFocusPreviousRow={
                deleteTaskAndAllChildrenAndFocusPreviousRow
            }
            focusTaskTitleStart={events.focusTaskTitleStart}
            focusNextTaskTitleCoord={coord => events.focusNextTaskTitleCoord(taskKey, coord)}
            focusPreviousTaskTitleCoord={coord =>
                events.focusPreviousTaskTitleCoord(taskKey, coord)
            }
            focusNextTaskCell={column => events.focusNextTaskCell(taskKey, column)}
            focusPreviousTaskCell={column => events.focusPreviousTaskCell(taskKey, column)}
            preserveLastTaskTitleArrowNavigationCoord={
                events.preserveLastTaskTitleArrowNavigationCoord
            }
            focusFirstVisibleTaskTitleStart={events.focusFirstVisibleTaskTitleStart}
            focusLastVisibleTaskTitleEnd={events.focusLastVisibleTaskTitleEnd}
        />
    );
});
