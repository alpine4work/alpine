import {useDndContext} from "@dnd-kit/core";
import {setInteractionModality} from "@react-aria/interactions";
import {AnimationPlaybackControls, animate} from "motion";
import {Selection} from "prosemirror-state";
import {
    Key,
    Memo,
    ReactNode,
    RefObject,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsBehindMobileFullScreenModal} from "~/client/design/use_is_behind_mobile_full_screen_modal.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {useInitialAppRenderId} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    useStateWithDependencies,
    useStateWithDependenciesWithoutDispatch,
} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useStore} from "~/client/helpers/use_store.js";
import {getClientInfo, useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    useSpacingScale,
} from "~/client/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {tasksStyles} from "~/client/styles/styles.js";
import {
    taskGridViewColumnHeaderHeight,
    taskRowTitleInputPaddingYPx,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {
    isDisablingTaskGridViewAnimationsForTaskId,
    isIndiscriminatelyDisablingAllTaskGridViewAnimations,
} from "~/client/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {findTaskIndexInGridViewVirtualizedListIfExists} from "~/client/tasks/internal/find_task_index_in_grid_view_virtualized_list_if_exists.js";
import {withApplyTaskGridViewUndoStackEntry} from "~/client/tasks/internal/is_task_grid_view_applying_undo_stack_entry.js";
import {showTaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/show_task_delete_confirmation_modal_dialog.js";
import {
    taskDateInputCalendarDesktopHeight,
    taskDateInputCalendarMobileHeight,
} from "~/client/tasks/internal/task_date_input_calendar.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewHasDndContext} from "~/client/tasks/internal/task_grid_view_has_dnd_context.js";
import {TaskGridViewMobileKeyboardToolbarContainer} from "~/client/tasks/internal/task_grid_view_mobile_keyboard_toolbar.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {
    TaskGridViewColumnHeaderMemo,
    TaskGridViewDecorativeGhostTaskMemo,
    TaskGridViewMoreUnloadedTasksMemo,
    TaskGridViewUnloadedChildTaskMemo,
    TaskRowViewMemo,
} from "~/client/tasks/internal/task_grid_view_virtualized_list_components.js";
import {
    TaskGridViewVirtualizedListAnimation,
    TaskGridViewVirtualizedListState,
    isTaskGridViewVirtualizedListStateItemAfter,
} from "~/client/tasks/internal/task_grid_view_virtualized_list_state.js";
import {
    TaskGridViewVirtualizedListEvents,
    TaskGridViewVirtualizedListViewRef,
} from "~/client/tasks/internal/task_grid_view_virtualized_list_types.js";
import {TaskGridViewColumn, TaskRowViewRef} from "~/client/tasks/internal/task_row_view.js";
import {usePreloadSearchTaskCollectionsByAffinity} from "~/client/tasks/internal/use_search_task_collections_by_affinity.js";
import {useTaskGhostRowPlaceholderTutorial} from "~/client/tasks/internal/use_task_ghost_row_placeholder_tutorial.js";
import {useTaskGridViewExpansionState} from "~/client/tasks/internal/use_task_grid_view_expansion_state.js";
import {
    TaskUndoStackEntry,
    useTaskUndoStackState,
} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {TaskGridViewDraggableData} from "~/client/tasks/task_grid_view_dnd_context.js";
import {renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll} from "~/client/virtualized/helpers/render_virtualized_scroll_view_item_with_expensive_features_disabled_during_scroll.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    spacing,
} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {LinkedList} from "~/shared/helpers/immutable/linked_list.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {Id, generateId, unsafelyGenerateStableId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

const taskGridViewMoreUnloadedTasksSpinnerHeight = addRemLengths(
    taskRowViewMinHeight,
    taskRowViewMinHeight,
    taskRowViewMinHeight,
    "4",
    "6",
    "4",
);

/**
 * Do these sorts represent a manually sorted query?
 */
export function isTaskQueryManuallySorted(sorts: ReadonlyArray<TaskQueryNormalizedSort>): boolean {
    if (sorts.length === 0) return false;
    const firstSort = sorts[0]!;
    return (
        firstSort.type === "ParentPosition" ||
        firstSort.type === "CollectionPosition" ||
        firstSort.type === "AssigneePosition"
    );
}

const virtualizedScrollViewStateKeyByActiveQuery = new WeakMap<TaskClientQuery, Id>();
const zIndexesByTaskRowItemElement = new WeakMap<HTMLElement, Array<number>>();

export type TaskGridViewVirtualizedListProps = {
    /**
     * Override the generated `stateKey`. Useful if you want to maintain state
     * across different queries instead of generating a new `stateKey` every query.
     */
    stateKey?: string;

    /**
     * Capabilities of the task grid view. These are common shared props we pass
     * around to the grid view's children. For example, does the grid view have
     * columns? If so, which columns are visible?
     */
    capabilities: Memo<TaskGridViewCapabilities>;

    /**
     * Ref to the `<VirtualizedScrollView>` we render the virtualized list in. We
     * only use a subset of methods on `VirtualizedScrollViewRef` which makes it
     * easier to shift indexes around if we have other items in the virtualized
     * scroll view above the grid view.
     */
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef>;

    /**
     * The client store of task data.
     */
    store: TaskClientStore;

    /**
     * The query rendered by the grid view and the initial expansion state stored
     * on the server. Null if we're not currently rendering any query.
     */
    query: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    } | null;

    /**
     * Contains a reference to the entity rendering the grid view so any
     * interactions will add affinity score to the right entity on the backend.
     */
    affinityManager: TaskClientStoreSearchAffinityManager;

    /**
     * Should return a list of actions that make the task visible in the query's
     * filters at the provided position. For example, if this is a collection query
     * then we'll add the task to the collection and set the collection position
     * relative to whatever `position` was provided.
     *
     * Will be used when hitting `Enter` to create a new task or `Shift+Tab` to
     * move a task out of a parent task and into the query.
     */
    getMoveTaskToQueryActions: (
        taskId: TaskId,
        position:
            | {type: "Start"}
            | {type: "End"}
            | {type: "Above"; taskId: TaskId}
            | {type: "Below"; taskId: TaskId},
    ) => Array<TaskActionModel>;

    /**
     * Should return a list of actions that remove the task from the query's
     * filters. For example, if this is a collection query then we'll remove the
     * task from the collection.
     *
     * Will be used when hitting `Tab` to indent a task under the previous task
     * which also removes the task from the grid view.
     */
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskActionModel>;

    /**
     * By default the grid view needs to commit an action transaction it directly
     * calls `store.commitTaskActionTransaction()`. However, if this prop is
     * provided then we call this function instead. Useful if you need to add some
     * additional actions to a task action transaction.
     */
    commitActionTransaction?: Memo<
        (
            getActions: () => Iterable<TaskActionModel>,
            options: {
                undoManager: TaskClientStoreUndoManager;
                affinityManager: TaskClientStoreSearchAffinityManager;
            },
        ) => {finally(listener: () => void): void}
    > | null;

    /**
     * We add this item key prefix to all "structural" items. For example the
     * column header item and decorative task items. This is used by the personal
     * task view which needs to render multiple virtualized lists at once. Tasks do
     * not get this item key prefix since we want to easily be able to find a task
     * by its `TaskId` regardless of the virtualized list it's in.
     */
    structuralItemKeyPrefix?: string;

    /**
     * Don't render a column header item even if `capabilities.hasColumns` is true.
     * The caller is expected to render its own column header. You can use
     * `<TaskGridViewColumnHeader>` if needed.
     */
    withoutColumnHeader?: boolean;

    /**
     * Should the first row item not have a top border? By default the first row
     * item won't have a top border and you're expected to render one in the
     * navigation bar.
     */
    withoutBorderTopIfFirstRow?: boolean;

    /**
     * Additional controls rendered in the column header item adding to its height.
     * Useful for rendering filters that'll be sticky with the rest of the column
     * header.
     */
    columnHeaderControls?: Memo<{minHeight: RemLength | number; node: ReactNode}>;

    /**
     * The max width of a `<TaskRowView>`. Used by `<TaskDetailView>` to make sure
     * the subtasks grid view is the same width as the rest of the detail view's
     * content.
     */
    rowMaxWidth?: Spacing | null;

    /**
     * Don't render the bottom ghost task. Similar to `withoutDecorativeGhostRows`.
     *
     * Same as `withoutBottomGhostTaskIfEmpty` but doesn't have a secondary
     * condition which needs to be met.
     *
     * If this is true and `withoutColumnHeader` is true and
     * `withoutDecorativeGhostRows` is true then this list should render zero
     * items.
     */
    withoutBottomGhostTask?: boolean;

    /**
     * Don't render the up to three decorative ghost row items. Similar to
     * `withoutBottomGhostTask`.
     *
     * Same as `withoutDecorativeGhostRowsIfEmpty` but doesn't have a secondary
     * condition which needs to be met.
     *
     * If this is true and `withoutColumnHeader` is true and
     * `withoutBottomGhostTask` is true then this list should render zero items.
     */
    withoutDecorativeGhostRows?: boolean;

    /**
     * Don't render the bottom ghost task if there are no tasks. Similar to
     * `withoutDecorativeGhostRowsIfEmpty`.
     *
     * If this is true and `withoutColumnHeader` is true and
     * `withoutDecorativeGhostRowsIfEmpty` is true and there are no tasks in the
     * query then this list should render zero items.
     */
    withoutBottomGhostTaskIfEmpty?: boolean;

    /**
     * If `query` is null then we don't render a bottom ghost task. However, if you
     * set this to true then we will render a bottom ghost task when `query` is
     * null.
     *
     * Useful for `<TaskDetailView>` when creating a new task since we don't
     * actually create the task until the first update so we'll have a null query
     * but we still want to render the ghost task.
     */
    withBottomGhostTaskIfNullQuery?: boolean;

    /**
     * Don't render the up to three decorative ghost row items if there's no tasks.
     * Similar to `withoutBottomGhostTaskIfEmpty`.
     *
     * If this is true and `withoutColumnHeader` is true and the query is auto
     * sorted then if there are no tasks in the query we should render zero items.
     * If the query is not auto sorted then `withoutBottomGhostTaskIfEmpty` must
     * also be true to render zero items when there's no tasks.
     */
    withoutDecorativeGhostRowsIfEmpty?: boolean;

    /**
     * Provide custom handling for the undo/redo stack entry. Important for
     * `<TaskDetailView>` which needs to manually implement undo/redo handling for
     * task notes.
     */
    onApplyUndoStackEntry?: (options: {
        type: "Undo" | "Redo";
        entry: DistributiveOmit<TaskUndoStackEntry, "release">;
        target: {taskId: TaskId; column: TaskGridViewColumn};
        undoManager: TaskClientStoreUndoManager;
    }) => {preventDefault: boolean} | void;

    /**
     * Get the position of content we want to anchor when the keyboard opens on
     * mobile. This is passed into `useScrollToAvoidBottomBarsAndMobileKeyboard()`.
     */
    getAnchorPosition?: Memo<
        (oldVisibleRect: {top: number; bottom: number}) => {top: number; height: number} | null
    >;

    /**
     * If this grid view is one of many in a list of grid view sections (for
     * example, `<TaskPersonalView>`) then set this to the
     * `TaskGridViewVirtualizedListResult` of the previous grid view.
     */
    previousGridView?: {
        focusLastTaskTitleStart: () => void;
        focusLastTaskTitleEnd: () => void;
        focusLastTaskTitleAll: () => void;
        focusLastTaskTitleCoord: (coord: number) => void;
        focusLastTaskCell: (column: TaskGridViewColumn) => void;
    };

    /**
     * If this grid view is one of many in a list of grid view sections (for
     * example, `<TaskPersonalView>`) then set this to the
     * `TaskGridViewVirtualizedListResult` of the next grid view.
     */
    nextGridView?: {
        focusFirstTaskTitleStart: () => void;
        focusFirstTaskTitleCoord: (coord: number) => void;
        focusFirstTaskCell: (column: TaskGridViewColumn) => void;
    };

    /**
     * Animations from previous grid views. This is separate from
     * `previousGridView` since if a grid view is hidden the caller may set
     * `previousGridView` to undefined (or a different grid view) which would mean
     * we lose the animations from the newly hidden grid view.
     *
     * It's expected that the caller keep accumulating all previous grid view
     * animations (including from hidden grid views) and pass it into this array.
     */
    previousGridViewAnimations?: ReadonlyArray<TaskGridViewVirtualizedListAnimation>;
};

export type TaskGridViewVirtualizedListResult = {
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
     * (Optional, but recommended) Item index the scrollbar should be inset after.
     * Should be passed to `<VirtualizedScrollView>`.
     */
    scrollbarInsetTopItemIndex: number | undefined;

    /**
     * Modals opened during operation of the grid view (e.g. remainingWidth confirmation
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
     * (Optional) Focuses the start of the grid view.
     */
    focusStart: Memo<() => void>;

    /**
     * (Optional) Focuses the end of the grid view.
     */
    focusEnd: Memo<() => void>;

    /**
     * (Optional) Focuses the start of the last task title in the grid view.
     */
    focusLastTaskTitleStart: () => void;

    /**
     * (Optional) Focuses the end of the last task title in the grid view.
     */
    focusLastTaskTitleEnd: () => void;

    /**
     * (Optional) Focuses all the text in the last task title in the grid view.
     */
    focusLastTaskTitleAll: () => void;

    /**
     * (Optional) Focuses an X coordinate position in the last task title in the
     * grid view.
     */
    focusLastTaskTitleCoord: (coord: number) => void;

    /**
     * (Optional) Focuses a column in the last task title in the grid view.
     */
    focusLastTaskCell: (column: TaskGridViewColumn) => void;

    /**
     * (Optional) Focuses the start of the first task title in the grid view.
     */
    focusFirstTaskTitleStart: () => void;

    /**
     * (Optional) Focuses an X coordinate position in the first task title in the
     * grid view.
     */
    focusFirstTaskTitleCoord: (coord: number) => void;

    /**
     * (Optional) Focuses a column in the first task title in the grid view.
     */
    focusFirstTaskCell: (column: TaskGridViewColumn) => void;

    /**
     * (Optional) Add an entry to the grid view's undo stack.
     */
    pushUndoStackEntry: (entry: TaskUndoStackEntry) => void;

    /**
     * (Optional) Add an entry to the grid view's undo stack.
     */
    pushUndoStackEntryFromRedo: (entry: TaskUndoStackEntry) => void;

    /**
     * (Optional) Add an entry to the grid view's redo stack.
     */
    pushRedoStackEntry: (entry: TaskUndoStackEntry) => void;

    /**
     * (Optional) Apply the last undo stack entry.
     */
    undo: () => void;

    /**
     * (Optional) Redo the last undo stack entry.
     */
    redo: () => void;

    /**
     * (Optional) Returns the current `SpacingScale` value for convenience.
     */
    spacingScale: SpacingScale;

    /**
     * (Optional) The loaded state of the underlying task query. Same as
     * `useStore(query.loadedStateStore)`.
     */
    loadedState: "Unloaded" | "PartiallyLoaded" | "FullyLoaded";

    /**
     * (Optional) The underlying virtualized list state object.
     */
    state: TaskGridViewVirtualizedListState;

    /**
     * (Optional) the number of `<TaskRowView>` items. Excludes ghost rows, load
     * more indicators, and column headers. Same as `state.getItemCount()`.
     */
    stateItemCount: number;

    /**
     * (Optional) The animations we're currently running directly on this grid
     * view. Generated by diffing the current `state` with the previous `state`.
     * Does not include any animations we're inheriting from `previousGridView`.
     */
    animations: ReadonlyArray<TaskGridViewVirtualizedListAnimation>;
};

/**
 * Encapsulates the ability to render a virtualized list of tasks. You are
 * responsible for using ALL of the returned props in a
 * `<VirtualizedScrollView>` component. If you don't use one of the props in
 * the documented way your grid view may be broken.
 */
export function useTaskGridViewVirtualizedList(
    props: TaskGridViewVirtualizedListProps,
): TaskGridViewVirtualizedListResult {
    const {viewRef, getAnchorPosition: getAnchorPositionFromProps} = props;

    const {isAppleDevice} = useClientInfo();

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

    const rootQuery = props.query?.query ?? null;

    // By default, we generate a different state key whenever the root query
    // changes. However, the caller may override the state key with a prop.
    const stateKey =
        props.stateKey ??
        (rootQuery
            ? getOrSetDefaultMapValue(
                  virtualizedScrollViewStateKeyByActiveQuery,
                  rootQuery,
                  generateId,
              )
            : undefined);

    const {
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        popUndoStackEntry,
        popRedoStackEntry,
    } = useTaskUndoStackState({
        // Whenever the query changes we reset our undo stack. If the query changes
        // it's unlikely we'll find the tasks the user was previously operating on so
        // we can't scroll to them.
        stateKey,
    });

    const undo = () => {
        // Keep trying to undo until we find an entry we can apply.
        while (true) {
            const undoStackEntry = popUndoStackEntry();
            if (!undoStackEntry) break;

            if (
                result.applyUndoStackEntry("Undo", undoStackEntry, {
                    pushUndoStackEntry: entry => {
                        pushRedoStackEntry({
                            type: "Actions",
                            rootParentTaskId: undoStackEntry.rootParentTaskId,
                            extra: null,
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

            if (
                result.applyUndoStackEntry("Redo", undoStackEntry, {
                    pushUndoStackEntry: entry => {
                        pushUndoStackEntryFromRedo({
                            type: "Actions",
                            rootParentTaskId: undoStackEntry.rootParentTaskId,
                            extra: null,
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

    const {scrollToAnchorPosition} =
        useTaskGridViewVirtualizedListScrollToAvoidBottomBarsAndMobileKeyboard(
            viewRef,
            getAnchorPositionFromProps,
        );

    const result = useTaskGridViewVirtualizedListBase(
        Object.assign(props, {
            stateKey,
            isDragging,
            draggingData,
            pushUndoStackEntry,
            scrollToAnchorPosition,
        }),
    );

    return Object.assign(result, {
        onGlobalKeyDown,
        undo,
        redo,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
    });
}

/**
 * Sets up `useScrollToAvoidBottomBarsAndMobileKeyboard()` for the task grid
 * view. Task grid views have some custom anchor positioning logic to make sure
 * priority inputs or calendar date inputs are visible when the user clicks on
 * them and opens the keyboard.
 *
 * Also returns a function, `scrollToAnchorPosition`, which scrolls to the
 * current anchor position.
 *
 * If you're using `useTaskGridViewVirtualizedListBase()` multiple times to
 * render multiple grid views on one page then you'll also want to use this
 * hook once to make sure scroll position is managed properly on mobile in the
 * face of the keyboard opening/closing.
 */
export function useTaskGridViewVirtualizedListScrollToAvoidBottomBarsAndMobileKeyboard(
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef>,
    getAnchorPositionFromProps?: Memo<
        (oldVisibleRect: {top: number; bottom: number}) => {top: number; height: number} | null
    >,
) {
    const platform = usePlatform();

    const getAnchorPosition = useCallback(
        (oldVisibleRect: {top: number; bottom: number}): {top: number; height: number} | null => {
            const anchorPositionFromProps = getAnchorPositionFromProps?.(oldVisibleRect);
            if (anchorPositionFromProps) return anchorPositionFromProps;

            const {activeElement} = document;
            const viewContentElement = assertExists(viewRef.current).getContentElement();

            if (
                !(activeElement instanceof Element) ||
                !isElementOwnedBy(viewContentElement, activeElement)
            ) {
                return null;
            }

            // `<TaskDateInput>` and `<TaskCollectionsInput>` handle their own scrolling
            // when focused since they need to make sure their overlays are visible on
            // screen even when the keyboard is already open. So don't adjust to avoid the
            // keyboard if we're focusing one of those components. See those components for
            // their custom scroll to avoid keyboard implementation.
            if (
                activeElement.classList.contains(tasksStyles.dateInputTextSegmentClassName) ||
                activeElement.classList.contains(tasksStyles.collectionsInputAddInputClassName)
            ) {
                return null;
            }

            const activeRect = activeElement.getBoundingClientRect();

            // If we focused on a listbox, scroll to make sure the element the listbox
            // controls is visible. For example, the collections combobox opened by the
            // collection filter (`<TaskQueryCollectionsFilterOperationEditor>`).
            const ariaControlsAttribute = activeElement.getAttribute("aria-controls");
            if (ariaControlsAttribute) {
                const ariaControls = ariaControlsAttribute.split(" ")[0]!;
                let controlsElement = document.getElementById(ariaControls);

                // Support the case where our `listbox` is a `<ul>` wrapped in a `<div>` with
                // `overflow-y: auto`. We should use the size of the wrapping `<div>` not the
                // `<ul>`. Generally, perhaps we should call some kind of `getScrollParent()`
                // function.
                if (
                    controlsElement?.parentElement &&
                    getComputedStyle(controlsElement).overflowY === "visible" &&
                    getComputedStyle(controlsElement.parentElement).overflowY !== "visible"
                ) {
                    controlsElement = controlsElement.parentElement;
                }

                if (controlsElement) {
                    const controlsRect = controlsElement.getBoundingClientRect();

                    // For our anchor position, if there's an open control treat the control as
                    // having a minimum height equal to `<TaskDateInputCalendar>`. This way in dense
                    // fields on mobile if we open a priority or assignee input then a calendar
                    // input, we'll have scrolled to preserve enough onscreen space for the calendar
                    // should it open next.
                    const calendarHeightPx = convertRemLengthToPx(
                        platform === "mobile"
                            ? taskDateInputCalendarMobileHeight
                            : taskDateInputCalendarDesktopHeight,
                        getSpacingScaleWithoutListening(),
                    );

                    const top =
                        controlsRect.top < activeRect.top
                            ? Math.min(controlsRect.top, controlsRect.bottom - calendarHeightPx)
                            : activeRect.top;

                    const bottom =
                        controlsRect.bottom > activeRect.bottom
                            ? Math.max(controlsRect.bottom, controlsRect.top + calendarHeightPx)
                            : activeRect.bottom;

                    return {
                        top,
                        height: bottom - top,
                    };
                }
            }

            // If this is a multiline `<TaskRowTitleInput>` and the user taps on some text
            // near the end of the title input then we want to scroll to the user's
            // selection. Not the full element's container.
            if (activeElement instanceof HTMLElement && activeElement.contentEditable === "true") {
                const selectionRect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();

                // If the selection has a zero rect, return the active element's rect.
                if (selectionRect && (selectionRect.width !== 0 || selectionRect.height !== 0)) {
                    return selectionRect;
                }
            }

            return activeRect;
        },
        [getAnchorPositionFromProps, platform, viewRef],
    );

    // When the keyboard opens, make sure we scroll so that whatever's focused
    // stays in view. (e.g. The text title input.)
    const {getVisibleRect} = useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        getAnchorPosition,
    });

    const scrollToAnchorPosition = () => {
        const scrollableElement = assertExists(viewRef.current).getElement();
        const visibleRect = getVisibleRect();

        const anchorPosition = getAnchorPosition(visibleRect);
        if (!anchorPosition) return;

        const anchorBottom = anchorPosition.top + anchorPosition.height;

        const clearanceBottom =
            visibleRect.bottom - convertRemLengthToPx("1", getSpacingScaleWithoutListening());

        if (anchorBottom <= clearanceBottom) return;

        const scrollDelta = anchorBottom - clearanceBottom;

        scrollableElement.scrollTo({
            top: scrollableElement.scrollTop + scrollDelta,
            behavior: "smooth",
        });
    };

    return {scrollToAnchorPosition};
}

/**
 * Encapsulates the ability to render a virtualized list of tasks. You are
 * responsible for using ALL of the returned props in a
 * `<VirtualizedScrollView>` component. If you don't use one of the props in
 * the documented way your grid view may be broken.
 *
 * Same as `useTaskGridViewVirtualizedList()` but missing some features that
 * makes it possible to have multiple grid views in the same
 * `<VirtualizedScrollView>`. For example, this function doesn't maintain undo
 * state itself so you can have one undo stack across multiple grid views.
 */
export function useTaskGridViewVirtualizedListBase({
    capabilities,
    viewRef,
    store,
    query: rootQueryWithInitialState,
    affinityManager,
    getMoveTaskToQueryActions: getMoveTaskToRootQueryActions,
    getMaybeRemoveTaskFromQueryActions: getMaybeRemoveTaskFromRootQueryActions,
    commitActionTransaction: commitActionTransactionFromProps,
    structuralItemKeyPrefix = "",
    withoutColumnHeader = false,
    withoutBorderTopIfFirstRow = false,
    columnHeaderControls,
    rowMaxWidth = null,
    withoutBottomGhostTask = false,
    withoutDecorativeGhostRows = false,
    withoutBottomGhostTaskIfEmpty = false,
    withoutDecorativeGhostRowsIfEmpty = false,
    withBottomGhostTaskIfNullQuery = false,
    onApplyUndoStackEntry,
    stateKey: stateKeyFromProps,
    isDragging,
    draggingData,
    pushUndoStackEntry: pushUndoStackEntryFromProps,
    scrollToAnchorPosition: scrollToAnchorPositionFromProps,
    previousGridView,
    nextGridView,
    previousGridViewAnimations = emptyArray,
}: Omit<TaskGridViewVirtualizedListProps, "getAnchorPosition"> & {
    isDragging: boolean;
    draggingData: (TaskGridViewDraggableData & {readonly type: "Row"}) | null;
    pushUndoStackEntry: (entry: TaskUndoStackEntry) => void;
    scrollToAnchorPosition: () => void;
}): Omit<
    TaskGridViewVirtualizedListResult,
    | "onGlobalKeyDown"
    | "undo"
    | "redo"
    | "pushUndoStackEntry"
    | "pushUndoStackEntryFromRedo"
    | "pushRedoStackEntry"
> & {
    applyUndoStackEntry: (
        type: "Undo" | "Redo",
        entry: DistributiveOmit<TaskUndoStackEntry, "release">,
        options: {pushUndoStackEntry: TaskClientStoreUndoManager["pushUndoStackEntry"]},
    ) => boolean;
} {
    const initialAppRenderId = useInitialAppRenderId();
    const isInitialAppRender = initialAppRenderId !== null;
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const reporter = useReporter();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    const hasNextGridView = !!nextGridView;

    // If our grid view has columns then preload task collections so we don't show
    // a loading spinner when selecting the task collection cell.
    usePreloadSearchTaskCollectionsByAffinity({isDisabled: !capabilities.hasColumns});

    const mobileKeyboardToolbarPortalRef = useRef<HTMLDivElement>(null);

    const reactId = useId();

    const [bottomGhostTaskId, setBottomGhostTaskId] = useStateWithDependencies(
        ([rootQuery]) => {
            if (!rootQuery && !withBottomGhostTaskIfNullQuery) return null;
            if (!initialAppRenderId) return generateId<TaskId>();

            // If this is the initial app render, generate a stable `Id` that's consistent
            // across the client and server. We need the `reactId` as well to disambiguate
            // in case multiple grid views were rendered (could happen if we server peeks
            // someday).
            const stableRandom = new StableRandom(
                `TaskGridViewVirtualizedList-${initialAppRenderId}`,
            );
            return unsafelyGenerateStableId<TaskId>(stableRandom, `${reactId}-bottomGhostTaskId`);
        },
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
    const stateKey =
        stateKeyFromProps ??
        (rootQuery
            ? getOrSetDefaultMapValue(
                  virtualizedScrollViewStateKeyByActiveQuery,
                  rootQuery,
                  generateId,
              )
            : undefined);

    const isRootQueryNull = rootQuery === null;
    const isRootQueryManuallySorted = !isRootQueryNull
        ? isTaskQueryManuallySorted(rootQuery.sorts)
        : // We treat the grid view as manually sorted if
          // `withBottomGhostTaskIfNullQuery` is true. Since ghost rows only appear in
          // manually sorted queries.
          !!withBottomGhostTaskIfNullQuery;

    // Consider a null `rootQuery` as a fully loaded empty query.
    const loadedState = useStore(rootQuery?.loadedStateStore ?? null) ?? "FullyLoaded";

    // This is not a hard limit on task nesting. Rather a limit on how much nesting
    // we'll render in the grid view. Since too much nesting won't provide enough
    // space for the title text.
    //
    // It's purely a client-side limitation.
    const maxGridExpandableTaskDepth = platform === "mobile" ? 2 : 4;

    const stateStore = useMemo(
        () =>
            TaskGridViewVirtualizedListState.new(
                rootQuery,
                getAreChildTasksExpandedStore,
                maxGridExpandableTaskDepth,
            ),
        [getAreChildTasksExpandedStore, maxGridExpandableTaskDepth, rootQuery],
    );

    const state = useStore(stateStore);

    useDevConsoleTool("taskGridView", () => ({
        viewRef,
        query: rootQuery,
        state,
    }));

    const stateItemCount = state.getItemCount();

    const hasBottomGhostTask =
        !capabilities.isReadOnly &&
        (!isRootQueryNull || withBottomGhostTaskIfNullQuery) &&
        isRootQueryManuallySorted &&
        bottomGhostTaskId !== null &&
        !withoutBottomGhostTask &&
        (!withoutBottomGhostTaskIfEmpty || stateItemCount > 0);

    const hasColumnHeader: boolean =
        (capabilities.hasColumns && !withoutColumnHeader) || !!columnHeaderControls;
    const itemCountBeforeState = hasColumnHeader ? 1 : 0;

    const itemCount =
        itemCountBeforeState +
        (loadedState !== "FullyLoaded"
            ? stateItemCount + 1
            : Math.max(
                  stateItemCount + (hasBottomGhostTask ? 1 : 0),
                  withoutDecorativeGhostRows ||
                      (withoutDecorativeGhostRowsIfEmpty && stateItemCount === 0)
                      ? 0
                      : 3,
              ));

    const taskRowByGridKeyRef = useRef(new Map<TaskGridViewTaskKey, TaskRowViewRef>());

    // Get the index of the task we're currently dragging. We want to always render
    // the task we're dragging so touch events aren't cancelled when the task
    // unmounts.
    //
    // If the task's cursor (or parent cursors) change while we're dragging it then
    // we consider it acceptable to cancel the drag.
    const draggingIndex = useMemo(() => {
        if (!draggingData) return null;
        const index = state.getIndexByCursorAndParentsIfExists(draggingData);
        return index !== null ? index + itemCountBeforeState : null;
    }, [draggingData, itemCountBeforeState, state]);

    /* ========================================================================== *\
     *                                 Undo/Redo                                  *
    \* ========================================================================== */

    const applyUndoStackEntry = (
        type: "Undo" | "Redo",
        entry: DistributiveOmit<TaskUndoStackEntry, "release">,
        {
            pushUndoStackEntry,
        }: {
            pushUndoStackEntry: TaskClientStoreUndoManager["pushUndoStackEntry"];
        },
    ) => {
        return withApplyTaskGridViewUndoStackEntry(() => {
            const view = assertExists(viewRef.current);

            if (!rootQuery) return false;

            const target: {taskId: TaskId; column: TaskGridViewColumn} | null =
                entry.type === "Actions"
                    ? getTaskUndoActionsGridViewTargetIfExists(
                          store,
                          entry.undoActions.getWithoutReconciliation(),
                      )
                    : {taskId: entry.taskId, column: "Title"};
            if (!target) return false;

            const undoManager: TaskClientStoreUndoManager = {pushUndoStackEntry};

            // If this function returns true then the undo stack entry was handled.
            if (onApplyUndoStackEntry?.({type, entry, target, undoManager})?.preventDefault) {
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
                    // Doesn't call the `commitActionTransaction()` prop since:
                    //
                    // 1. We don't want that function to add anything to our undo action transaction
                    // 2. That function doesn't have to support leases which is convenient
                    store.commitTaskActionTransaction(context, entry.undoActions.get(store), {
                        undoManager,
                        affinityManager,
                        leaseId: entry.leaseId,
                    });
                    break;
                }
                // Note undo/redo is only applicable to `<TaskDetailView>`.
                case "Notes": {
                    return false;
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
        });
    };

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
                new Date().getTime() - lastArrowNavigationCoordRef.current.setTime.getTime() > 100
            ) {
                lastArrowNavigationCoordRef.current = null;
            }
        };

        document.addEventListener("focusin", clearLastArrowNavigationCoord);
        document.addEventListener("focusout", clearLastArrowNavigationCoord);
        document.addEventListener("selectionchange", clearLastArrowNavigationCoord);
        return () => {
            document.removeEventListener("focusin", clearLastArrowNavigationCoord);
            document.removeEventListener("focusout", clearLastArrowNavigationCoord);
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
                        rootQuery.loadMoreTasks(getTaskGridViewLoadQueryLimit(getClientInfo()));
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
                        const childrenQuery = store.ensureAndRetainTaskChildrenQuery(taskId, {
                            limit: getTaskGridViewLoadQueryLimit(getClientInfo()),
                        });
                        retainedChildrenQueries.push(childrenQuery);

                        childrenQuery?.loadMoreTasks(
                            getTaskGridViewLoadQueryLimit(getClientInfo()),
                        );

                        // In addition to loading the root task query, children queries for any of its
                        // expanded child tasks so they all pop in at the same time.
                        for (const {taskId: expandedChildTaskId} of iterateExpandedTaskIdsUnderPath(
                            [taskId],
                        )) {
                            const childrenQuery = store.ensureAndRetainTaskChildrenQuery(
                                expandedChildTaskId,
                                {
                                    limit: getTaskGridViewLoadQueryLimit(getClientInfo()),
                                },
                            );
                            retainedChildrenQueries.push(childrenQuery);

                            childrenQuery?.loadMoreTasks(
                                getTaskGridViewLoadQueryLimit(getClientInfo()),
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
        pushUndoStackEntry: pushUndoStackEntryFromProps,
        scrollToAnchorPosition: scrollToAnchorPositionFromProps,

        getItemCount: () => itemCount,
        getState: () => state,
        getItemCountBeforeState: () => itemCountBeforeState,

        onBottomGhostTaskCreated: () => {
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
                    hasBottomGhostTask
                ) {
                    return taskRowByGridKeyRef.current.get(bottomGhostTaskId) ?? null;
                }
                return null;
            }

            const item = state.getItem(stateIndex);
            if (item.type !== "Task") return null;

            const gridKey = getTaskGridViewTaskKey(item);

            return taskRowByGridKeyRef.current.get(gridKey) ?? null;
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

            let hasFocused = false;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                hasFocused = true;
                taskRow.focusTitleEnd();
                break;
            }

            if (!hasFocused) {
                previousGridView?.focusLastTaskTitleEnd();
            }
        },

        focusPreviousTaskTitleAll: (key: Key) => {
            const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(key));

            let hasFocused = false;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                hasFocused = true;
                taskRow.focusTitleAll();
                break;
            }

            if (!hasFocused) {
                previousGridView?.focusLastTaskTitleAll();
            }
        },

        focusTaskTitleStart: (gridKey: TaskGridViewTaskKey) => {
            taskRowByGridKeyRef.current.get(gridKey)?.focusTitleStart();
        },

        focusTaskTitleSelection: (gridKey: TaskGridViewTaskKey, selection: Selection) => {
            taskRowByGridKeyRef.current.get(gridKey)?.focusTitleSelection(selection);
        },

        focusNextTaskTitleCoord: (gridKey: TaskGridViewTaskKey, coord: number | null) => {
            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;
            if (coord === null) {
                events.focusNextTaskCell(gridKey, "Title");
                return;
            }

            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${gridKey}`),
            );

            let hasFocused = false;

            for (let index = itemIndex + 1; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                hasFocused = true;
                taskRow.focusTitleCoord(coord, "top");
                break;
            }

            if (!hasFocused) {
                nextGridView?.focusFirstTaskTitleCoord(coord);
            }

            lastArrowNavigationCoordRef.current = {
                setTime: new Date(),
                coord,
            };
        },

        focusPreviousTaskTitleCoord: (gridKey: TaskGridViewTaskKey, coord: number | null) => {
            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;
            if (coord === null) {
                events.focusPreviousTaskCell(gridKey, "Title");
                return;
            }

            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${gridKey}`),
            );

            let hasFocused = false;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                hasFocused = true;
                taskRow.focusTitleCoord(coord, "bottom");
                break;
            }

            if (!hasFocused) {
                previousGridView?.focusLastTaskTitleCoord(coord);
            }

            lastArrowNavigationCoordRef.current = {
                setTime: new Date(),
                coord,
            };
        },

        focusNextTaskCell: (gridKey: TaskGridViewTaskKey, column: TaskGridViewColumn) => {
            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${gridKey}`),
            );

            let hasFocused = false;

            for (let index = itemIndex + 1; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                hasFocused = true;
                taskRow.focusCell(column);
                break;
            }

            if (!hasFocused) {
                nextGridView?.focusFirstTaskCell(column);
            }
        },

        focusPreviousTaskCell: (gridKey: TaskGridViewTaskKey, column: TaskGridViewColumn) => {
            const itemIndex = assertExists(
                viewRef.current?.getIndexByKeyIfExists(`Task:${gridKey}`),
            );

            let hasFocused = false;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                hasFocused = true;
                taskRow.focusCell(column);
                break;
            }

            if (!hasFocused) {
                previousGridView?.focusLastTaskCell(column);
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
                let firstTaskRow: TaskRowViewRef | null = null;
                for (let index = 0; index < itemCount; index++) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    firstTaskRow = taskRow;
                    break;
                }

                if (firstTaskRow === firstVisibleTaskRow) {
                    previousGridView?.focusLastTaskTitleStart();
                    return;
                }

                runPromiseWithoutAwaiting(async () => {
                    const firstVisibleTaskRow = await events.scrollFirstVisiblePageUpTaskIntoView();
                    firstVisibleTaskRow?.focusTitleStart();
                });
                return;
            }

            firstVisibleTaskRow.focusTitleStart();
        },

        focusFirstVisibleTaskCell: (column: TaskGridViewColumn) => {
            const firstVisibleTaskRow = events.getFirstVisibleTaskRowIfExists();
            if (!firstVisibleTaskRow) return;

            // If the first visible task title is already focused then we want to scroll
            // one page up and focus the first task after scrolling.
            if (firstVisibleTaskRow.isFocusWithin()) {
                let firstTaskRow: TaskRowViewRef | null = null;
                for (let index = 0; index < itemCount; index++) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    firstTaskRow = taskRow;
                    break;
                }

                if (firstTaskRow === firstVisibleTaskRow) {
                    previousGridView?.focusLastTaskCell(column);
                    return;
                }

                runPromiseWithoutAwaiting(async () => {
                    const firstVisibleTaskRow = await events.scrollFirstVisiblePageUpTaskIntoView();
                    firstVisibleTaskRow?.focusCell(column);
                });
                return;
            }

            firstVisibleTaskRow.focusCell(column);
        },

        getFirstVisibleTaskRowIfExists: (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            // If we have a column header then it sticks to the top of the view. We want to
            // find a visible task row that's not occluded by our sticky column header.
            const columnHeaderPosition = view.getPositionByKeyIfExists(
                `${structuralItemKeyPrefix}ColumnHeader`,
            );

            const scrollMarginTop = Math.max(
                // In case the column header controls make the column header bigger than the
                // default expected height of navigation bar height plus column header height.
                //
                // TODO(calebmer): We should probably add
                // `Math.max(columnHeaderPosition?.height ?? 0)` for `<TaskRowTitleInput>`s
                // `scrollMarginTop` too.
                columnHeaderPosition?.height ?? 0,
                platform === "mobile"
                    ? convertRemLengthToPx(navigationBarHeight, spacingScale)
                    : convertRemLengthToPx(
                          addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight),
                          spacingScale,
                      ),
            );

            const effectiveHeight = view.getHeight() - scrollMarginTop;
            const effectiveScrollOffset = view.getScrollOffset() + scrollMarginTop;

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
                    taskRowByGridKeyRef.current.get(
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
            const columnHeaderPosition = view.getPositionByKeyIfExists(
                `${structuralItemKeyPrefix}ColumnHeader`,
            );

            const scrollMarginTop = Math.max(
                // In case the column header controls make the column header bigger than the
                // default expected height of navigation bar height plus column header height.
                //
                // TODO(calebmer): We should probably add
                // `Math.max(columnHeaderPosition?.height ?? 0)` for `<TaskRowTitleInput>`s
                // `scrollMarginTop` too.
                columnHeaderPosition?.height ?? 0,
                platform === "mobile"
                    ? convertRemLengthToPx(navigationBarHeight, spacingScale)
                    : convertRemLengthToPx(
                          addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight),
                          spacingScale,
                      ),
            );

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            const effectiveHeight = height - scrollMarginTop;

            const newScrollOffset = Math.max(
                0,
                scrollOffset -
                    (effectiveHeight -
                        // We want to keep some overlap between tasks when paging up/down so the user
                        // doesn't completely lose their context.
                        convertRemLengthToPx(
                            taskRowViewMinHeight,
                            getSpacingScaleWithoutListening(),
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
                let lastTaskRow: TaskRowViewRef | null = null;
                for (let index = itemCount - 1; index >= 0; index--) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    lastTaskRow = taskRow;
                    break;
                }

                if (lastTaskRow === lastVisibleTaskRow) {
                    nextGridView?.focusFirstTaskTitleStart();
                    return;
                }

                runPromiseWithoutAwaiting(async () => {
                    const lastVisibleTaskRow = await events.scrollLastVisiblePageDownTaskIntoView();
                    lastVisibleTaskRow?.focusTitleEnd();
                });
                return;
            }

            lastVisibleTaskRow.focusTitleEnd();
        },

        focusLastVisibleTaskCell: (column: TaskGridViewColumn) => {
            const lastVisibleTaskRow = events.getLastVisibleTaskRowIfExists();
            if (!lastVisibleTaskRow) return;

            // If the last visible task title is already focused then we want to scroll
            // one page down and focus the last task after scrolling.
            if (lastVisibleTaskRow.isFocusWithin()) {
                let lastTaskRow: TaskRowViewRef | null = null;
                for (let index = itemCount - 1; index >= 0; index--) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    lastTaskRow = taskRow;
                    break;
                }

                if (lastTaskRow === lastVisibleTaskRow) {
                    nextGridView?.focusFirstTaskCell(column);
                    return;
                }

                runPromiseWithoutAwaiting(async () => {
                    const lastVisibleTaskRow = await events.scrollLastVisiblePageDownTaskIntoView();
                    lastVisibleTaskRow?.focusCell(column);
                });
                return;
            }

            lastVisibleTaskRow.focusCell(column);
        },

        getLastVisibleTaskRowIfExists: (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            // If we have a column header then it sticks to the top of the view. We want to
            // find a visible task row that's not occluded by our sticky column header.
            const columnHeaderPosition = view.getPositionByKeyIfExists(
                `${structuralItemKeyPrefix}ColumnHeader`,
            );

            const scrollMarginTop = Math.max(
                // In case the column header controls make the column header bigger than the
                // default expected height of navigation bar height plus column header height.
                //
                // TODO(calebmer): We should probably add
                // `Math.max(columnHeaderPosition?.height ?? 0)` for `<TaskRowTitleInput>`s
                // `scrollMarginTop` too.
                columnHeaderPosition?.height ?? 0,
                // Same as `scrollMarginTop` in `<TaskRowTitleInput>`.
                taskRowTitleInputPaddingYPx[spacingScale] +
                    convertRemLengthToPx(spacing["4"], spacingScale) +
                    (platform === "mobile"
                        ? convertRemLengthToPx(navigationBarHeight, spacingScale)
                        : convertRemLengthToPx(
                              addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight),
                              spacingScale,
                          )),
            );

            const effectiveHeight = view.getHeight() - scrollMarginTop;
            const effectiveScrollOffset = view.getScrollOffset() + scrollMarginTop;

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
                    taskRowByGridKeyRef.current.get(
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
            const columnHeaderPosition = view.getPositionByKeyIfExists(
                `${structuralItemKeyPrefix}ColumnHeader`,
            );

            const scrollMarginTop = Math.max(
                // In case the column header controls make the column header bigger than the
                // default expected height of navigation bar height plus column header height.
                //
                // TODO(calebmer): We should probably add
                // `Math.max(columnHeaderPosition?.height ?? 0)` for `<TaskRowTitleInput>`s
                // `scrollMarginTop` too.
                columnHeaderPosition?.height ?? 0,
                // Same as `scrollMarginTop` in `<TaskRowTitleInput>`.
                taskRowTitleInputPaddingYPx[spacingScale] +
                    convertRemLengthToPx(spacing["4"], spacingScale) +
                    (platform === "mobile"
                        ? convertRemLengthToPx(navigationBarHeight, spacingScale)
                        : convertRemLengthToPx(
                              addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight),
                              spacingScale,
                          )),
            );

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            const effectiveHeight = height - scrollMarginTop;

            const newScrollOffset = Math.min(
                view.getContentHeight() - height,
                scrollOffset +
                    (effectiveHeight -
                        // We want to keep some overlap between tasks when paging up/down so the user
                        // doesn't completely lose their context.
                        convertRemLengthToPx(
                            taskRowViewMinHeight,
                            getSpacingScaleWithoutListening(),
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

        focusLastTaskTitleStart: () => {
            for (let index = itemCount - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleStart();
                break;
            }
        },

        focusLastTaskTitleEnd: () => {
            for (let index = itemCount - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleEnd();
                break;
            }
        },

        focusLastTaskTitleAll: () => {
            for (let index = itemCount - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleAll();
                break;
            }
        },

        focusLastTaskTitleCoord: coord => {
            for (let index = itemCount - 1; index >= 0; index--) {
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

        focusLastTaskCell: column => {
            for (let index = itemCount - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusCell(column);
                break;
            }
        },

        focusFirstTaskTitleStart: () => {
            for (let index = 0; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleStart();
                break;
            }
        },

        focusFirstTaskTitleCoord: coord => {
            for (let index = 0; index < itemCount; index++) {
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

        focusFirstTaskCell: column => {
            for (let index = 0; index < itemCount; index++) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusCell(column);
                break;
            }
        },

        setTaskRowZIndex: (gridKey: TaskGridViewTaskKey, newZIndex: number) => {
            const taskElement = viewRef.current?.getElementByKeyIfExists(`Task:${gridKey}`);
            if (!taskElement) return noop;

            const zIndexes = getOrSetDefaultMapValue(
                zIndexesByTaskRowItemElement,
                taskElement,
                () => [],
            );

            zIndexes.push(newZIndex);

            // If there are multiple `setTaskRowZIndex()` calls on this element at once,
            // the lowest `z-index` wins.
            const setZIndex = () => {
                const actualZIndex = zIndexes.length !== 0 ? Math.min(...zIndexes) : null;

                if (actualZIndex === null) {
                    taskElement.style.removeProperty("z-index");
                } else {
                    taskElement.style.zIndex = String(actualZIndex);
                }
            };

            setZIndex();

            return () => {
                const index = zIndexes.indexOf(newZIndex);
                assert(index !== -1);
                zIndexes.splice(index, 1);

                setZIndex();
            };
        },

        commitActionTransaction: (getActions, {undoManager}) => {
            if (commitActionTransactionFromProps) {
                return commitActionTransactionFromProps(getActions, {
                    undoManager,
                    affinityManager,
                });
            } else {
                return store.commitTaskActionTransaction(context, getActions(), {
                    undoManager,
                    affinityManager,
                });
            }
        },

        showTaskDeleteConfirmationModalDialog: ({
            undoManager,
            taskId,
            onAfterDelete,
            onAfterClose,
        }) => {
            showTaskDeleteConfirmationModalDialog({
                context,
                reporter,
                store,
                undoManager,
                taskId,
                onAfterDelete,
                onAfterClose,
            });
        },
    });

    /* ========================================================================== *\
     *                              Animation State                               *
    \* ========================================================================== */

    const [originalAnimationState, setAnimationState] = useState<{
        readonly state: TaskGridViewVirtualizedListState;
        readonly animations: ReadonlyArray<TaskGridViewVirtualizedListAnimation>;
    }>({
        state,
        animations: emptyArray,
    });
    let animationState = originalAnimationState;

    // If our state changed then compute any animations from the state change and
    // update our state so we can start rendering these animations.
    if (animationState.state !== state) {
        const animations = state.getAnimations(animationState.state);

        let newAnimations: Array<TaskGridViewVirtualizedListAnimation> | null = null;

        if (!isIndiscriminatelyDisablingAllTaskGridViewAnimations()) {
            for (const animation of animations) {
                if (!isDisablingTaskGridViewAnimationsForTaskId(animation.taskId)) {
                    newAnimations ??= [...animationState.animations];
                    newAnimations.push(animation);
                }
            }
        }

        animationState = {
            state,
            animations: newAnimations ?? animationState.animations,
        };
        setAnimationState(animationState);
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
        if (animationState.animations.length === 0 && previousGridViewAnimations.length === 0)
            return null;

        const view = assertExists(viewRef.current);
        const spacingScale = getSpacingScaleWithoutListening();

        const renderedRange = view.getRenderedRange();
        if (!renderedRange) return null;

        const currentTime = Date.now();
        const actualAnimations = new Set<AnimationPlaybackControls>();

        // Loop through every rendered item checking if it needs to be animated.
        for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
            const item =
                itemCountBeforeState <= index && index < itemCountBeforeState + stateItemCount
                    ? state.getItem(index - itemCountBeforeState)
                    : null;

            let movements: LinkedList<Movement> = null;

            // Total up the distance this task needs to move from all ongoing animations.
            // The row may be affected by multiple animations at once.
            const addAnimationMovement = (
                isPreviousGridView: boolean,
                animation: TaskGridViewVirtualizedListAnimation,
            ) => {
                switch (animation.type) {
                    case "Create": {
                        const isAfterNewItem =
                            isPreviousGridView ||
                            (animation.kind === "Task" &&
                                item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.newItem,
                                    item,
                                )) ||
                            index >= itemCountBeforeState + stateItemCount;

                        const isChildOfNewItem =
                            !isPreviousGridView &&
                            animation.kind === "Task" &&
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

                        if (!isAfterNewItem || isChildOfNewItem) return;

                        const endTime = animation.startTime + animation.duration;
                        const remainingDuration = endTime - currentTime;

                        if (remainingDuration <= 0) return;

                        const distance =
                            animation.kind === "Unknown"
                                ? -convertRemLengthToPx(animation.height, spacingScale)
                                : // TODO(calebmer): Ideally we'd get access to the new item's actual
                                  // height since the height is not a constant in task detail view.
                                  -(
                                      (1 + animation.newChildrenCount) *
                                      convertRemLengthToPx(taskRowViewMinHeight, spacingScale)
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
                            isPreviousGridView ||
                            (animation.kind === "Task" &&
                                item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.oldItem,
                                    item,
                                )) ||
                            index >= itemCountBeforeState + stateItemCount;

                        if (!isAfterOldItem) return;

                        const endTime = animation.startTime + animation.duration;
                        const remainingDuration = endTime - currentTime;

                        if (remainingDuration <= 0) return;

                        const distance =
                            animation.kind === "Unknown"
                                ? convertRemLengthToPx(animation.height, spacingScale)
                                : // TODO(calebmer): Ideally we'd get access to the new item's actual
                                  // height since the height is not a constant in task detail view.
                                  (1 + animation.oldChildrenCount) *
                                  convertRemLengthToPx(taskRowViewMinHeight, spacingScale);

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
                            isPreviousGridView ||
                            (item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.oldItem,
                                    item,
                                )) ||
                            index >= itemCountBeforeState + stateItemCount;

                        const isAfterNewItem =
                            isPreviousGridView ||
                            (item &&
                                isTaskGridViewVirtualizedListStateItemAfter(
                                    animation.newItem,
                                    item,
                                )) ||
                            index >= itemCountBeforeState + stateItemCount;

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

                        if (!isWithinItemMove) return;

                        const endTime = animation.startTime + animation.duration;
                        const remainingDuration = endTime - currentTime;

                        if (remainingDuration <= 0) return;

                        // TODO(calebmer): Ideally we'd somehow get access to the old item's actual
                        // height since the height is not a constant in task detail view.
                        const distance = convertRemLengthToPx(taskRowViewMinHeight, spacingScale);

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
            };

            for (const animation of previousGridViewAnimations) {
                addAnimationMovement(true, animation);
            }

            for (const animation of animationState.animations) {
                addAnimationMovement(false, animation);
            }

            if (movements === null) continue;

            const key = view.getKeyByIndexIfExists(index);
            const element = key ? view.getElementByKeyIfExists(key) : null;

            if (!element) continue;

            const {keyframes, times, duration} = convertMovementsToKeyframes(movements);

            const actualAnimation = animate(
                element,
                {
                    y: keyframes,
                },
                {
                    times,
                    duration,
                    // Since we interrupt this animation and start a new one as our animation
                    // state changes, linear easing helps the animation appear continuous.
                    //
                    // TODO(calebmer): A non-linear easing may look better here. But we have to take
                    // care to making it non-interruptible which seems challenging. If multiple
                    // animations overlap, does a non-linear easing look janky since we restart the
                    // curve whenever there's a new animation?
                    ease: "linear",
                },
            );

            actualAnimations.add(actualAnimation);
        }

        return () => {
            for (const actualAnimation of actualAnimations) {
                actualAnimation.complete();
            }
        };
    }, [
        animationState.animations,
        itemCountBeforeState,
        previousGridViewAnimations,
        state,
        stateItemCount,
        viewRef,
    ]);

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
            if (
                animation.kind === "Task" &&
                (animation.type === "Create" || animation.type === "Move")
            ) {
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

    const duplicateTaskAndAllChildren = useCallback(
        (taskId: TaskId, {undoManager}: {undoManager: TaskClientStoreUndoManager}) =>
            store.duplicateTaskAndAllChildren(context, taskId, timeZone, {undoManager}),
        [store, context, timeZone],
    );

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
                              ? convertRemLengthToPx(columnHeaderControls.minHeight, spacingScale)
                              : columnHeaderControls.minHeight,
                      node: columnHeaderControls.node,
                  }
                : null,
        [columnHeaderControls, spacingScale],
    );

    const renderItem = useMemo(() => {
        return (itemIndex: number): VirtualizedScrollViewItem => {
            // If this item is above our task list then render it.
            if (itemIndex < itemCountBeforeState) {
                let relativeItemIndex = itemIndex;

                if (hasColumnHeader) {
                    if (relativeItemIndex === 0) {
                        const minHeight = getTaskGridViewColumnHeaderWithControlsHeight(
                            spacingScale,
                            capabilities,
                            columnHeaderControlsWithMinHeightPx?.minHeight ?? 0,
                        );

                        return {
                            key: `${structuralItemKeyPrefix}ColumnHeader`,
                            minHeight,
                            withManualLayout: true,
                            render: ({ref, offset, shouldRenderWithRelativePositioning}) => (
                                <TaskGridViewColumnHeaderMemo
                                    ref={ref}
                                    hasColumns={capabilities.hasColumns}
                                    withoutAssigneeField={capabilities.withoutAssigneeField}
                                    columnHeaderControls={columnHeaderControlsWithMinHeightPx}
                                    minHeight={minHeight}
                                    offset={offset}
                                    shouldRenderWithRelativePositioning={
                                        shouldRenderWithRelativePositioning
                                    }
                                />
                            ),
                        };
                    }

                    relativeItemIndex -= 1;
                }

                throw new InternalError("Unexpected item before state");
            }

            // If this item is below our task list then render either a ghost row or empty
            // decorative rows.
            if (itemIndex >= itemCountBeforeState + stateItemCount) {
                let relativeItemIndex = itemIndex - stateItemCount - itemCountBeforeState;

                if (loadedState !== "FullyLoaded") {
                    return {
                        key: `${structuralItemKeyPrefix}MoreUnloadedTasks`,
                        minHeight: taskGridViewMoreUnloadedTasksSpinnerHeight,
                        node: (
                            <TaskGridViewMoreUnloadedTasksMemo
                                capabilities={capabilities}
                                rowMaxWidth={rowMaxWidth}
                                withoutBorderTop={
                                    withoutBorderTopIfFirstRow &&
                                    itemIndex - itemCountBeforeState === 0
                                }
                                focusPreviousTaskTitleEnd={events.focusPreviousTaskTitleEnd}
                                focusPreviousTaskTitleAll={events.focusPreviousTaskTitleAll}
                            />
                        ),
                    };
                }

                // No ghost task if `rootQuery` is null, the grid view is read-only, or we're
                // not manually sorted.
                if (hasBottomGhostTask) {
                    if (relativeItemIndex === 0) {
                        const renderItem = (disableExpensiveFeaturesDuringScroll: boolean) => (
                            <TaskRowViewMemo
                                capabilities={capabilities}
                                maxGridExpandableTaskDepth={maxGridExpandableTaskDepth}
                                stateKey={stateKey}
                                store={store}
                                rootQuery={rootQuery}
                                isRootQueryManuallySorted={isRootQueryManuallySorted}
                                affinityManager={affinityManager}
                                query={rootQuery}
                                gridKey={bottomGhostTaskId}
                                cursor={null}
                                ghostTaskId={bottomGhostTaskId}
                                parents={emptyArray}
                                rowMaxWidth={rowMaxWidth}
                                // Don't disable expensive features while auto-scrolling during drag since one
                                // of the expensive features this flag disables is droppable zones. The user
                                // still needs to be able to reach droppable zones during a drag auto-scroll.
                                disableExpensiveFeaturesDuringScroll={
                                    !isDragging && disableExpensiveFeaturesDuringScroll
                                }
                                isFirstRow={stateItemCount === 0}
                                withoutBorderTopIfFirstRow={withoutBorderTopIfFirstRow}
                                // The ghost row is not a task in the query so always report as false.
                                isFirstTaskInQuery={false}
                                nextIndentation={0}
                                titlePlaceholder={
                                    !capabilities.isReadOnly
                                        ? taskGhostRowPlaceholder ?? "Add a task…"
                                        : undefined
                                }
                                viewRef={viewRef}
                                events={events}
                                taskRowByGridKeyRef={taskRowByGridKeyRef}
                                onLayoutEffectCallbacksRef={onLayoutEffectCallbacksRef}
                                getAreChildTasksExpandedStore={getAreChildTasksExpandedStore}
                                duplicateTaskAndAllChildren={duplicateTaskAndAllChildren}
                                toggleAreChildTasksExpanded={toggleAreChildTasksExpanded}
                                // If there are no task rows, the padding just makes our ghost row placeholder
                                // look misaligned. So remove it.
                                withoutPaddingLeft={
                                    !capabilities.hasColumns && stateItemCount === 0
                                }
                                withPaddingBottom={itemIndex === itemCount - 1}
                                hasNextGridView={hasNextGridView}
                                mobileKeyboardToolbarPortalRef={mobileKeyboardToolbarPortalRef}
                            />
                        );

                        return {
                            // We want to use the same key and component as a regular task so we can turn a
                            // ghost task into a regular task without losing focus.
                            key: `Task:${bottomGhostTaskId}`,
                            minHeight: spacing[taskRowViewMinHeight],
                            withManualLayout: true,
                            render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                                {
                                    render: renderItem,
                                    containerStyle: {
                                        // Make sure our rows here increment the row number counter.
                                        counterIncrement: tasksStyles.rowNumberCounterName,
                                    },
                                },
                            ),
                        };
                    }

                    relativeItemIndex -= 1;
                }

                return {
                    key: `${structuralItemKeyPrefix}DecorativeGhostTask:${relativeItemIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewDecorativeGhostTaskMemo
                            rowMaxWidth={rowMaxWidth}
                            isInert={
                                capabilities.isReadOnly ||
                                (isRootQueryNull && !withBottomGhostTaskIfNullQuery)
                            }
                            structuralItemKeyPrefix={structuralItemKeyPrefix}
                            hasColumnHeader={hasColumnHeader}
                            relativeItemIndex={relativeItemIndex}
                            isFirstRow={itemIndex - itemCountBeforeState === 0}
                            withoutBorderTopIfFirstRow={withoutBorderTopIfFirstRow}
                            withPaddingBottom={itemIndex === itemCount - 1}
                            hasNextGridView={hasNextGridView}
                            focusPreviousTaskTitleEnd={events.focusPreviousTaskTitleEnd}
                            focusPreviousTaskTitleAll={events.focusPreviousTaskTitleAll}
                        />
                    ),
                };
            }

            const item = state.getItem(itemIndex - itemCountBeforeState);

            if (item.type === "Task") {
                const gridKey = getTaskGridViewTaskKey(item);

                const renderItem = (disableExpensiveFeaturesDuringScroll: boolean) => (
                    <TaskRowViewMemo
                        capabilities={capabilities}
                        maxGridExpandableTaskDepth={maxGridExpandableTaskDepth}
                        stateKey={stateKey}
                        store={store}
                        // If we have a task item then that must mean we have a query.
                        rootQuery={rootQuery}
                        isRootQueryManuallySorted={isRootQueryManuallySorted}
                        affinityManager={affinityManager}
                        query={item.query}
                        gridKey={gridKey}
                        cursor={item.cursor}
                        parents={item.parents}
                        rowMaxWidth={rowMaxWidth}
                        // Don't disable expensive features while auto-scrolling during drag since one
                        // of the expensive features this flag disables is droppable zones. The user
                        // still needs to be able to reach droppable zones during a drag auto-scroll.
                        disableExpensiveFeaturesDuringScroll={
                            !isDragging && disableExpensiveFeaturesDuringScroll
                        }
                        isFirstRow={itemIndex - itemCountBeforeState === 0}
                        withoutBorderTopIfFirstRow={withoutBorderTopIfFirstRow}
                        isFirstTaskInQuery={item.isFirstTaskInQuery}
                        nextIndentation={
                            itemIndex + 1 < itemCountBeforeState + stateItemCount
                                ? // This doesn't mess up the `state.getItem(n + 1)` optimization since
                                  // repeatedly calling `state.getItem(n)` preserves the internal iterator.
                                  state.getItem(itemIndex - itemCountBeforeState + 1).parents.length
                                : 0
                        }
                        viewRef={viewRef}
                        events={events}
                        taskRowByGridKeyRef={taskRowByGridKeyRef}
                        onLayoutEffectCallbacksRef={onLayoutEffectCallbacksRef}
                        getAreChildTasksExpandedStore={getAreChildTasksExpandedStore}
                        toggleAreChildTasksExpanded={toggleAreChildTasksExpanded}
                        duplicateTaskAndAllChildren={duplicateTaskAndAllChildren}
                        withPaddingBottom={itemIndex === itemCount - 1}
                        hasNextGridView={hasNextGridView}
                        mobileKeyboardToolbarPortalRef={mobileKeyboardToolbarPortalRef}
                    />
                );

                return {
                    key: `Task:${gridKey}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    withManualLayout: true,
                    render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                        {
                            render: renderItem,
                            containerStyle: {
                                // Make sure our rows here increment the row number counter.
                                counterIncrement: tasksStyles.rowNumberCounterName,
                            },
                        },
                    ),
                };
            } else {
                cast<"UnloadedChildTask">(item.type);

                assert(item.parents.length > 0);

                const parentTaskId = getTaskQuerySortCursorTaskId(
                    item.parents[item.parents.length - 1]!.cursor,
                );

                const parentGridKey: TaskGridViewTaskKey =
                    item.parents.length > 1
                        ? `${getTaskQuerySortCursorTaskId(item.parents[0]!.cursor)}-${parentTaskId}`
                        : parentTaskId;

                return {
                    key: `UnloadedChildTask:${parentGridKey}-${item.unloadedChildTaskIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewUnloadedChildTaskMemo
                            capabilities={capabilities}
                            rowMaxWidth={rowMaxWidth}
                            parentGridKey={parentGridKey}
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
        affinityManager,
        bottomGhostTaskId,
        capabilities,
        columnHeaderControlsWithMinHeightPx,
        duplicateTaskAndAllChildren,
        events,
        getAreChildTasksExpandedStore,
        hasBottomGhostTask,
        hasColumnHeader,
        hasNextGridView,
        isDragging,
        isRootQueryManuallySorted,
        isRootQueryNull,
        itemCount,
        itemCountBeforeState,
        loadedState,
        maxGridExpandableTaskDepth,
        rootQuery,
        rowMaxWidth,
        spacingScale,
        state,
        stateItemCount,
        stateKey,
        store,
        structuralItemKeyPrefix,
        taskGhostRowPlaceholder,
        toggleAreChildTasksExpanded,
        viewRef,
        withBottomGhostTaskIfNullQuery,
        withoutBorderTopIfFirstRow,
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
        alwaysRenderAdditionalItemIndexes: useMemo(() => {
            if (hasColumnHeader && draggingIndex !== null) return [0, draggingIndex];
            if (hasColumnHeader) return [0];
            if (draggingIndex !== null) return [draggingIndex];
            return emptyArray;
        }, [draggingIndex, hasColumnHeader]),
        scrollbarInsetTopItemIndex: hasColumnHeader ? 0 : undefined,
        modals: (
            <>
                {!isInitialAppRender && platform === "mobile" && !isInert && (
                    // The mobile keyboard toolbar is only modal-ish? Maybe we should rename
                    // this prop.
                    <TaskGridViewMobileKeyboardToolbarContainer
                        portalRef={mobileKeyboardToolbarPortalRef}
                        withoutAssigneeField={capabilities.withoutAssigneeField}
                    />
                )}
            </>
        ),
        focusStart: events.focusStart,
        focusEnd: events.focusEnd,
        focusLastTaskTitleStart: events.focusLastTaskTitleStart,
        focusLastTaskTitleEnd: events.focusLastTaskTitleEnd,
        focusLastTaskTitleAll: events.focusLastTaskTitleAll,
        focusLastTaskTitleCoord: events.focusLastTaskTitleCoord,
        focusLastTaskCell: events.focusLastTaskCell,
        focusFirstTaskTitleStart: events.focusFirstTaskTitleStart,
        focusFirstTaskTitleCoord: events.focusFirstTaskTitleCoord,
        focusFirstTaskCell: events.focusFirstTaskCell,
        spacingScale,
        loadedState,
        state,
        stateItemCount,
        animations: animationState.animations,
        applyUndoStackEntry,
    };
}

export function getTaskGridViewColumnHeaderWithControlsHeight(
    spacingScale: SpacingScale,
    capabilities: TaskGridViewCapabilities,
    columnHeaderControlsHeight: RemLength | number,
): number {
    return (
        (typeof columnHeaderControlsHeight === "string"
            ? convertRemLengthToPx(columnHeaderControlsHeight, spacingScale)
            : columnHeaderControlsHeight) +
        (capabilities.hasColumns
            ? convertRemLengthToPx(taskGridViewColumnHeaderHeight, spacingScale)
            : 0)
    );
}

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
    const times = [0];

    let workingDistance = 0;
    let workingDuration = 0;
    workingMovements = movements;
    while (workingMovements !== null) {
        workingDistance += workingMovements.value.distance;
        workingDuration += workingMovements.value.duration;
        keyframes.push(totalDistance - workingDistance);
        times.push(workingDuration / totalDuration);
        workingMovements = workingMovements.next;
    }

    return {
        keyframes,
        times,
        duration: totalDuration / 1000,
    };
}

/**
 * Used to animate an item that comes after a task grid view. Pass in the
 * previous grid view result, the item index, and make sure to call
 * `onRenderedRangeLayoutChange` and the item will be animated for you.
 *
 * Used in `<TaskPersonalView>` for section headers. If the "Due today" grid
 * view is animating then the "Due soon" section header should move.
 */
export function useTaskGridViewVirtualizedListItemAnimation(
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef>,
    previousGridViewAnimations: ReadonlyArray<TaskGridViewVirtualizedListAnimation>,
    itemIndex: number | null,
) {
    const cancelAnimationRef = useRef<(() => void) | null>(null);

    const updateAnimations = useCallback(() => {
        if (itemIndex === null || previousGridViewAnimations.length === 0) {
            return null;
        }

        const view = assertExists(viewRef.current);
        const spacingScale = getSpacingScaleWithoutListening();

        const renderedRange = view.getRenderedRange();
        if (!renderedRange) return null;

        const currentTime = Date.now();

        let movements: LinkedList<Movement> = null;

        // Total up the distance this task needs to move from all ongoing animations.
        // The row may be affected by multiple animations at once.
        for (const animation of previousGridViewAnimations) {
            switch (animation.type) {
                case "Create": {
                    const endTime = animation.startTime + animation.duration;
                    const remainingDuration = endTime - currentTime;

                    if (remainingDuration <= 0) break;

                    const distance =
                        animation.kind === "Unknown"
                            ? -convertRemLengthToPx(animation.height, spacingScale)
                            : // TODO(calebmer): Ideally we'd get access to the new item's actual
                              // height since the height is not a constant in task detail view.
                              -(
                                  (1 + animation.newChildrenCount) *
                                  convertRemLengthToPx(taskRowViewMinHeight, spacingScale)
                              );

                    const remainingDistance = distance * (remainingDuration / animation.duration);

                    movements = addMovement(movements, {
                        distance: remainingDistance,
                        duration: remainingDuration,
                    });
                    break;
                }
                // TODO(calebmer): Ideally we keep rendering the old task as we slide tasks
                // below on top of it. Instead of immediately un-rendering the task.
                case "Delete": {
                    const endTime = animation.startTime + animation.duration;
                    const remainingDuration = endTime - currentTime;

                    if (remainingDuration <= 0) break;

                    const distance =
                        animation.kind === "Unknown"
                            ? convertRemLengthToPx(animation.height, spacingScale)
                            : // TODO(calebmer): Ideally we'd get access to the new item's actual
                              // height since the height is not a constant in task detail view.
                              (1 + animation.oldChildrenCount) *
                              convertRemLengthToPx(taskRowViewMinHeight, spacingScale);

                    const remainingDistance = distance * (remainingDuration / animation.duration);

                    movements = addMovement(movements, {
                        distance: remainingDistance,
                        duration: remainingDuration,
                    });
                    break;
                }
                case "Move": {
                    // We don't need to animate moves since right now a move animation may only
                    // happen entirely within a single grid view.
                    break;
                }
                default:
                    exhaustive(animation);
            }
        }

        if (movements === null) return noop;

        const key = view.getKeyByIndexIfExists(itemIndex);
        const element = key ? view.getElementByKeyIfExists(key) : null;

        if (!element) return noop;

        const {keyframes, times, duration} = convertMovementsToKeyframes(movements);

        const actualAnimation = animate(
            element,
            {
                y: keyframes,
            },
            {
                times,
                duration,
                // Since we interrupt this animation and start a new one as our animation
                // state changes, linear easing helps the animation appear continuous.
                //
                // TODO(calebmer): A non-linear easing may look better here. But we have to take
                // care to making it non-interruptible which seems challenging. If multiple
                // animations overlap, does a non-linear easing look janky since we restart the
                // curve whenever there's a new animation?
                ease: "linear",
            },
        );

        return () => {
            actualAnimation.complete();
        };
    }, [itemIndex, previousGridViewAnimations, viewRef]);

    useLayoutEffectWithoutServerSideWarning(() => {
        cancelAnimationRef.current?.();
        cancelAnimationRef.current = updateAnimations();
        return () => {
            cancelAnimationRef.current?.();
            cancelAnimationRef.current = null;
        };
    }, [updateAnimations]);

    return {
        onRenderedRangeLayoutChange: () => {
            // `viewRef` may not have been initialized yet.
            if (!viewRef.current) return;

            cancelAnimationRef.current?.();
            cancelAnimationRef.current = updateAnimations();
        },
    };
}

function getTaskUndoActionsGridViewTargetIfExists(
    store: TaskClientStore,
    actions: ReadonlyArray<{
        readonly taskId: TaskId;
        readonly taskAction: {readonly type: TaskUpdateTaskAction["taskAction"]["type"]};
    }>,
): {
    taskId: TaskId;
    column: TaskGridViewColumn;
} | null {
    if (actions.length === 0) return null;

    const groupByTaskId = new Map<TaskId, number>();

    const setGroupForTaskId = (taskId: TaskId, group: number) => {
        assert(group > 0);
        const oldGroup = groupByTaskId.get(taskId) ?? 0;
        groupByTaskId.set(taskId, Math.max(oldGroup, group));
    };

    const targets = actions.map(action => {
        let column: TaskGridViewColumn;
        let preference: number;
        switch (action.taskAction.type) {
            case "UpdateParentTaskId":
            case "UpdateParentPosition":
            case "UpdateChildrenCounts":
            case "UpdateCollectionPosition":
            case "UpdateAssigneePosition":
            case "UpdateNotepadPagePosition":
            case "UpdateAssigneeActivePosition": {
                column = "Title";
                preference = 6;
                break;
            }
            case "Create": {
                setGroupForTaskId(action.taskId, 1);
                column = "Title";
                preference = 6;
                break;
            }
            case "Delete": {
                setGroupForTaskId(action.taskId, 2);
                column = "Title";
                preference = 6;
                break;
            }
            case "Undelete": {
                setGroupForTaskId(action.taskId, 3);
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
                throw exhaustive(action.taskAction.type);
        }

        let depth = 0;
        let currentTask = store.getTaskEntrySnapshot(action.taskId)?.task ?? null;
        while (currentTask) {
            depth++;
            const parentTaskId = currentTask.getParent()?.taskId;
            currentTask = parentTaskId
                ? store.getTaskEntrySnapshot(parentTaskId)?.task ?? null
                : null;
        }

        return {taskId: action.taskId, column, depth, preference};
    });

    // Sort actions by group (lowest first, undefined group is 0), then lowest
    // depth (lower depth means potentially a parent task), then highest preference
    // score.
    targets.sort(
        (target1, target2) =>
            (groupByTaskId.get(target1.taskId) ?? 0) - (groupByTaskId.get(target2.taskId) ?? 0) ||
            target1.depth - target2.depth ||
            target2.preference - target1.preference,
    );

    return targets[0]!;
}
