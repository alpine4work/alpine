import {Key, useMemo, useRef} from "react";
import {Box} from "~/client/design/box";
import {useLocalTasksState} from "~/client/tasks/local_tasks_state";
import {TaskRow, TaskRowView, TaskRowViewRef} from "~/client/tasks/task_row_view";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

// TODO(calebmer): Some stuff this view needs:
//
// - Delete in an empty task
// - Arrow navigation
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
