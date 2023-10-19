import {AnimationControls, animate} from "motion";
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
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {MemoObject, useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
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
import {
    TaskGridViewVirtualizedListAnimation,
    TaskGridViewVirtualizedListState,
    isTaskGridViewVirtualizedListStateItemAfter,
} from "~/client/tasks/internal/task_grid_view_virtualized_list_state.js";
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
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    spacing,
} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {LinkedList} from "~/shared/helpers/immutable/linked_list.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, spinAnimationClassName, tasksStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
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
    getPositionByKeyIfExists: (key: Key) => {offset: number; height: number} | null;
    peekRenderedRangeAfterSetScrollOffset: (
        scrollOffset: number,
    ) => {startIndex: number; endIndex: number} | null;
    getContentElement: () => HTMLElement;
    getItemElementByKeyIfExists: (key: Key) => HTMLElement | null;
};

// Should be able to pass `VirtualizedScrollViewRef` in for
// `TaskGridViewVirtualizedListViewRef`. Often our virtualized grid view will
// have other stuff besides tasks so a modified ref object may be passed in.
assertAssignableTypes<VirtualizedScrollViewRef, TaskGridViewVirtualizedListViewRef>();

function isTaskQueryManuallySorted(sorts: ReadonlyArray<TaskQueryNormalizedSort>): boolean {
    if (sorts.length === 0) return false;
    const firstSort = sorts[0]!;
    return (
        firstSort.type === "ParentPosition" ||
        firstSort.type === "CollectionPosition" ||
        firstSort.type === "NotepadPagePosition" ||
        firstSort.type === "AssigneeActivePosition"
    );
}

let disableAllTaskGridViewAnimations = false;
const disableTaskGridViewAnimationsForTaskIds = new Set<TaskId>();

/**
 * Disable animations on the provided `TaskId` until the next browser paint.
 * This only works if you have (or will have) an immediate React render queued
 * up before the next paint.
 */
export function disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId: TaskId) {
    disableTaskGridViewAnimationsForTaskIds.add(taskId);
    scheduleAfterNextBrowserPaint(() => {
        disableTaskGridViewAnimationsForTaskIds.delete(taskId);
    });
}

/**
 * Disable all animations in task grid views until the next browser paint. This
 * only works if you have (or will have) an immediate React render queued up before
 * the next paint.
 *
 * Since this disables ALL animations, generally prefer using
 * `disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint()` to target
 * specific tasks.
 */
export function disableAllTaskGridViewAnimationsUntilNextBrowserPaint() {
    disableAllTaskGridViewAnimations = true;
    scheduleAfterNextBrowserPaint(() => {
        disableAllTaskGridViewAnimations = false;
    });
}

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
    getMoveTaskToQueryActions: getMoveTaskToRootQueryActions,
    getMaybeRemoveTaskFromQueryActions: getMaybeRemoveTaskFromRootQueryActions,
    withColumnHeaderBorderTop = false,
    withColumnHeaderExtraScrollSpace = "0",
    columnHeaderControls,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    query: TaskClientQuery | null;
    initialExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
    getMoveTaskToQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
    withColumnHeaderBorderTop?: boolean;
    withColumnHeaderExtraScrollSpace?: Spacing | "px";
    columnHeaderControls?: Memo<{minHeight: RemLength | number; node: ReactNode}>;
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
     * Should be called when the rendered range changes. Should be passed to
     * `<VirtualizedScrollView>`.
     */
    onRenderedRangeLayoutChange: (
        renderedRange: {startIndex: number; endIndex: number} | null,
    ) => void;

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

    const isRootQueryNull = rootQuery === null;
    const isRootQueryManuallySorted = isTaskQueryManuallySorted(rootQuery?.sorts ?? emptyArray);

    const {
        getAreChildTasksExpandedStore,
        toggleAreChildTasksExpanded,
        iterateExpandedTaskIdsUnderPath,
    } = useTaskGridViewExpansionState({
        query: rootQuery,
        initialState: initialExpansionState,
    });

    // Consider a null `rootQuery` as a fully loaded empty query.
    const loadedState = useStore(rootQuery?.loadedStateStore ?? null) ?? "FullyLoaded";

    const stateStore = useMemo(
        () => TaskGridViewVirtualizedListState.new(rootQuery, getAreChildTasksExpandedStore),
        [getAreChildTasksExpandedStore, rootQuery],
    );

    const state = useStore(stateStore);

    const stateItemCount = state.getItemCount();

    const itemCountBeforeState = capabilities.hasColumns ? 1 : 0;

    const itemCount =
        itemCountBeforeState +
        (loadedState !== "FullyLoaded"
            ? stateItemCount + 1
            : Math.max(stateItemCount + (!capabilities.isReadOnly ? 1 : 0), 3));

    const taskRowByTaskKeyRef = useRef(new Map<TaskGridViewTaskKey, TaskRowViewRef>());

    /* ========================================================================== *\
     *                         Delete Confirmation State                          *
    \* ========================================================================== */

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        taskId: TaskId;
        onAfterDelete?: () => void;
    } | null>(null);

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

    /* ========================================================================== *\
     *                            Arrow Key Navigation                            *
    \* ========================================================================== */

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

    /* ========================================================================== *\
     *                             Row Number Counter                             *
    \* ========================================================================== */

    const updateRowNumberCounter = useEvent(
        (renderedRange: {startIndex: number; endIndex: number} | null) => {
            if (!rootQuery || isRootQueryManuallySorted) return;

            if (!renderedRange) return;

            for (
                let i = Math.max(renderedRange.startIndex, itemCountBeforeState);
                i < Math.min(renderedRange.endIndex, stateItemCount + itemCountBeforeState);
                i++
            ) {
                const item = stateStore.getSnapshot().getItem(i - itemCountBeforeState);

                if (item.type === "Task" && item.parents.length === 0) {
                    // NOTE(calebmer): It's important that we set this style on the virtualized
                    // view's `contentElement` and not the `viewElement`! This is because
                    // `useScrollbar()` listens for mutations on scrollable elements and will
                    // measure the height to see if the scrollbar needs to be adjusted. Measuring
                    // height triggers a browser layout. Browser layouts are expensive so we avoid
                    // triggering a browser layout by updating the content element instead.
                    assertExists(viewRef.current).getContentElement().style.counterReset = `${
                        tasksStyles.rowNumberCounterName
                    } ${item.query.getLoadedTaskIndex(item.cursor)}`;

                    return;
                }
            }
        },
    );

    // Whenever our list changes, update the row counter number. Maybe some data
    // was added above our rendered range?
    useLayoutEffectWithoutServerSideWarning(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state;

        const view = assertExists(viewRef.current);
        updateRowNumberCounter(view.getRenderedRange());
    }, [state, updateRowNumberCounter, viewRef]);

    /* ========================================================================== *\
     *                                Data Loading                                *
    \* ========================================================================== */

    const tryLoadingMoreData = useEvent(
        (renderedRange: {startIndex: number; endIndex: number} | null) => {
            if (!renderedRange) return;

            // If we have an empty query then there's no data to load.
            if (!rootQuery) return;

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

                let hasResetRowNumberCounter = false;

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
                    } else if (item.parents.length === 0) {
                        // Reset the row number counter to start with the first row in our
                        // rendered range.
                        if (!hasResetRowNumberCounter) {
                            hasResetRowNumberCounter = true;

                            // NOTE(calebmer): It's important that we set this style on the virtualized
                            // view's `contentElement` and not the `viewElement`! This is because
                            // `useScrollbar()` listens for mutations on scrollable elements and will
                            // measure the height to see if the scrollbar needs to be adjusted. Measuring
                            // height triggers a browser layout. Browser layouts are expensive so we avoid
                            // triggering a browser layout by updating the content element instead.
                            assertExists(
                                viewRef.current,
                            ).getContentElement().style.counterReset = `${
                                tasksStyles.rowNumberCounterName
                            } ${item.query.getLoadedTaskIndex(item.cursor)}`;
                        }
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

    /* ========================================================================== *\
     *                                   Events                                   *
    \* ========================================================================== */

    const events: TaskGridViewVirtualizedListEvents = useEvents({
        getMoveTaskToRootQueryActions,
        getMaybeRemoveTaskFromRootQueryActions,

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

            const taskKey = getTaskGridViewTaskKey(item);

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

        focusFirstVisibleTaskTitleStart: () => {
            const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
            if (!firstVisibleTaskRow) return;

            // If the first visible task title is already focused then we want to scroll
            // one page up and focus the first task after scrolling.
            if (firstVisibleTaskRow.isFocusWithin()) {
                runPromiseWithoutAwaiting(async () => {
                    const firstVisibleTaskRow = await events.scrollFirstVisiblePageUpTaskIntoView();
                    firstVisibleTaskRow?.focusTitleStart();
                });
            } else {
                firstVisibleTaskRow.focusTitleStart();
            }
        },

        focusFirstVisibleTaskCell: (column: TaskGridViewColumn) => {
            const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
            if (!firstVisibleTaskRow) return;

            // If the first visible task title is already focused then we want to scroll
            // one page up and focus the first task after scrolling.
            if (firstVisibleTaskRow.isFocusWithin()) {
                runPromiseWithoutAwaiting(async () => {
                    const firstVisibleTaskRow = await events.scrollFirstVisiblePageUpTaskIntoView();
                    firstVisibleTaskRow?.focusCell(column);
                });
            } else {
                firstVisibleTaskRow.focusCell(column);
            }
        },

        getFirstVisibleTaskRowIfExists: (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            // If we have a column header then it sticks to the top of the view. We want to
            // find a visible task row that's not occluded by our sticky column header.
            const columnHeaderPosition = view.getPositionByKeyIfExists("ColumnHeader");

            const effectiveHeight = view.getHeight() - (columnHeaderPosition?.height ?? 0);
            const effectiveScrollOffset =
                view.getScrollOffset() + (columnHeaderPosition?.height ?? 0);

            for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
                const position = view.getPositionByIndex(index);

                // Look for the first visible item in the scroll window...
                if (
                    position.offset < effectiveScrollOffset ||
                    position.offset + position.height > effectiveScrollOffset + effectiveHeight
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

        scrollFirstVisiblePageUpTaskIntoView: (): Promise<TaskRowViewRef | null> => {
            const view = assertExists(viewRef.current);

            // If we have a column header then it sticks to the top of the view. We want to
            // find a visible task row that's not occluded by our sticky column header.
            const columnHeaderPosition = view.getPositionByKeyIfExists("ColumnHeader");

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            const effectiveHeight = height - (columnHeaderPosition?.height ?? 0);

            const newScrollOffset = Math.max(
                0,
                scrollOffset -
                    (effectiveHeight -
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

            if (!expectedRenderedRange) return Promise.resolve(null);

            if (isDeepEqual(renderedRange, expectedRenderedRange)) {
                const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
                return Promise.resolve(firstVisibleTaskRow);
            } else {
                return new Promise(resolve => {
                    // Wait for `<VirtualizedScrollView>` to re-render. We expect
                    // `<VirtualizedScrollView>` will re-render within the frame we call
                    // `setScrollOffset()`.
                    //
                    // If `<VirtualizedScrollView>` has not re-rendered we'll get the wrong task.
                    requestAnimationFrame(() => {
                        const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
                        resolve(firstVisibleTaskRow);
                    });
                });
            }
        },

        focusLastVisibleTaskTitleEnd: () => {
            const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
            if (!lastVisibleTaskRow) return;

            // If the last visible task title is already focused then we want to scroll
            // one page down and focus the last task after scrolling.
            if (lastVisibleTaskRow.isFocusWithin()) {
                runPromiseWithoutAwaiting(async () => {
                    const lastVisibleTaskRow = await events.scrollLastVisiblePageDownTaskIntoView();
                    lastVisibleTaskRow?.focusTitleEnd();
                });
            } else {
                lastVisibleTaskRow.focusTitleEnd();
            }
        },

        focusLastVisibleTaskCell: (column: TaskGridViewColumn) => {
            const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
            if (!lastVisibleTaskRow) return;

            // If the last visible task title is already focused then we want to scroll
            // one page down and focus the last task after scrolling.
            if (lastVisibleTaskRow.isFocusWithin()) {
                runPromiseWithoutAwaiting(async () => {
                    const lastVisibleTaskRow = await events.scrollLastVisiblePageDownTaskIntoView();
                    lastVisibleTaskRow?.focusCell(column);
                });
            } else {
                lastVisibleTaskRow.focusCell(column);
            }
        },

        getLastVisibleTaskRowIfExists: (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            // If we have a column header then it sticks to the top of the view. We want to
            // find a visible task row that's not occluded by our sticky column header.
            const columnHeaderPosition = view.getPositionByKeyIfExists("ColumnHeader");

            const effectiveHeight = view.getHeight() - (columnHeaderPosition?.height ?? 0);
            const effectiveScrollOffset =
                view.getScrollOffset() + (columnHeaderPosition?.height ?? 0);

            for (let index = renderedRange.endIndex; index >= renderedRange.startIndex; index--) {
                const position = view.getPositionByIndex(index);

                // Look for the last visible item in the scroll window...
                if (
                    position.offset < effectiveScrollOffset ||
                    position.offset + position.height > effectiveScrollOffset + effectiveHeight
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

        scrollLastVisiblePageDownTaskIntoView: (): Promise<TaskRowViewRef | null> => {
            const view = assertExists(viewRef.current);

            // If we have a column header then it sticks to the top of the view. We want to
            // find a visible task row that's not occluded by our sticky column header.
            const columnHeaderPosition = view.getPositionByKeyIfExists("ColumnHeader");

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            const effectiveHeight = height - (columnHeaderPosition?.height ?? 0);

            const newScrollOffset = Math.min(
                view.getContentHeight() - height,
                scrollOffset +
                    (effectiveHeight -
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

            if (!expectedRenderedRange) return Promise.resolve(null);

            if (isDeepEqual(renderedRange, expectedRenderedRange)) {
                const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
                return Promise.resolve(lastVisibleTaskRow);
            } else {
                return new Promise(resolve => {
                    // Wait for `<VirtualizedScrollView>` to re-render. We expect
                    // `<VirtualizedScrollView>` will re-render within the frame we call
                    // `setScrollOffset()`.
                    //
                    // If `<VirtualizedScrollView>` has not re-rendered we'll get the wrong task.
                    requestAnimationFrame(() => {
                        const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
                        resolve(lastVisibleTaskRow);
                    });
                });
            }
        },

        setTaskRowZIndex: (taskKey: TaskGridViewTaskKey, newZIndex: number) => {
            const itemElement = viewRef.current?.getItemElementByKeyIfExists(`Task:${taskKey}`);
            if (!itemElement) return noop;

            const setZIndex = (zIndex: number | null) => {
                if (zIndex === null) {
                    itemElement.style.removeProperty("z-index");
                } else {
                    itemElement.style.zIndex = String(zIndex);
                }
            };

            const oldZIndexString = itemElement.style.zIndex;
            const oldZIndex = oldZIndexString ? parseInt(oldZIndexString, 10) : null;

            setZIndex(newZIndex);

            return () => {
                setZIndex(oldZIndex);
            };
        },
    });

    /* ========================================================================== *\
     *                              Animation State                               *
    \* ========================================================================== */

    const [animationState, setAnimationState] = useState<{
        readonly state: TaskGridViewVirtualizedListState;
        readonly animations: ReadonlyArray<TaskGridViewVirtualizedListAnimation>;
    }>({
        state,
        animations: emptyArray,
    });

    // If our state changed then compute any animations from the state change and
    // update our state so we can start rendering these animations.
    if (animationState.state !== state) {
        const animations = state.getAnimations(animationState.state);

        let newAnimations: Array<TaskGridViewVirtualizedListAnimation> | null = null;

        if (!disableAllTaskGridViewAnimations) {
            for (const animation of animations) {
                if (!disableTaskGridViewAnimationsForTaskIds.has(animation.taskId)) {
                    newAnimations ??= [...animationState.animations];
                    newAnimations.push(animation);
                }
            }
        }

        setAnimationState({
            state,
            animations: newAnimations ?? animationState.animations,
        });
    }

    // Cleanup animations from our state when they finish.
    useEffect(() => {
        const currentTime = Date.now();
        let minDuration = Infinity;

        for (const animation of animationState.animations) {
            const endTime = animation.startTime + animation.duration;

            minDuration = Math.min(minDuration, endTime - currentTime);
        }

        const cleanup = () => {
            setAnimationState(animationState => {
                const currentTime = Date.now();

                const newAnimations: Array<TaskGridViewVirtualizedListAnimation> = [];

                for (const animation of animationState.animations) {
                    const endTime = animation.startTime + animation.duration;

                    if (endTime > currentTime) {
                        newAnimations.push(animation);
                    }
                }

                // Optimization: No animations expired. We can avoid a re-render.
                if (newAnimations.length === animationState.animations.length) {
                    return animationState;
                }

                return {
                    state: animationState.state,
                    animations: newAnimations,
                };
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
    }, [animationState.animations]);

    const cancelAnimationRef = useRef<(() => void) | null>(null);

    const updateAnimations = useCallback(() => {
        if (animationState.animations.length === 0) return null;

        const view = assertExists(viewRef.current);

        const renderedRange = view.getRenderedRange();
        if (!renderedRange) return null;

        const currentTime = Date.now();
        const actualAnimations = new Set<AnimationControls>();

        // Loop through every rendered item checking if it needs to be animated.
        for (let i = renderedRange.startIndex; i <= renderedRange.endIndex; i++) {
            const item =
                itemCountBeforeState <= i && i < itemCountBeforeState + stateItemCount
                    ? state.getItem(i - itemCountBeforeState)
                    : null;

            let movements: LinkedList<Movement> = null;

            // Total up the distance this task needs to move from all ongoing animations.
            // The row may be affected by multiple animations at once.
            for (const animation of animationState.animations) {
                switch (animation.type) {
                    case "Create": {
                        const isAfterNewItem =
                            (item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.newItem,
                                    item,
                                )) ||
                            i >= itemCountBeforeState + stateItemCount;

                        if (!isAfterNewItem) continue;

                        const endTime = animation.startTime + animation.duration;
                        const remainingDuration = endTime - currentTime;

                        if (remainingDuration <= 0) continue;

                        // TODO(calebmer): Ideally we'd get access to the new item's actual
                        // height since the height is not a constant in task detail view.
                        const distance = -(
                            (1 + animation.newChildrenCount) *
                            convertRemLengthToPx(
                                spacing[taskRowViewMinHeight],
                                getRemPxWithoutListening(),
                            )
                        );

                        const remainingDistance =
                            distance * (remainingDuration / animation.duration);

                        movements = addMovement(movements, {
                            distance: remainingDistance,
                            duration: remainingDuration,
                        });
                        break;
                    }
                    // TODO(calebmer): Ideally we keep rendering the old task as we slide tasks
                    // below on top of it. Instead of immediately un-rendering the task.
                    case "Delete": {
                        const isAfterOldItem =
                            (item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.oldItem,
                                    item,
                                )) ||
                            i >= itemCountBeforeState + stateItemCount;

                        if (!isAfterOldItem) continue;

                        const endTime = animation.startTime + animation.duration;
                        const remainingDuration = endTime - currentTime;

                        if (remainingDuration <= 0) continue;

                        // TODO(calebmer): Ideally we'd somehow get access to the old item's actual
                        // height since the height is not a constant in task detail view.
                        const distance =
                            (1 + animation.oldChildrenCount) *
                            convertRemLengthToPx(
                                spacing[taskRowViewMinHeight],
                                getRemPxWithoutListening(),
                            );

                        const remainingDistance =
                            distance * (remainingDuration / animation.duration);

                        movements = addMovement(movements, {
                            distance: remainingDistance,
                            duration: remainingDuration,
                        });
                        break;
                    }
                    // TODO(calebmer): Currently during the move animation we immediately render the
                    // task at its new location and the tasks in between slide over the task that's
                    // moving. This animation is bad for small 1 or 2 position moves since it looks
                    // like the wrong task is moving. Ideally we'd animate the task from its old
                    // position to the new position on top of the sliding tasks underneath.
                    //
                    // For large moves (5+ tasks in between) what we currently have may be the
                    // better animation since the moving task would have to fly at insane speeds.
                    case "Move": {
                        const isAfterOldItem =
                            (item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.oldItem,
                                    item,
                                )) ||
                            i >= itemCountBeforeState + stateItemCount;

                        const isAfterNewItem =
                            (item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.newItem,
                                    item,
                                )) ||
                            i >= itemCountBeforeState + stateItemCount;

                        const isNewItem =
                            item?.type === "Task" &&
                            item.parents === animation.newItem.parents &&
                            item.cursor === animation.newItem.cursor;

                        const isWithinItemMove =
                            animation.direction === "Up"
                                ? !isNewItem && isAfterNewItem && !isAfterOldItem
                                : !isNewItem && !isAfterNewItem && isAfterOldItem;

                        if (!isWithinItemMove) continue;

                        const endTime = animation.startTime + animation.duration;
                        const remainingDuration = endTime - currentTime;

                        if (remainingDuration <= 0) continue;

                        // TODO(calebmer): Ideally we'd somehow get access to the old item's actual
                        // height since the height is not a constant in task detail view.
                        const distance = convertRemLengthToPx(
                            spacing[taskRowViewMinHeight],
                            getRemPxWithoutListening(),
                        );

                        const remainingDistance =
                            distance *
                            (remainingDuration / animation.duration) *
                            (animation.direction === "Down" ? 1 : -1);

                        movements = addMovement(movements, {
                            distance: remainingDistance,
                            duration: remainingDuration,
                        });
                        break;
                    }
                    default:
                        exhaustive(animation);
                }
            }

            if (movements === null) continue;

            const key = view.getKeyByIndexIfExists(i);
            const element = key ? view.getItemElementByKeyIfExists(key) : null;

            if (!element) continue;

            const {keyframes, offset, duration} = convertMovementsToKeyframes(movements);

            const actualAnimation = animate(
                element,
                {
                    y: keyframes,
                },
                {
                    offset,
                    duration,
                    // Since we interrupt this animation and start a new one as our animation
                    // state changes, linear easing helps the animation appear continuous.
                    //
                    // TODO(calebmer): A non-linear easing may look better here. But we have to take
                    // care to making it non-interruptible which seems challenging. If multiple
                    // animations overlap, does a non-linear easing look janky since we restart the
                    // curve whenever there's a new animation?
                    easing: "linear",
                },
            );

            actualAnimations.add(actualAnimation);
        }

        return () => {
            for (const actualAnimation of actualAnimations) {
                actualAnimation.cancel();
            }
        };
    }, [animationState.animations, itemCountBeforeState, state, stateItemCount, viewRef]);

    useLayoutEffectWithoutServerSideWarning(() => {
        cancelAnimationRef.current?.();
        cancelAnimationRef.current = updateAnimations();
        return () => {
            cancelAnimationRef.current?.();
            cancelAnimationRef.current = null;
        };
    }, [updateAnimations]);

    // Make sure when animating created/moved tasks that the task being
    // created/moved renders under moving tasks.
    useLayoutEffectWithoutServerSideWarning(() => {
        const unsetZIndexes: Array<() => void> = [];

        for (const animation of animationState.animations) {
            if (animation.type === "Create" || animation.type === "Move") {
                unsetZIndexes.push(
                    events.setTaskRowZIndex(getTaskGridViewTaskKey(animation.newItem), -10),
                );
            }
        }

        return () => {
            for (const unsetZIndex of unsetZIndexes) {
                unsetZIndex();
            }
        };
    }, [animationState.animations, events]);

    /* ========================================================================== *\
     *                               Item Rendering                               *
    \* ========================================================================== */

    const columnHeaderControlsWithMinHeightPx = useMemo(
        () =>
            columnHeaderControls
                ? {
                      minHeight:
                          typeof columnHeaderControls.minHeight === "string"
                              ? convertRemLengthToPx(columnHeaderControls.minHeight, remPx)
                              : columnHeaderControls.minHeight,
                      node: columnHeaderControls.node,
                  }
                : null,
        [columnHeaderControls, remPx],
    );

    const renderItem = useMemo(() => {
        return (itemIndex: number): VirtualizedScrollViewItem => {
            // If this item is above our task list then render it.
            if (itemIndex < itemCountBeforeState) {
                const withColumnHeaderExtraScrollSpacePx =
                    withColumnHeaderExtraScrollSpace === "0"
                        ? 0
                        : withColumnHeaderExtraScrollSpace === "px"
                        ? 1
                        : convertRemLengthToPx(spacing[withColumnHeaderExtraScrollSpace], remPx);

                const minHeight =
                    withColumnHeaderExtraScrollSpacePx +
                    (columnHeaderControlsWithMinHeightPx?.minHeight ?? 0) +
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
                            ref={ref}
                            withColumnHeaderBorderTop={withColumnHeaderBorderTop}
                            withColumnHeaderExtraScrollSpace={withColumnHeaderExtraScrollSpacePx}
                            columnHeaderControls={columnHeaderControlsWithMinHeightPx}
                            minHeight={minHeight}
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

                // No ghost task if `rootQuery` is null.
                if (rootQuery) {
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
                                        isRootQueryManuallySorted={isRootQueryManuallySorted}
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
                                        getAreChildTasksExpandedStore={
                                            getAreChildTasksExpandedStore
                                        }
                                        toggleAreChildTasksExpanded={toggleAreChildTasksExpanded}
                                        setTaskDeleteConfirmationState={
                                            setTaskDeleteConfirmationState
                                        }
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
                }

                return {
                    key: `DecorativeGhostTask:${relativeItemIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewDecorativeGhostTaskMemo
                            capabilities={capabilities}
                            isRootQueryNull={isRootQueryNull}
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
                const taskKey = getTaskGridViewTaskKey(item);

                return {
                    key: `Task:${taskKey}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    withManualLayout: true,
                    render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                        disableExpensiveFeaturesDuringScroll => (
                            <TaskRowViewMemo
                                context={context}
                                capabilities={capabilities}
                                // If we have a task item then that must mean we have a query.
                                rootQuery={rootQuery!}
                                isRootQueryManuallySorted={isRootQueryManuallySorted}
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
        columnHeaderControlsWithMinHeightPx,
        context,
        events,
        getAreChildTasksExpandedStore,
        isRootQueryManuallySorted,
        isRootQueryNull,
        itemCount,
        itemCountBeforeState,
        loadedState,
        remPx,
        rootQuery,
        state,
        stateItemCount,
        toggleAreChildTasksExpanded,
        viewRef,
        withColumnHeaderBorderTop,
        withColumnHeaderExtraScrollSpace,
    ]);

    return {
        itemCount,
        renderItem,
        onRenderedRangeChange: tryLoadingMoreData,
        onRenderedRangeLayoutChange: (
            renderedRange: {startIndex: number; endIndex: number} | null,
        ) => {
            // `viewRef` may not have been initialized yet.
            if (!viewRef.current) return;

            cancelAnimationRef.current?.();
            cancelAnimationRef.current = updateAnimations();

            updateRowNumberCounter(renderedRange);
        },
        alwaysRenderAdditionalItemIndexes: useMemo(
            () => (capabilities.hasColumns ? [0] : emptyArray),
            [capabilities.hasColumns],
        ),
        insetScrollbarItemIndex: capabilities.hasColumns ? 0 : undefined,
        modals: taskDeleteConfirmationState && rootQuery && (
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
    readonly focusFirstVisibleTaskCell: (column: TaskGridViewColumn) => void;
    readonly scrollFirstVisiblePageUpTaskIntoView: () => Promise<TaskRowViewRef | null>;
    readonly getLastVisibleTaskRowIfExists: () => TaskRowViewRef | null;
    readonly focusLastVisibleTaskTitleEnd: () => void;
    readonly focusLastVisibleTaskCell: (column: TaskGridViewColumn) => void;
    readonly scrollLastVisiblePageDownTaskIntoView: () => Promise<TaskRowViewRef | null>;
    readonly setTaskRowZIndex: (taskKey: TaskGridViewTaskKey, zIndex: number) => () => void;
}>;

const TaskGridViewColumnHeaderMemo = memo(forwardRef(TaskGridViewColumnHeader));

function TaskGridViewColumnHeader(
    {
        withColumnHeaderBorderTop,
        withColumnHeaderExtraScrollSpace,
        columnHeaderControls,
        minHeight,
        offset,
        height,
        shouldRenderWithRelativePositioning,
    }: {
        withColumnHeaderBorderTop: boolean;
        withColumnHeaderExtraScrollSpace: number;
        columnHeaderControls: Memo<{minHeight: number; node: ReactNode}> | null;
        minHeight: number;
        offset: number;
        height: number;
        shouldRenderWithRelativePositioning: boolean;
    },
    virtualizedItemRef: Ref<HTMLDivElement>,
) {
    return (
        <>
            {shouldRenderWithRelativePositioning ? (
                <Box
                    position="absolute"
                    inset="0"
                    // Render above overlays which are at `zIndex="50"`
                    zIndex="80"
                    pointerEvents="none"
                >
                    <Box position="sticky" top="0" left="0" right="0" borderBottom="grey-10" />
                </Box>
            ) : (
                <>
                    {offset + withColumnHeaderExtraScrollSpace > 0 && withColumnHeaderBorderTop && (
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
                            style={{height: offset + withColumnHeaderExtraScrollSpace}}
                            // Render above overlays which are at `zIndex="50"`
                            zIndex="80"
                            pointerEvents="none"
                        >
                            <Box
                                position="sticky"
                                top="0"
                                left="0"
                                right="0"
                                borderBottom="grey-10"
                            />
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
                            style={{top: offset - 1 + withColumnHeaderExtraScrollSpace}}
                            // Render above overlays which are at `zIndex="50"`
                            zIndex="60"
                            pointerEvents="none"
                        >
                            <Box
                                position="sticky"
                                top="0"
                                left="0"
                                right="0"
                                borderBottom="grey-5"
                            />
                        </Box>
                    )}
                    {withColumnHeaderBorderTop && (
                        // `grey-0` top border that hides `<TaskLayoutTopBar>` border when column
                        // header doesn't overlay tasks that scrolls out-of-bounds once column
                        // header does overlay tasks.
                        <Box
                            position="absolute"
                            left="0"
                            right="0"
                            style={{top: offset - 1 + withColumnHeaderExtraScrollSpace}}
                            // Render above overlays which are at `zIndex="50"`
                            zIndex="70"
                            pointerEvents="none"
                            borderBottom="grey-0"
                        />
                    )}
                    <Box
                        // `grey-10` bottom border of column header that slides in when the column
                        // header overlays tasks.
                        position="absolute"
                        left="0"
                        right="0"
                        bottom="0"
                        style={{top: offset + height - 3}}
                        // Render above overlays which are at `zIndex="50"`
                        zIndex="70"
                        pointerEvents="none"
                    >
                        <Box
                            position="sticky"
                            left="0"
                            right="0"
                            borderBottom="grey-10"
                            style={{top: height - 2 - withColumnHeaderExtraScrollSpace}}
                        />
                    </Box>
                </>
            )}
            <Box
                style={{
                    minHeight,
                    ...(shouldRenderWithRelativePositioning
                        ? {position: "relative"}
                        : {
                              position: "absolute",
                              top: offset + withColumnHeaderExtraScrollSpace,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              marginTop: -withColumnHeaderExtraScrollSpace,
                          }),
                }}
                // Render above overlays which are at `zIndex="50"`
                zIndex={!shouldRenderWithRelativePositioning ? "80" : undefined}
                pointerEvents="none"
            >
                <Box
                    ref={virtualizedItemRef}
                    // Our header is not sticky when rendered with relative positioning.
                    position={!shouldRenderWithRelativePositioning ? "sticky" : "relative"}
                    pointerEvents="auto"
                    style={{
                        top: !shouldRenderWithRelativePositioning
                            ? -withColumnHeaderExtraScrollSpace
                            : undefined,
                        paddingTop: withColumnHeaderExtraScrollSpace,
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
                        style={{
                            top: 1 + withColumnHeaderExtraScrollSpace,
                            // Render background color with an absolute positioned `<div>` so we don't
                            // cover the border rendered by `<TaskRowView>` (or our separate sticky div).
                            bottom: 2,
                        }}
                        backgroundColor="grey-0"
                    />
                    <OverlayScopeContextProvider
                    // Provide an overlay scope within our sticky element which has a `zIndex` that
                    // renders over overlays.
                    >
                        {columnHeaderControls && (
                            <Box style={{minHeight: columnHeaderControls.minHeight}}>
                                {columnHeaderControls.node}
                            </Box>
                        )}
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
                    </OverlayScopeContextProvider>
                </Box>
            </Box>
        </>
    );
}

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
    isRootQueryNull,
    relativeItemIndex,
    isLastItem,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    isRootQueryNull: boolean;
    relativeItemIndex: number;
    isLastItem: boolean;
    focusPreviousTaskTitleEnd: Memo<(key: string) => void>;
    focusPreviousTaskTitleAll: Memo<(key: string) => void>;
}) {
    const isInert = capabilities.isReadOnly || isRootQueryNull;

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
            cursor={!isInert ? "text" : undefined}
            {...useOutOfBoundsClickSelection({
                isDisabled: isInert,
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
    isRootQueryManuallySorted,
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
    isRootQueryManuallySorted: boolean;
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

    const isQueryManuallySorted = query !== rootQuery || isRootQueryManuallySorted;

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
        // Hitting tab to indent only makes sense if the query is manually sorted.
        if (!isQueryManuallySorted) return;

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
                disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

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
            // Hitting shift-tab to dedent only makes sense if the query is manually sorted.
            if (!isRootQueryManuallySorted) return;

            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

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

            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

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
            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

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
            isQueryManuallySorted={isQueryManuallySorted}
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
            focusFirstVisibleTaskCell={events.focusFirstVisibleTaskCell}
            focusLastVisibleTaskTitleEnd={events.focusLastVisibleTaskTitleEnd}
            focusLastVisibleTaskCell={events.focusLastVisibleTaskCell}
            setRowZIndex={useCallback(
                zIndex => events.setTaskRowZIndex(taskKey, zIndex),
                [events, taskKey],
            )}
        />
    );
});

function getTaskGridViewTaskKey({
    parents,
    cursor,
}: {
    parents: ReadonlyArray<{cursor: TaskQuerySortCursor}>;
    cursor: TaskQuerySortCursor;
}): TaskGridViewTaskKey {
    const taskId = getTaskQuerySortCursorTaskId(cursor);

    return parents.length > 0
        ? `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${taskId}`
        : taskId;
}

type Movement = {
    readonly distance: number;
    readonly duration: number;
};

/**
 * Used for animating task movements. When a task moves it moves linearly a
 * certain distance over a certain duration. Then multiple movements may be
 * layered on top of each other. For instance when you close two tasks in rapid
 * succession.
 *
 * If a task is already moving and you need to apply a new movement then that
 * task needs to speed up to reach both its original destination and new
 * destination on time.
 *
 * When you call this function, you are adding to the total `distance` the task
 * needs to travel. However the final duration of this animation timeline will
 * be the max of all movement `duration`s.
 *
 * This function assumes `movement` starts at the same time as `oldMovements`.
 */
function addMovement(oldMovements: LinkedList<Movement>, movement: Movement): LinkedList<Movement> {
    if (movement.duration <= 0) return oldMovements;
    if (oldMovements === null) return {value: movement, next: null};

    const oldMovement = oldMovements.value;

    if (movement.duration < oldMovement.duration) {
        const oldMovementDistance1 =
            oldMovement.distance * (movement.duration / oldMovement.duration);

        const newMovement1 = {
            distance: movement.distance + oldMovementDistance1,
            duration: movement.duration,
        };

        const newMovement2 = {
            distance: oldMovement.distance - oldMovementDistance1,
            duration: oldMovement.duration - movement.duration,
        };

        return {value: newMovement1, next: {value: newMovement2, next: oldMovements.next}};
    } else {
        const movementDistance1 = movement.distance * (oldMovement.duration / movement.duration);

        const newMovement1 = {
            distance: oldMovement.distance + movementDistance1,
            duration: oldMovement.duration,
        };

        const newMovement2 = {
            distance: movement.distance - movementDistance1,
            duration: movement.duration - oldMovement.duration,
        };

        return {value: newMovement1, next: addMovement(oldMovements.next, newMovement2)};
    }
}

/**
 * Convert a list of movements to keyframes for the `motion` package that power our
 * task movement animation.
 */
function convertMovementsToKeyframes(movements: LinkedList<Movement>) {
    let totalDistance = 0;
    let totalDuration = 0;

    let workingMovements = movements;
    while (workingMovements !== null) {
        totalDistance += workingMovements.value.distance;
        totalDuration += workingMovements.value.duration;
        workingMovements = workingMovements.next;
    }

    const keyframes = [totalDistance];
    const offset = [0];

    let workingDistance = 0;
    let workingDuration = 0;
    workingMovements = movements;
    while (workingMovements !== null) {
        workingDistance += workingMovements.value.distance;
        workingDuration += workingMovements.value.duration;
        keyframes.push(totalDistance - workingDistance);
        offset.push(workingDuration / totalDuration);
        workingMovements = workingMovements.next;
    }

    return {
        keyframes,
        offset,
        duration: totalDuration / 1000,
    };
}
