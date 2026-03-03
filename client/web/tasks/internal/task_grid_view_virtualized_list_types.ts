import {Selection} from "prosemirror-state";
import {Key} from "react";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {TaskClientStoreUndoManager} from "~/client/web/tasks/core/task_client_store.js";
import {TaskGridViewTaskKey} from "~/client/web/tasks/internal/task_grid_view_task_key.js";
import {TaskGridViewVirtualizedListState} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_state.js";
import {TaskGridViewColumn, TaskRowViewRef} from "~/client/web/tasks/internal/task_row_view.js";
import {TaskUndoStackEntry} from "~/client/web/tasks/internal/use_task_undo_stack_state.js";
import {VirtualizedScrollViewRef} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";

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
    getElement: () => HTMLElement;
    getContentElement: () => HTMLElement;
    getElementByKeyIfExists: (key: Key) => HTMLElement | null;
};

// Should be able to pass `VirtualizedScrollViewRef` in for
// `TaskGridViewVirtualizedListViewRef`. Often our virtualized grid view will have
// other stuff besides tasks so a modified ref object may be passed in.
assertAssignableTypes<VirtualizedScrollViewRef, TaskGridViewVirtualizedListViewRef>();

export type TaskGridViewVirtualizedListEvents = MemoObject<{
    readonly getMoveTaskToRootQueryActions: (
        taskId: TaskId,
        position:
            | {type: "Start"}
            | {type: "End"}
            | {type: "Above"; taskId: TaskId}
            | {type: "Below"; taskId: TaskId}
            | {type: "Position"; position: TaskPosition},
    ) => {
        actions: Array<TaskActionModel>;
        position: TaskPosition;
    } | null;
    readonly getMaybeRemoveTaskFromRootQueryActions: (taskId: TaskId) => Array<TaskActionModel>;
    readonly getItemCount: () => number;
    readonly getState: () => TaskGridViewVirtualizedListState;
    readonly getItemCountBeforeState: () => number;
    readonly pushUndoStackEntry: (entry: TaskUndoStackEntry) => void;
    readonly onBottomGhostTaskCreated: () => void;
    readonly getTaskRowByIndexIfExists: (index: number) => TaskRowViewRef | null;
    readonly focusStart: () => void;
    readonly focusEnd: () => void;
    readonly focusPreviousTaskTitleEnd: (key: Key) => void;
    readonly focusPreviousTaskTitleAll: (key: Key) => void;
    readonly focusTaskTitleStart: (gridKey: TaskGridViewTaskKey) => void;
    readonly focusTaskTitleSelection: (gridKey: TaskGridViewTaskKey, selection: Selection) => void;
    readonly focusNextTaskTitleCoord: (gridKey: TaskGridViewTaskKey, coord: number | null) => void;
    readonly focusPreviousTaskTitleCoord: (
        gridKey: TaskGridViewTaskKey,
        coord: number | null,
    ) => void;
    readonly focusNextTaskCell: (gridKey: TaskGridViewTaskKey, column: TaskGridViewColumn) => void;
    readonly focusPreviousTaskCell: (
        gridKey: TaskGridViewTaskKey,
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
    readonly focusLastTaskTitleStart: () => void;
    readonly focusLastTaskTitleEnd: () => void;
    readonly focusLastTaskTitleAll: () => void;
    readonly focusLastTaskTitleCoord: (coord: number) => void;
    readonly focusLastTaskCell: (column: TaskGridViewColumn) => void;
    readonly focusFirstTaskTitleStart: () => void;
    readonly focusFirstTaskTitleCoord: (coord: number) => void;
    readonly focusFirstTaskCell: (column: TaskGridViewColumn) => void;
    readonly setTaskRowZIndex: (gridKey: TaskGridViewTaskKey, zIndex: number) => () => void;
    readonly scrollToAnchorPosition: () => void;
    readonly commitActionTransaction: (
        getActions: () => Iterable<TaskActionModel>,
        options: {undoManager: TaskClientStoreUndoManager},
    ) => {
        finally(listener: () => void): void;
    };
    readonly showTaskDeleteConfirmationModalDialog: (options: {
        undoManager: TaskClientStoreUndoManager;
        taskId: TaskId;
        onAfterDelete?: () => void;
        onAfterClose?: () => void;
    }) => void;
}>;
