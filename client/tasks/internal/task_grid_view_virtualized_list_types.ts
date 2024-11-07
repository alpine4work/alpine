import {Selection} from "prosemirror-state";
import {Key} from "react";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {TaskGridViewVirtualizedListState} from "~/client/tasks/internal/task_grid_view_virtualized_list_state.js";
import {TaskGridViewColumn, TaskRowViewRef} from "~/client/tasks/internal/task_row_view.js";
import {TaskUndoStackEntry} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

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
// `TaskGridViewVirtualizedListViewRef`. Often our virtualized grid view will
// have other stuff besides tasks so a modified ref object may be passed in.
assertAssignableTypes<VirtualizedScrollViewRef, TaskGridViewVirtualizedListViewRef>();

export type TaskGridViewVirtualizedListEvents = MemoObject<{
    readonly getMoveTaskToRootQueryActions: (
        taskId: TaskId,
        position:
            | {type: "Start"}
            | {type: "End"}
            | {type: "Above"; taskId: TaskId}
            | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    readonly getMaybeRemoveTaskFromRootQueryActions: (taskId: TaskId) => Array<TaskAction>;
    readonly getItemCount: () => number;
    readonly getState: () => TaskGridViewVirtualizedListState;
    readonly getItemCountBeforeState: () => number;
    readonly pushUndoStackEntry: (entry: TaskUndoStackEntry) => void;
    readonly pushUndoStackEntryFromRedo: (entry: TaskUndoStackEntry) => void;
    readonly pushRedoStackEntry: (entry: TaskUndoStackEntry) => void;
    readonly onTopGhostTaskCreated: () => void;
    readonly onBottomGhostTaskCreated: () => void;
    readonly getTaskRowByIndexIfExists: (index: number) => TaskRowViewRef | null;
    readonly focusStart: () => void;
    readonly focusEnd: () => void;
    readonly showTopGhostTaskAndFocus: () => void;
    readonly focusPreviousTaskTitleEnd: (key: Key) => void;
    readonly focusPreviousTaskTitleAll: (key: Key) => void;
    readonly focusTaskTitleStart: (gridKey: TaskGridViewTaskKey) => void;
    readonly focusTaskTitleSelection: (gridKey: TaskGridViewTaskKey, selection: Selection) => void;
    readonly focusNextTaskTitleCoord: (gridKey: TaskGridViewTaskKey, coord: number) => void;
    readonly focusPreviousTaskTitleCoord: (gridKey: TaskGridViewTaskKey, coord: number) => void;
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
    readonly setTaskRowZIndex: (gridKey: TaskGridViewTaskKey, zIndex: number) => () => void;
    readonly scrollToAnchorPosition: () => void;
}>;
