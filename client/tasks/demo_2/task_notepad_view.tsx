import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {TaskGridViewDndContext} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {
    TaskNotepadGridView,
    TaskNotepadGridViewRow,
} from "~/client/tasks/demo_2/internal/task_notepad_grid_view";
import {TaskNotepadViewActiveSection} from "~/client/tasks/demo_2/internal/task_notepad_view_active_section";
import {TaskNotepadViewPaginator} from "~/client/tasks/demo_2/internal/task_notepad_view_paginator";
import {LocalTasksMoveTaskFrom, useLocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {clamp} from "~/shared/helpers/number/clamp";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {tasksStyles} from "~/shared/styles/styles";

// TODO(calebmer): Some stuff this view needs:
//
// - Shift-tab on a task that's about to move keeps it in place then animate
// - Due date
// - Assignee
// - Drag selection should select multiple tasks
// - Select all
// - Undo
// - Save expanded tasks on server for browser so we can re-expand them on reload

export function TaskNotepadView() {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);
    const [state, dispatch] = useLocalTasksState();
    const [notepadPage, setNotepadPage] = useState(state.database.getNotepadPageCount());

    const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<LocalTaskId>>(new Set());

    const clampedNotepadPage = clamp(1, notepadPage, state.database.getNotepadPageCount());
    if (clampedNotepadPage !== notepadPage) setNotepadPage(clampedNotepadPage);

    const moveTaskBelow = (
        belowTaskRow: TaskNotepadGridViewRow | null,
        unnest: number,
        taskRow: TaskNotepadGridViewRow,
    ) => {
        const from: LocalTasksMoveTaskFrom = taskRow.position.isRoot
            ? {type: "Notepad", notepadPage}
            : {type: "ParentTask"};

        if (!belowTaskRow) {
            dispatch({
                type: "MoveTask",
                taskId: taskRow.task.id,
                from,
                to: {
                    type: "Notepad",
                    notepadPage,
                    belowOrderKey: null,
                },
            });
            return;
        }

        const newPosition =
            unnest === 0
                ? belowTaskRow.position
                : belowTaskRow.parentPositionStack[
                      belowTaskRow.parentPositionStack.length - unnest
                  ] ?? belowTaskRow.position;

        dispatch({
            type: "MoveTask",
            taskId: taskRow.task.id,
            from,
            to: newPosition.isRoot
                ? {
                      type: "Notepad",
                      notepadPage: newPosition.notepad.page,
                      belowOrderKey: newPosition.notepad.orderKey,
                  }
                : {
                      type: "ParentTask",
                      parentTaskId: newPosition.parentTask.id,
                      belowOrderKey: newPosition.parentTask.orderKey,
                  },
        });
    };

    const moveTaskToParentTop = (
        parentTaskRow: TaskNotepadGridViewRow,
        taskRow: TaskNotepadGridViewRow,
    ) => {
        dispatch({
            type: "MoveTask",
            taskId: taskRow.task.id,
            from: taskRow.position.isRoot ? {type: "Notepad", notepadPage} : {type: "ParentTask"},
            to: {type: "ParentTask", parentTaskId: parentTaskRow.task.id, belowOrderKey: null},
        });
    };

    return (
        <TaskGridViewDndContext<TaskNotepadGridViewRow>
            getTaskStatus={({task}) => task.status}
            getTaskAssignee={({task}) => task.assignee}
            onTaskAssigneeChange={({task: {id: taskId}}, assignee) =>
                dispatch({type: "UpdateTaskAssignee", taskId, assignee})
            }
            getTaskTitle={({task}) => task.title}
            getTaskRowIndentation={({parentPositionStack}) => parentPositionStack.length}
            moveTaskBelow={moveTaskBelow}
            moveTaskToParentTop={moveTaskToParentTop}
        >
            <Box
                flexGrow="1"
                overflowX="hidden"
                overflowY="scroll"
                backgroundColor="grey-0"
                className={tasksStyles.textCursorNotInheritedClassName}
                {...useOutOfBoundsClickSelection({
                    onSelect: event => {
                        // Only select from clicks on area without children.
                        if (event.target !== event.currentTarget) return;
                        assertExists(gridViewRef.current).focusEnd();
                    },
                    onSelectAll: event => {
                        // Only select from clicks on area without children.
                        if (event.target !== event.currentTarget) return;
                        assertExists(gridViewRef.current).focusEnd();
                    },
                })}
            >
                <Box height="7" />
                <TaskNotepadViewActiveSection state={state} dispatch={dispatch} />
                <Box height="16" />
                <Box
                    paddingX="5"
                    paddingBottom="4"
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Box fontSize="100" fontStyle="semi-bold">
                        Notepad
                    </Box>
                    <TaskNotepadViewPaginator
                        notepadPage={notepadPage}
                        onNotepadPageChange={setNotepadPage}
                        notepadPageCount={state.database.getNotepadPageCount()}
                        onNotepadPageCreate={() => {
                            dispatch({type: "CreateNotepadPage"});
                            setNotepadPage(state.database.getNotepadPageCount() + 1);
                        }}
                    />
                </Box>
                <TaskNotepadGridView
                    // Remount when the notepad page changes...
                    key={notepadPage}
                    ref={gridViewRef}
                    state={state}
                    dispatch={dispatch}
                    notepadPage={notepadPage}
                    expandedTaskIds={expandedTaskIds}
                    setExpandedTaskIds={setExpandedTaskIds}
                    moveTaskBelow={moveTaskBelow}
                    moveTaskToParentTop={moveTaskToParentTop}
                />
            </Box>
        </TaskGridViewDndContext>
    );
}
