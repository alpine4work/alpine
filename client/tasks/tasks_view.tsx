import {Key, useMemo, useRef} from "react";
import {Box} from "~/client/design/box";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useLocalTasksState} from "~/client/tasks/local_tasks_state";
import {TaskRow, TaskRowView, TaskRowViewRef} from "~/client/tasks/task_row_view";
import {NotFoundError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

// TODO(calebmer): Some stuff this view needs:
//
// - Delete in an empty task
// - Arrow navigation
// - Gradient for input overflow
// - Undo
// - Select all
//
// Generally I should overview a list of document shortcuts and keyboard
// shortcuts and incorporate all that make sense.

export function TasksView() {
    const [state, dispatch] = useLocalTasksState();

    const tasks = useMemo(
        () =>
            Array.from(state.taskIdByOrderKey.values(), taskId =>
                assertExists(state.taskById.get(taskId)),
            ),
        [state.taskById, state.taskIdByOrderKey],
    );

    const taskRows = useMemo(() => {
        const taskRows: Array<TaskRow> = [];

        for (const task of tasks) {
            taskRows.push({type: "Normal", task});
        }

        taskRows.push({type: "InteractiveGhost", ghostTaskId: state.ghostTaskId});
        if (tasks.length <= 1) taskRows.push({type: "DecorativeGhost"});
        if (tasks.length <= 0) taskRows.push({type: "DecorativeGhost"});

        return taskRows;
    }, [state.ghostTaskId, tasks]);

    const taskRowByIndexRef = useRef(new Map<number, TaskRowViewRef>());

    // If our start had a ref instructing us to focus a task, then consume that ref
    // and focus the corresponding task.
    useLayoutEffectWithoutServerSideWarning(() => {
        const focusTask = state.focusTaskRef.current;
        if (!focusTask) return;
        state.focusTaskRef.current = null;

        let index: number;

        // TODO(calebmer): It's hard to remember to always check for ghost tasks. Can
        // we abstract this somehow?
        if (focusTask.taskId === state.ghostTaskId) {
            index = tasks.length;
        } else {
            const task = state.taskById.get(focusTask.taskId);
            if (!task) throw new NotFoundError("Task not found");
            index = assertExists(state.taskIdByOrderKey.getIndexByKey(task.orderKey));
        }

        if (focusTask.direction === "Start") {
            assertExists(taskRowByIndexRef.current.get(index)).focusStart();
        } else {
            assertExists(taskRowByIndexRef.current.get(index)).focusEnd();
        }
    }, [
        state.focusTaskRef,
        state.ghostTaskId,
        state.taskById,
        state.taskIdByOrderKey,
        tasks.length,
    ]);

    return (
        <Box
            flexGrow="1"
            backgroundColor="grey-0"
            // Create an illusion that our tasks view is a text editor that extends into
            // the margins by giving the margin a text cursor and making it clickable
            // which puts focus in the task.
            //
            // This is an affordance for mouse users, does not need to be usable
            // by keyboard.
            cursor="text"
            onClick={event => {
                // Only handle clicks on the background not covered by content.
                if (event.target === event.currentTarget && taskRows.length > 0) {
                    assertExists(taskRowByIndexRef.current.get(taskRows.length - 1)).focusEnd();
                }
            }}
        >
            <Box
                height="9"
                width="full"
                cursor="text"
                // Create an illusion that our tasks view is a text editor that extends into
                // the margins by giving the margin a text cursor and making it clickable
                // which puts focus in the task.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                onClick={() => {
                    if (taskRows.length > 0) {
                        assertExists(taskRowByIndexRef.current.get(0)).focusStart();
                    }
                }}
            />
            {taskRows.map((row, index) => (
                <TaskRowView
                    ref={instance => {
                        if (instance !== null) {
                            taskRowByIndexRef.current.set(index, instance);
                        } else {
                            taskRowByIndexRef.current.delete(index);
                        }
                    }}
                    key={getTaskRowKey(row, index)}
                    row={row}
                    rowIndex={index}
                    dispatch={dispatch}
                    onPreviousRowFocusEnd={() => {
                        if (index > 0) {
                            assertExists(taskRowByIndexRef.current.get(index - 1)).focusEnd();
                        }
                    }}
                />
            ))}
        </Box>
    );
}

function getTaskRowKey(row: TaskRow, index: number): Key {
    switch (row.type) {
        case "Normal":
            return row.task.id;
        case "InteractiveGhost":
            return row.ghostTaskId;
        case "DecorativeGhost":
            return index;
        default:
            throw exhaustive(row);
    }
}
