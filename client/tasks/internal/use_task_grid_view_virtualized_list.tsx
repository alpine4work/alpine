import {useDndContext} from "@dnd-kit/core";
import {setInteractionModality} from "@react-aria/interactions";
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
import * as Y from "yjs";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {isMac} from "~/client/helpers/browser/is_mac.js";
import {MemoObject, useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {findTaskIndexInGridViewVirtualizedListIfExists} from "~/client/tasks/internal/find_task_index_in_grid_view_virtualized_list_if_exists.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
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
import {useTaskGhostRowPlaceholderTutorial} from "~/client/tasks/internal/use_task_ghost_row_placeholder_tutorial.js";
import {useTaskGridViewExpansionState} from "~/client/tasks/internal/use_task_grid_view_expansion_state.js";
import {
    TaskUndoStackEntry,
    useTaskUndoStackState,
} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore, TaskClientStoreUndoManager} from "~/client/tasks/task_client_store.js";
import {useHasTaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
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
import {RemLength, addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
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
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {Id, generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, spinAnimationClassName, tasksStyles} from "~/shared/styles/styles.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

// TODO(calebmer): I need to write integration tests! Some tests to write:
//
// - Write a test for every `commitTaskActionTransaction()` call (make these
//   changes as a non-creator user)
// - Write a test for all navigation keyboard shortcuts
//   (including `PageUp`/`PageDown`)
// - Write a test for undoing every `commitTaskActionTransaction()` call
// - Write a test for undoing a task move to make sure it scrolls
// - Write a test undoing ghost task row changes
// - Undo action that hid task
// - Undo in virtualized scroll view
// - Undo across peek and content underneath
// - Type in task title, scroll it offscreen, scroll it back onscreen,
//   undo/redo
// - Undo in detail view fields
// - Delete by backspace (and undo?)
// - Write tests for drag-and-drop
// - Editing task row cells
// - Editing task detail view fields
// - Editing task detail view dense fields
// - Notepad page navigation (maintains on reload)
// - Task filters/sorts navigation (maintains on reload)
// - Ghost task cell editing
// - Ghost task dense field editing
// - Read-only deleted task detail
// - Read-only deleted task collection
// - Private/public collections and private parent tasks (update in realtime)

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
    scrollToIndex: (index: number, options: {withAnchor: boolean}) => void;
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

/**
 * Do these sorts represent a manually sorted query?
 */
export function isTaskQueryManuallySorted(sorts: ReadonlyArray<TaskQueryNormalizedSort>): boolean {
    if (sorts.length === 0) return false;
    const firstSort = sorts[0]!;
    return (
        firstSort.type === "ParentPosition" ||
        firstSort.type === "CollectionPosition" ||
        firstSort.type === "NotepadPagePosition" ||
        firstSort.type === "AssigneeActivePosition"
    );
}

let indiscriminatelyDisableAllTaskGridViewAnimations = false;
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
export function indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint() {
    indiscriminatelyDisableAllTaskGridViewAnimations = true;
    scheduleAfterNextBrowserPaint(() => {
        indiscriminatelyDisableAllTaskGridViewAnimations = false;
    });
}

const virtualizedScrollViewStateKeyByActiveQuery = new WeakMap<TaskClientQuery, Id>();

/**
 * Encapsulates the ability to render a virtualized list of tasks. You are
 * responsible for using ALL of the returned props in a
 * `<VirtualizedScrollView>` component. If you don't use one of the props in
 * the documented way your grid view may be broken.
 */
export function useTaskGridViewVirtualizedList({
    capabilities,
    store,
    query: rootQueryWithInitialState,
    viewRef,
    getMoveTaskToQueryActions: getMoveTaskToRootQueryActions,
    getMaybeRemoveTaskFromQueryActions: getMaybeRemoveTaskFromRootQueryActions,
    withColumnHeaderBorderTop = false,
    columnHeaderControls,
    onApplyUndoStackEntry,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
    store: TaskClientStore;
    query: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
        initialBottomGhostTaskId: TaskId;
    } | null;
    getMoveTaskToQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
    withColumnHeaderBorderTop?: boolean;
    columnHeaderControls?: Memo<{minHeight: RemLength | number; node: ReactNode}>;
    onApplyUndoStackEntry?: (options: {
        type: "Undo" | "Redo";
        entry: DistributiveOmit<TaskUndoStackEntry, "release">;
        target: {taskId: TaskId; column: TaskGridViewColumn};
        undoManager: TaskClientStoreUndoManager;
    }) => boolean;
}): {
    /**
     * Key that resets our virtualized scroll view's internal state. Should be
     * passed to `<VirtualizedScrollView>`.
     */
    stateKey: Key | undefined;

    /**
     * The height buffered for un-rendered items. Should be passed to
     * `<VirtualizedScrollView>`.
     */
    bufferedItemHeight: RemLength;

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
     * Handler to be called on global keyboard event. Handles undo (cmd-z) among
     * other shortcuts. Should be passed to a `<GlobalKeyDownEvent>` around the
     * `<VirtualizedScrollView>`.
     */
    onGlobalKeyDown: (event: KeyboardEvent) => void;

    /**
     * (Optional.) Focuses the start of the grid view.
     */
    focusStart: Memo<() => void>;

    /**
     * (Optional.) Focuses the end of the grid view.
     */
    focusEnd: Memo<() => void>;

    /**
     * (Optional.) Add an entry to the grid view's undo stack.
     */
    pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;

    /**
     * (Optional.) Add an entry to the grid view's undo stack.
     */
    pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;

    /**
     * (Optional.) Add an entry to the grid view's redo stack.
     */
    pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
} {
    const context = useAppContext();
    const remPx = useRemPx();

    assert(
        useHasTaskGridViewDndContext(),
        "Expected task grid view virtualized list to be rendered inside `<TaskGridViewDndContext>`",
    );

    const dndContext = useDndContext();
    const isDragging = !!dndContext.active;

    const [bottomGhostTaskId, setBottomGhostTaskId] = useStateWithDependencies(
        rootQueryWithInitialState?.initialBottomGhostTaskId ?? null,
        [rootQueryWithInitialState?.query],
    );

    const {
        getAreChildTasksExpandedStore,
        toggleAreChildTasksExpanded,
        iterateRootExpandedTaskIds,
        iterateExpandedTaskIdsUnderPath,
    } = useTaskGridViewExpansionState({
        query: rootQueryWithInitialState?.query ?? null,
        initialState: rootQueryWithInitialState?.initialGridViewExpansionState ?? null,
    });

    const rootQuery = rootQueryWithInitialState?.query ?? null;

    // Whenever our `activeQuery` changes we reset the `<VirtualizedScrollView>`'s
    // internal state (which also scrolls the view to the top). We do this
    // instead of:
    //
    // - Using a React `key` because that would remount all components which is
    //   expensive and some components will be shared (e.g. the column header)
    // - Calling `viewRef.current.setScrollOffset(0)` because there will be an
    //   intermediate render where `<VirtualizedScrollView>` renders the new query
    //   at the old scroll offset (potentially causing unnecessary data to load
    //   because we're rendering the "load more" item)
    //
    // This must be passed into `<VirtualizedScrollView>`'s `stateKey` prop.
    const stateKey = rootQuery
        ? getOrSetDefaultMapValue(virtualizedScrollViewStateKeyByActiveQuery, rootQuery, generateId)
        : undefined;

    const isRootQueryNull = rootQuery === null;
    const isRootQueryManuallySorted = isTaskQueryManuallySorted(rootQuery?.sorts ?? emptyArray);

    // Consider a null `rootQuery` as a fully loaded empty query.
    const loadedState = useStore(rootQuery?.loadedStateStore ?? null) ?? "FullyLoaded";

    const stateStore = useMemo(
        () => TaskGridViewVirtualizedListState.new(rootQuery, getAreChildTasksExpandedStore),
        [getAreChildTasksExpandedStore, rootQuery],
    );

    const state = useStore(stateStore);

    const stateItemCount = state.getItemCount();

    const hasColumnHeaderItem: boolean = capabilities.hasColumns || !!columnHeaderControls;
    const itemCountBeforeState = hasColumnHeaderItem ? 1 : 0;

    const hasBottomGhostTask =
        !capabilities.isReadOnly && isRootQueryManuallySorted && bottomGhostTaskId;

    const itemCount =
        itemCountBeforeState +
        (loadedState !== "FullyLoaded"
            ? stateItemCount + 1
            : Math.max(stateItemCount + (hasBottomGhostTask ? 1 : 0), 3));

    const taskRowByTaskKeyRef = useRef(new Map<TaskGridViewTaskKey, TaskRowViewRef>());

    /* ========================================================================== *\
     *                         Delete Confirmation State                          *
    \* ========================================================================== */

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        undoManager: TaskClientStoreUndoManager;
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
                        const childrenQuery = rootQuery.store.ensureAndRetainTaskChildrenQuery(
                            taskId,
                            {limit: getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening())},
                        );
                        retainedChildrenQueries.push(childrenQuery);

                        childrenQuery?.loadMoreTasks(
                            getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                        );

                        // In addition to loading the root task query, children queries for any of its
                        // expanded child tasks so they all pop in at the same time.
                        for (const {taskId: expandedChildTaskId} of iterateExpandedTaskIdsUnderPath(
                            [taskId],
                        )) {
                            const childrenQuery = rootQuery.store.ensureAndRetainTaskChildrenQuery(
                                expandedChildTaskId,
                                {
                                    limit: getTaskGridViewLoadQueryLimit(
                                        getClientInfoWithoutListening(),
                                    ),
                                },
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
     *                                 Undo/Redo                                  *
    \* ========================================================================== */

    // NOCOMMIT: Undo actions that move task out of view

    const {
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        popUndoStackEntry,
        popRedoStackEntry,
    } = useTaskUndoStackState({
        clock: store.clock,
        // Whenever the query changes we reset our undo stack. If the query changes
        // it's unlikely we'll find the tasks the user was previously operating on so
        // we can't scroll to them.
        stateKey,
    });

    const applyUndoStackEntry = (
        type: "Undo" | "Redo",
        entry: DistributiveOmit<TaskUndoStackEntry, "release">,
        {
            pushUndoStackEntry,
        }: {
            pushUndoStackEntry: TaskClientStoreUndoManager["pushUndoStackEntry"];
        },
    ) => {
        const view = assertExists(viewRef.current);

        if (!rootQuery) return false;

        const target: {taskId: TaskId; column: TaskGridViewColumn} | null =
            entry.type === "Actions"
                ? getTaskUndoActionsGridViewTargetIfExists(
                      store,
                      entry.undoActions.getWithOldTimes(),
                  )
                : {taskId: entry.taskId, column: "Title"};
        if (!target) return false;

        const undoManager: TaskClientStoreUndoManager = {pushUndoStackEntry};

        // If this function returns true then the undo stack entry was handled.
        if (onApplyUndoStackEntry?.({type, entry, target, undoManager})) {
            return true;
        }

        const startIndex = findTaskIndexInGridViewVirtualizedListIfExists({
            state,
            iterateRootExpandedTaskIds,
            rootParentTaskId: entry.rootParentTaskId,
            taskId: target.taskId,
        });

        // If we can't find the task in the grid view anymore then we won't undo these
        // actions because the user won't see the result. Unless the actions we're
        // undoing removed the task from our query. If that happened we know for sure
        // we won't find the task in our grid view. Undoing should bring the task back
        // to our grid view.
        //
        // Reasons why the task might no longer be in the grid view:
        //
        // - Some other user changed a field such that it was filtered out of the
        //   grid view.
        // - Some other user changed a field (or dragged to move the task) such that
        //   the task left our client's loaded range.
        // - The user collapsed the expanded task this task was a child of.
        //
        // However we should still be able to find the task if:
        //
        // - The user scrolled the virtualized list and the task was unmounted. The
        //   task should still exist in our state so we can scroll back to the right
        //   index.
        // - The user loaded some new tasks. This introduces new tasks and does not
        //   remove old ones.
        //
        // We feel this is a reasonable set of tradeoffs for picking which undo actions
        // we handle.
        if (
            !(entry.type === "Actions" && entry.removedFromQueries.has(rootQuery)) &&
            startIndex === null
        ) {
            return false;
        }

        switch (entry.type) {
            case "Actions": {
                rootQuery.store.commitTaskActionTransaction(
                    context,
                    entry.undoActions.get(store.clock),
                    {undoManager},
                );
                break;
            }
            case "YDoc": {
                if (type === "Undo") {
                    entry.yUndoManager.undo();
                } else {
                    entry.yUndoManager.redo();
                }
                break;
            }
            default:
                throw exhaustive(entry);
        }

        const endIndex = findTaskIndexInGridViewVirtualizedListIfExists({
            // `stateStore` will have updated after the commit above but `state` will still
            // be the old value.
            state: stateStore.getSnapshot(),
            iterateRootExpandedTaskIds,
            rootParentTaskId: entry.rootParentTaskId,
            taskId: target.taskId,
        });

        const focusCell = (index: number) => {
            const startTime = Date.now();

            // If the row is currently onscreen, great! We can focus immediately. However,
            // we may be scrolling to the row. We've found the most consistent way to focus
            // the row is to wait in a `requestAnimationFrame()` loop for the row to
            // appear. Checking after `onRenderedRangeLayoutChange` doesn't always work
            // since we've observed intermediate rendered range changes? This does depend
            // on the scroll render taking less than 1s. If it takes more than 1s we have
            // bigger problems. (Grid view rendering performance is unacceptably bad.)
            const attempt = () => {
                if (Date.now() - startTime > 1000) return;

                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (taskRow) {
                    // If focus is already within the cell then don't focus again.
                    if (!taskRow.isFocusWithinCell(target.column)) {
                        setInteractionModality("keyboard");
                        taskRow.focusCell(target.column);
                    }
                } else {
                    requestAnimationFrame(attempt);
                }
            };

            attempt();
        };

        if (startIndex === null) {
            if (endIndex === null) {
                // TODO(calebmer): We should probably show a toast or something here to let the
                // user know something happened even if nothing on screen changed. A simple
                // modal along the lines of "undo successful" is good.
            } else {
                onLayoutEffectCallbacksRef.current.push(() => {
                    const index = endIndex + itemCountBeforeState;
                    view.scrollToIndex(index, {withAnchor: false});
                    focusCell(index);
                });
            }
        }
        // If the task didn't move, scroll to it immediately. Otherwise wait for React
        // to re-render, then scroll. Since we want to the virtualized list won't know
        // our target task is at `endIndex` until after the React re-render.
        //
        // If we can't find the task after the update we scroll to the task's original
        // position in the hope that's helpful to the user. We don't expect `endIndex`
        // to be null outside of extreme edge cases! In order for the action's we're
        // undoing to be applied in the first place the task had to have been in the
        // query's loaded range. A query's loaded range never shrinks, it only grows.
        else if (endIndex === null || startIndex === endIndex) {
            const index = startIndex + itemCountBeforeState;
            view.scrollToIndex(index, {withAnchor: false});
            focusCell(index);
        } else {
            onLayoutEffectCallbacksRef.current.push(() => {
                const index = endIndex + itemCountBeforeState;
                view.scrollToIndex(index, {withAnchor: false});
                focusCell(index);
            });
        }

        return true;
    };

    const undo = () => {
        // Keep trying to undo until we find an entry we can apply.
        while (true) {
            const undoStackEntry = popUndoStackEntry();
            if (!undoStackEntry) break;

            if (
                applyUndoStackEntry("Undo", undoStackEntry, {
                    pushUndoStackEntry: entry => {
                        pushRedoStackEntry({
                            type: "Actions",
                            rootParentTaskId: undoStackEntry.rootParentTaskId,
                            undoActions: entry.undoActions,
                            removedFromQueries: entry.removedFromQueries,
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

            if (
                applyUndoStackEntry("Redo", undoStackEntry, {
                    pushUndoStackEntry: entry => {
                        pushUndoStackEntryFromRedo({
                            type: "Actions",
                            rootParentTaskId: undoStackEntry.rootParentTaskId,
                            undoActions: entry.undoActions,
                            removedFromQueries: entry.removedFromQueries,
                            release: entry.release,
                        });
                    },
                })
            ) {
                break;
            }
        }
    };

    // NOCOMMIT: Prioritize peeks when interacting with peek
    const onGlobalKeyDown = (event: KeyboardEvent) => {
        switch (event.key) {
            case "z": {
                if (isMac ? event.metaKey : event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (event.shiftKey) {
                        redo();
                    } else if ((isMac ? !event.ctrlKey : !event.metaKey) && !event.altKey) {
                        undo();
                    }
                    break;
                }
                break;
            }
            // https://en.wikipedia.org/wiki/Control-Y
            case "y": {
                if (isMac ? event.metaKey : event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (
                        (isMac ? !event.ctrlKey : !event.metaKey) &&
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

    const events: TaskGridViewVirtualizedListEvents = useEvents({
        getMoveTaskToRootQueryActions,
        getMaybeRemoveTaskFromRootQueryActions,

        getItemCount: () => itemCount,
        getState: () => state,
        getItemCountBeforeState: () => itemCountBeforeState,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,

        onGhostTaskCreated: () => {
            setBottomGhostTaskId(generateId<TaskId>());
        },

        getTaskRowByIndexIfExists: (index: number): TaskRowViewRef | null => {
            const stateIndex = index - itemCountBeforeState;

            const isIndexWithinState =
                stateItemCount > 0 && 0 <= stateIndex && stateIndex < stateItemCount;

            if (!isIndexWithinState) {
                if (
                    stateIndex === state.getItemCount() &&
                    loadedState === "FullyLoaded" &&
                    bottomGhostTaskId
                ) {
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

        if (!indiscriminatelyDisableAllTaskGridViewAnimations) {
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

                        const isChildOfNewItem =
                            item?.type === "Task" &&
                            item.parents.length >= animation.newItem.parents.length + 1 &&
                            item.parents
                                .slice(0, animation.newItem.parents.length + 1)
                                .every((parent, i) =>
                                    i < animation.newItem.parents.length
                                        ? parent.query === animation.newItem.parents[i]!.query &&
                                          parent.cursor === animation.newItem.parents[i]!.cursor
                                        : item.parents[i]!.query === animation.newItem.query &&
                                          item.parents[i]!.cursor === animation.newItem.cursor,
                                );

                        if (!isAfterNewItem || isChildOfNewItem) continue;

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

                        const isChildOfNewItem =
                            item?.type === "Task" &&
                            item.parents.length >= animation.newItem.parents.length + 1 &&
                            item.parents
                                .slice(0, animation.newItem.parents.length + 1)
                                .every((parent, i) =>
                                    i < animation.newItem.parents.length
                                        ? parent.query === animation.newItem.parents[i]!.query &&
                                          parent.cursor === animation.newItem.parents[i]!.cursor
                                        : item.parents[i]!.query === animation.newItem.query &&
                                          item.parents[i]!.cursor === animation.newItem.cursor,
                                );

                        const isWithinItemMove =
                            animation.direction === "Up"
                                ? !isNewItem &&
                                  isAfterNewItem &&
                                  !isAfterOldItem &&
                                  // If an item with some children is moving its children move with it. So we
                                  // don't need to animate the children.
                                  !isChildOfNewItem
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

    const {taskGhostRowPlaceholder} = useTaskGhostRowPlaceholderTutorial(stateItemCount);

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
                const minHeight =
                    (columnHeaderControlsWithMinHeightPx?.minHeight ?? 0) +
                    (capabilities.hasColumns ? convertRemLengthToPx("1.25rem", remPx) : 0) +
                    taskGridViewColumnHeaderExtraPaddingBottom;

                return {
                    key: "ColumnHeader",
                    minHeight,
                    withManualLayout: true,
                    render: ({ref, offset, height, shouldRenderWithRelativePositioning}) => (
                        <TaskGridViewColumnHeaderMemo
                            ref={ref}
                            viewRef={viewRef}
                            withColumnHeaderBorderTop={withColumnHeaderBorderTop}
                            hasColumns={capabilities.hasColumns}
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

                // No ghost task if `rootQuery` is null, the grid view is read-only, or we're
                // not manually sorted.
                if (rootQuery && hasBottomGhostTask) {
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
                                        stateKey={stateKey}
                                        rootQuery={rootQuery}
                                        isRootQueryManuallySorted={isRootQueryManuallySorted}
                                        query={rootQuery}
                                        taskKey={bottomGhostTaskId}
                                        cursor={null}
                                        ghostTaskId={bottomGhostTaskId}
                                        parents={emptyArray}
                                        // Don't disable expensive features while auto-scrolling during drag since one
                                        // of the expensive features this flag disables is droppable zones. The user
                                        // still needs to be able to reach droppable zones during a drag auto-scroll.
                                        disableExpensiveFeaturesDuringScroll={
                                            !isDragging && disableExpensiveFeaturesDuringScroll
                                        }
                                        isFirstRow={stateItemCount === 0}
                                        nextIndentation={0}
                                        titlePlaceholder={
                                            !capabilities.isReadOnly
                                                ? taskGhostRowPlaceholder ?? "Add a task…"
                                                : undefined
                                        }
                                        viewRef={viewRef}
                                        events={events}
                                        taskRowByTaskKeyRef={taskRowByTaskKeyRef}
                                        onLayoutEffectCallbacksRef={onLayoutEffectCallbacksRef}
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
                                stateKey={stateKey}
                                // If we have a task item then that must mean we have a query.
                                rootQuery={rootQuery!}
                                isRootQueryManuallySorted={isRootQueryManuallySorted}
                                query={item.query}
                                taskKey={taskKey}
                                cursor={item.cursor}
                                parents={item.parents}
                                // Don't disable expensive features while auto-scrolling during drag since one
                                // of the expensive features this flag disables is droppable zones. The user
                                // still needs to be able to reach droppable zones during a drag auto-scroll.
                                disableExpensiveFeaturesDuringScroll={
                                    !isDragging && disableExpensiveFeaturesDuringScroll
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
                                onLayoutEffectCallbacksRef={onLayoutEffectCallbacksRef}
                                getAreChildTasksExpandedStore={getAreChildTasksExpandedStore}
                                toggleAreChildTasksExpanded={toggleAreChildTasksExpanded}
                                setTaskDeleteConfirmationState={setTaskDeleteConfirmationState}
                                onTaskDeleteConfirmationModalDialogClosedCallbacksRef={
                                    onTaskDeleteConfirmationModalDialogClosedCallbacksRef
                                }
                                withPaddingBottom={itemIndex === itemCount - 1}
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
        hasBottomGhostTask,
        isDragging,
        isRootQueryManuallySorted,
        isRootQueryNull,
        itemCount,
        itemCountBeforeState,
        loadedState,
        remPx,
        rootQuery,
        state,
        stateItemCount,
        stateKey,
        taskGhostRowPlaceholder,
        toggleAreChildTasksExpanded,
        viewRef,
        withColumnHeaderBorderTop,
    ]);

    const onLayoutEffectCallbacksRef = useRef<Array<() => void>>([]);

    // This needs to run after all other effects in this component! Especially the
    // `useEvents()` hook so we get the right event functions.
    useLayoutEffectWithoutServerSideWarning(() => {
        const callbacks = onLayoutEffectCallbacksRef.current;
        onLayoutEffectCallbacksRef.current = [];

        for (const callback of callbacks) {
            callback();
        }
    });

    return {
        stateKey,
        bufferedItemHeight: spacing[taskRowViewMinHeight],
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
            () => (hasColumnHeaderItem ? [0] : emptyArray),
            [hasColumnHeaderItem],
        ),
        insetScrollbarItemIndex: hasColumnHeaderItem ? 0 : undefined,
        modals: taskDeleteConfirmationState && rootQuery && (
            <TaskDeleteConfirmationModalDialog
                store={rootQuery.store}
                undoManager={taskDeleteConfirmationState.undoManager}
                taskId={taskDeleteConfirmationState.taskId}
                onClose={() => setTaskDeleteConfirmationState(null)}
                onAfterDelete={taskDeleteConfirmationState.onAfterDelete}
            />
        ),
        onGlobalKeyDown,
        focusStart: events.focusStart,
        focusEnd: events.focusEnd,
        pushUndoStackEntry: events.pushUndoStackEntry,
        pushUndoStackEntryFromRedo: events.pushUndoStackEntryFromRedo,
        pushRedoStackEntry: events.pushRedoStackEntry,
    };
}

type TaskGridViewVirtualizedListEvents = MemoObject<{
    readonly getMoveTaskToRootQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    readonly getMaybeRemoveTaskFromRootQueryActions: (taskId: TaskId) => Array<TaskAction>;
    readonly getItemCount: () => number;
    readonly getState: () => TaskGridViewVirtualizedListState;
    readonly getItemCountBeforeState: () => number;
    readonly pushUndoStackEntry: (entry: TaskUndoStackEntry) => void;
    readonly pushUndoStackEntryFromRedo: (entry: TaskUndoStackEntry) => void;
    readonly pushRedoStackEntry: (entry: TaskUndoStackEntry) => void;
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

// It takes 2px to render the bottom borders on our column header. 1px for the
// border itself and 1px below that to avoid covering the first row's bottom
// border. We don't want to take those 2px from the column header's height so
// we need to add back some extra padding bottom height.
const taskGridViewColumnHeaderExtraPaddingBottom = 2;

const TaskGridViewColumnHeaderMemo = memo(forwardRef(TaskGridViewColumnHeader));

function TaskGridViewColumnHeader(
    {
        viewRef,
        withColumnHeaderBorderTop,
        hasColumns,
        columnHeaderControls,
        minHeight,
        offset,
        height,
        shouldRenderWithRelativePositioning,
    }: {
        viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
        withColumnHeaderBorderTop: boolean;
        hasColumns: boolean;
        columnHeaderControls: Memo<{minHeight: number; node: ReactNode}> | null;
        minHeight: number;
        offset: number;
        height: number;
        shouldRenderWithRelativePositioning: boolean;
    },
    virtualizedItemRef: Ref<HTMLDivElement>,
) {
    const columnHeaderContainerRef = useRef<HTMLDivElement>(null);
    const columnHeaderBorderTopRef = useRef<HTMLDivElement>(null);
    const columnHeaderBorderTopStickyRef = useRef<HTMLDivElement>(null);
    const columnHeaderBorderBottomRef = useRef<HTMLDivElement>(null);

    // Update the `z-index` on our column header when it's "stuck" so we can raise
    // the `z-index`.
    //
    // See [this StackOverflow question][1].
    //
    // [1]: https://stackoverflow.com/questions/25308823/targeting-positionsticky-elements-that-are-currently-in-a-stuck-state
    //
    // NOTE(calebmer, 2023-10-30): When I first built these sticky headers, I
    // wasn't aware of this `IntersectionObserver` technique for updating styles.
    // That may be a simpler way to implement the border style changes. However, I
    // don't know if `IntersectionObserver` is frame perfect! It's ok if `z-index`
    // updates aren't frame perfect but we really want border style changes to be
    // frame perfect. I know `position: sticky` is frame perfect so leaving that as
    // our border implementation for now.
    useEffect(() => {
        if (shouldRenderWithRelativePositioning) return;

        const viewContentElement = assertExists(viewRef.current).getContentElement();
        const columnHeaderContainerElement = assertExists(columnHeaderContainerRef.current);
        const columnHeaderBorderTopElement = assertExists(columnHeaderBorderTopRef.current);
        const columnHeaderBorderTopStickyElement = assertExists(
            columnHeaderBorderTopStickyRef.current,
        );
        const columnHeaderBorderBottomElement = assertExists(columnHeaderBorderBottomRef.current);

        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (
                        entry.target === columnHeaderBorderTopStickyElement &&
                        entry.intersectionRatio >= 1
                    ) {
                        columnHeaderContainerElement.style.zIndex = "30";
                        columnHeaderBorderTopElement.style.zIndex = "20";
                        columnHeaderBorderBottomElement.style.zIndex = "10";
                    } else {
                        // Render above overlays which are at `zIndex="50"`
                        columnHeaderContainerElement.style.zIndex = "90";
                        columnHeaderBorderTopElement.style.zIndex = "80";
                        columnHeaderBorderBottomElement.style.zIndex = "70";
                    }
                }
            },
            {
                root: viewContentElement.parentElement,
                rootMargin: "-1px 0px 0px 0px",
                threshold: [1],
            },
        );

        observer.observe(columnHeaderBorderTopStickyElement);

        return () => {
            observer.disconnect();
        };
    }, [shouldRenderWithRelativePositioning, viewRef]);

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
                            style={{height: offset + 1}}
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
                    <Box
                        ref={columnHeaderBorderTopRef}
                        // `grey-5` top border that replaces `<TaskLayoutTopBar>` border when column
                        // header overlays tasks to make it feel like column header is part of the
                        // same material as the header.
                        //
                        // Also covers the `grey-10` bottom border with `grey-0` when the column header
                        // is NOT overlaying tasks.
                        //
                        // When the column header "sticks" this element shifts 1px revealing its bottom
                        // border and replacing the top border.
                        position="absolute"
                        left="0"
                        right="0"
                        bottom="0"
                        style={{top: offset + 1}}
                        pointerEvents="none"
                        // Default to 20. Our `useEffect()` hook above will update the `z-index` when
                        // the column header is stuck.
                        zIndex="20"
                    >
                        <Box
                            ref={columnHeaderBorderTopStickyRef}
                            position="sticky"
                            left="0"
                            right="0"
                            backgroundColor="grey-0"
                            borderTop="grey-5"
                            style={{
                                top: 0,
                                height: height - 2,
                            }}
                        />
                    </Box>
                    <Box
                        ref={columnHeaderBorderBottomRef}
                        // `grey-10` bottom border that's shown when the column header is overlaying
                        // tasks. Will be hidden by the above element with a `grey-0` background until
                        // it shifts because our column header is now "stuck" to the top.
                        position="absolute"
                        left="0"
                        right="0"
                        bottom="0"
                        style={{top: offset + height - 2}}
                        pointerEvents="none"
                        // Default to 10. Our `useEffect()` hook above will update the `z-index` when
                        // the column header is stuck.
                        zIndex="10"
                    >
                        <Box
                            position="sticky"
                            left="0"
                            right="0"
                            borderBottom="grey-10"
                            style={{
                                top: height - 2,
                                height: 1,
                            }}
                        />
                    </Box>
                </>
            )}
            <Box
                ref={columnHeaderContainerRef}
                style={
                    shouldRenderWithRelativePositioning
                        ? {
                              position: "relative",
                              backgroundColor: "grey-0",
                          }
                        : {
                              position: "absolute",
                              top: offset,
                              left: 0,
                              right: 0,
                              bottom: 0,
                          }
                }
                pointerEvents="none"
                // Default to 30. Our `useEffect()` hook above will update the `z-index` when
                // the column header is stuck.
                zIndex="30"
            >
                <Box
                    ref={virtualizedItemRef}
                    // Our header is not sticky when rendered with relative positioning.
                    position={!shouldRenderWithRelativePositioning ? "sticky" : "relative"}
                    left="0"
                    right="0"
                    pointerEvents="auto"
                    style={{
                        top: !shouldRenderWithRelativePositioning ? 0 : undefined,
                        minHeight,
                        paddingBottom: taskGridViewColumnHeaderExtraPaddingBottom,
                    }}
                >
                    <Box
                        zIndex="-10"
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        style={{
                            top: withColumnHeaderBorderTop ? 1 : 0,
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
                        {hasColumns && (
                            <Box paddingTop="0.5" display="flex">
                                <Box
                                    flexShrink="0"
                                    width="32"
                                    paddingLeft="5"
                                    paddingBottom="1"
                                    color="grey-40"
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
                                    color="grey-40"
                                    fontSize="50"
                                >
                                    Assignee
                                </Box>
                                <Box
                                    flexShrink="0"
                                    width={taskRowViewColumnWidth}
                                    paddingX={taskRowViewColumnPaddingX}
                                    paddingBottom="1"
                                    color="grey-40"
                                    fontSize="50"
                                >
                                    Priority
                                </Box>
                                <Box
                                    flexShrink="0"
                                    width={taskRowViewColumnWidth}
                                    paddingX={taskRowViewColumnPaddingX}
                                    paddingBottom="1"
                                    color="grey-40"
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
                                    color="grey-40"
                                    fontSize="50"
                                >
                                    Collections
                                </Box>
                                <Box flexShrink="0" width="5" />
                            </Box>
                        )}
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
    stateKey,
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
    onLayoutEffectCallbacksRef,
    getAreChildTasksExpandedStore,
    toggleAreChildTasksExpanded,
    setTaskDeleteConfirmationState,
    onTaskDeleteConfirmationModalDialogClosedCallbacksRef,
    withoutPaddingLeft,
    withPaddingBottom,
}: {
    context: AppContext;
    capabilities: Memo<TaskGridViewCapabilities>;
    stateKey: Key | undefined;
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
    onLayoutEffectCallbacksRef: MutableRefObject<Array<() => void>>;
    getAreChildTasksExpandedStore: Memo<
        (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>
    >;
    toggleAreChildTasksExpanded: Memo<
        (taskPath: ReadonlyArray<TaskId>, options?: {onFinish?: () => void}) => void
    >;
    setTaskDeleteConfirmationState: Dispatch<
        SetStateAction<{
            undoManager: TaskClientStoreUndoManager;
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

    const taskId = taskPath ? taskPath[taskPath.length - 1]! : null;
    const rootParentTaskId = taskPath ? taskPath[0]! : null;

    const isQueryManuallySorted = query !== rootQuery || isRootQueryManuallySorted;

    const undoManager: TaskClientStoreUndoManager = useMemo(
        () => ({
            pushUndoStackEntry: ({undoActions, removedFromQueries, release}) => {
                events.pushUndoStackEntry({
                    type: "Actions",
                    rootParentTaskId: rootParentTaskId ?? assertExists(ghostTaskId),
                    undoActions,
                    removedFromQueries,
                    release,
                });
            },
        }),
        [events, ghostTaskId, rootParentTaskId],
    );

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

                const maybeRemoveActions =
                    query === rootQuery
                        ? events.getMaybeRemoveTaskFromRootQueryActions(taskId)
                        : [];

                rootQuery.store.commitTaskActionTransaction(
                    context,
                    [
                        {
                            type: "UpdateTask",
                            time: rootQuery.store.clock.now(),
                            taskId,
                            taskAction: {
                                type: "UpdateParentTaskId",
                                parentTaskId: previousTaskId,
                            },
                        },

                        // If we are indenting at the root of our query then we want to remove the task
                        // from the query root since it lives in its parent task now.
                        //
                        // Must come first since if we're removing a task from its parent then our
                        // following action needs to set the parent again.
                        //
                        // Order is important! We create these actions before `UpdateParentTaskId` so
                        // they have earlier timestamps but put them later in the array so our serial
                        // action authorization check doesn't remove our access to the task before
                        // `UpdateParentTaskId` which grants it back.
                        ...maybeRemoveActions,
                    ],
                    {undoManager},
                );

                onLayoutEffectCallbacksRef.current.push(() => {
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

            const removeAction: TaskAction = {
                type: "UpdateTask",
                time: rootQuery.store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: null,
                },
            };

            rootQuery.store.commitTaskActionTransaction(
                context,
                [
                    ...events.getMoveTaskToRootQueryActions(taskId, {
                        type: "Below",
                        taskId: oldParentTaskId,
                    }),

                    // Order is important! Removing the task from its parent may remove our access
                    // to the task resulting in an authorization error. Perform our update that puts
                    // us in the right spot first to make sure we maintain permission to access
                    // this task. But the timestamp on our remove action needs to be earlier in
                    // case of conflict.
                    removeAction,
                ],
                {undoManager},
            );
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

            rootQuery.store.commitTaskActionTransaction(
                context,
                [
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
                                ? getNewTaskPositionForQuerySortedByPosition(
                                      time2,
                                      newChildrenQuery,
                                      {
                                          type: "Below",
                                          taskId: oldParentTaskId,
                                      },
                                  )
                                : {
                                      orderTime: time2,
                                      orderKey: initialOrderKey,
                                  },
                        },
                    },
                ],
                {undoManager},
            );
        }

        // Store updates are rendered by React immediately. So focus our task before
        // the next paint.
        onLayoutEffectCallbacksRef.current.push(() => {
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

    const deleteTaskAndAllChildren = () => {
        if (!cursor) return;

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        setTaskDeleteConfirmationState({undoManager, taskId});
    };

    const deleteTaskAndAllChildrenAndFocusPreviousRow = () => {
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
                for (let index = itemIndex + 1; index < events.getItemCount(); index++) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleStart();
                    break;
                }
            }
        };

        // If a task has zero children then we delete it immediately without asking for
        // confirmation. We use `commitTaskActionTransaction()` since that
        // optimistically applies the delete action.
        //
        // There may be a race condition where the task has a child our client doesn't
        // know about yet. This child won't be deleted. This race condition is
        // acceptable.
        if (rootQuery.getLoadedTaskSnapshot(taskId).getChildTaskCount() === 0) {
            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

            rootQuery.store.commitTaskActionTransaction(
                context,
                [
                    {
                        type: "UpdateTask",
                        time: rootQuery.store.clock.now(),
                        taskId,
                        taskAction: {type: "Delete"},
                    },
                ],
                {undoManager},
            );

            focusPreviousRow(itemIndex);
        } else {
            setTaskDeleteConfirmationState({
                undoManager,
                taskId,
                onAfterDelete: () => {
                    const view = viewRef.current;
                    if (!view) return;

                    // Once React has closed the modal dialog, focus the previous task. Until the
                    // modal dialog is closed, focus is trapped inside it.
                    onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current.push(() =>
                        focusPreviousRow(itemIndex),
                    );
                },
            });
        }
    };

    const pushUndoStackYDocEntry = (entry: {yUndoManager: Y.UndoManager; release: () => void}) => {
        // We don't handle ghost tasks with this code path.
        if (!rootParentTaskId || !taskId) return;

        events.pushUndoStackEntry({
            type: "YDoc",
            rootParentTaskId,
            taskId,
            yUndoManager: entry.yUndoManager,
            release: entry.release,
        });
    };

    const pushUndoStackYDocEntryFromRedo = (entry: {
        yUndoManager: Y.UndoManager;
        release: () => void;
    }) => {
        // We don't handle ghost tasks with this code path.
        if (!rootParentTaskId || !taskId) return;

        events.pushUndoStackEntryFromRedo({
            type: "YDoc",
            rootParentTaskId,
            taskId,
            yUndoManager: entry.yUndoManager,
            release: entry.release,
        });
    };

    const pushRedoStackYDocEntry = (entry: {yUndoManager: Y.UndoManager; release: () => void}) => {
        // We don't handle ghost tasks with this code path.
        if (!rootParentTaskId || !taskId) return;

        events.pushRedoStackEntry({
            type: "YDoc",
            rootParentTaskId,
            taskId,
            yUndoManager: entry.yUndoManager,
            release: entry.release,
        });
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
            stateKey={stateKey}
            // It's important we use the `query` property from `item` since child tasks
            // come from a different query than our root query.
            query={query}
            isQueryManuallySorted={isQueryManuallySorted}
            undoManager={undoManager}
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
            pushUndoStackYDocEntry={pushUndoStackYDocEntry}
            pushUndoStackYDocEntryFromRedo={pushUndoStackYDocEntryFromRedo}
            pushRedoStackYDocEntry={pushRedoStackYDocEntry}
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

function getTaskUndoActionsGridViewTargetIfExists(
    store: TaskClientStore,
    actions: ReadonlyArray<TaskUpdateTaskAction>,
): {
    taskId: TaskId;
    column: TaskGridViewColumn;
} | null {
    if (actions.length === 0) return null;

    const targets = actions.map(action => {
        let column: TaskGridViewColumn;
        let preference: number;
        switch (action.taskAction.type) {
            case "Create":
            case "Delete":
            case "Undelete":
            case "UpdateParentTaskId":
            case "UpdateParentPosition":
            case "UpdateChildrenCounts":
            case "UpdateCollectionPosition":
            case "UpdateNotepadPagePosition":
            case "UpdateAssigneeActivePosition": {
                column = "Title";
                preference = 6;
                break;
            }
            case "AddCollection":
            case "RemoveCollection": {
                column = "Collections";
                preference = 1;
                break;
            }
            case "UpdateStatus":
            case "UpdateAssigneeStatus": {
                column = "StatusButton";
                preference = 5;
                break;
            }
            case "UpdateAssignee": {
                column = "Assignee";
                preference = 4;
                break;
            }
            case "UpdateTitle": {
                column = "Title";
                preference = 3;
                break;
            }
            case "UpdateDueDate": {
                column = "DueDate";
                preference = 2;
                break;
            }
            case "UpdatePriority": {
                column = "Priority";
                preference = 2;
                break;
            }
            default:
                throw exhaustive(action.taskAction);
        }

        let depth = 0;
        let currentTask =
            store.getTaskEntryStoreIfExists(action.taskId)?.getSnapshot().task ?? null;
        while (currentTask) {
            depth++;
            const parentTaskId = currentTask.getParent()?.taskId;
            currentTask = parentTaskId
                ? store.getTaskEntryStoreIfExists(parentTaskId)?.getSnapshot().task ?? null
                : null;
        }

        return {taskId: action.taskId, column, depth, preference};
    });

    // Pick the action with the lowest depth (parent task) then highest
    // preference score.
    targets.sort(
        (target1, target2) =>
            target1.depth - target2.depth || target2.preference - target1.preference,
    );

    return targets[0]!;
}
