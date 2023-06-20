import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {TaskGridViewDndContext} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {
    TaskNotepadGridView,
    TaskNotepadGridViewRow,
} from "~/client/tasks/demo_2/internal/task_notepad_grid_view";
import {TaskNotepadViewActiveSection} from "~/client/tasks/demo_2/internal/task_notepad_view_active_section";
import {TaskNotepadViewPaginator} from "~/client/tasks/demo_2/internal/task_notepad_view_paginator";
import {
    LocalTasksAction,
    LocalTasksMoveTaskFrom,
    LocalTasksState,
    useLocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {tasksStyles} from "~/shared/styles/styles";

export function TaskNotepadView() {
    const [state, dispatch] = useLocalTasksState();
    const [notepadPageId, setNotepadPageId] = useState(state.database.getLatestNotepadPageId());

    useEffect(() => {
        if (notepadPageId === null) {
            const newNotepadPageId = Math.floor(Date.now() / 1000);
            dispatch({type: "CreateNotepadPage", notepadPageId: newNotepadPageId});
            setNotepadPageId(newNotepadPageId);
        }
    }, [dispatch, notepadPageId]);

    if (notepadPageId === null) return <Box flexGrow="1" backgroundColor="grey-0" />;

    return (
        <TaskNotepadViewInner
            state={state}
            dispatch={dispatch}
            notepadPageId={notepadPageId}
            setNotepadPageId={setNotepadPageId}
        />
    );
}

function TaskNotepadViewInner({
    state,
    dispatch,
    notepadPageId,
    setNotepadPageId,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    notepadPageId: number;
    setNotepadPageId: (notepadPageId: number) => void;
}) {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);
    const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<LocalTaskId>>(new Set());

    const moveTaskBelow = (
        belowTaskRow: TaskNotepadGridViewRow | null,
        unnest: number,
        taskRow: TaskNotepadGridViewRow,
    ) => {
        const from: LocalTasksMoveTaskFrom = taskRow.position.isRoot
            ? {type: "Notepad", notepadPageId}
            : {type: "ParentTask"};

        if (!belowTaskRow) {
            dispatch({
                type: "MoveTask",
                taskId: taskRow.task.id,
                from,
                to: {
                    type: "Notepad",
                    notepadPageId,
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
                      notepadPageId: newPosition.notepad.pageId,
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
            from: taskRow.position.isRoot ? {type: "Notepad", notepadPageId} : {type: "ParentTask"},
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
                    onSelect: () => assertExists(gridViewRef.current).focusEnd(),
                    onSelectAll: () => assertExists(gridViewRef.current).focusEnd(),
                })}
            >
                <Box height="5" />
                <TaskNotepadViewActiveSection state={state} dispatch={dispatch} />
                <Box height="16" />
                <Box
                    paddingX="5"
                    paddingBottom="6"
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Box fontSize="100" fontStyle="semi-bold">
                        Notepad
                    </Box>
                    <TaskNotepadViewPaginator
                        state={state}
                        dispatch={dispatch}
                        notepadPageId={notepadPageId}
                        onNotepadPageIdChange={setNotepadPageId}
                    />
                </Box>
                <TaskNotepadGridView
                    // Remount when the notepad page changes...
                    key={notepadPageId}
                    ref={gridViewRef}
                    state={state}
                    dispatch={dispatch}
                    notepadPageId={notepadPageId}
                    expandedTaskIds={expandedTaskIds}
                    setExpandedTaskIds={setExpandedTaskIds}
                    moveTaskBelow={moveTaskBelow}
                    moveTaskToParentTop={moveTaskToParentTop}
                />
                <Box height="5" pointerEvents="none" />
            </Box>
        </TaskGridViewDndContext>
    );
}
