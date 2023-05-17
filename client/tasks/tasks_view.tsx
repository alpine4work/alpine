import {Key, RefCallback, useMemo, useRef} from "react";
import {Box} from "~/client/design/box";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useLocalTasksState} from "~/client/tasks/local_tasks_state";
import {TaskRow, TaskRowView, TaskRowViewRef} from "~/client/tasks/task_row_view";
import {NotFoundError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {LazyMap} from "~/shared/helpers/control/lazy_map";

// TODO(calebmer): Some stuff this view needs:
//
// - Delete in an empty task (backspace and delete keys)
// - Arrow navigation
// - Gradient for input overflow
// - Subtasks
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

    const taskRowByIndexRefCallbacks = useMemo(
        () =>
            new LazyMap<number, RefCallback<TaskRowViewRef>>(index => instance => {
                if (instance !== null) {
                    taskRowByIndexRef.current.set(index, instance);
                } else {
                    taskRowByIndexRef.current.delete(index);
                }
            }),
        [],
    );

    // If our start had a ref instructing us to focus a task, then consume that ref
    // and focus the corresponding task.
    useLayoutEffectWithoutServerSideWarning(() => {
        const taskEffect = state.taskEffectRef.current;
        if (!taskEffect) return;
        state.taskEffectRef.current = null;

        let index: number;

        // TODO(calebmer): It's hard to remember to always check for ghost tasks. Can
        // we abstract this somehow?
        if (taskEffect.taskId === state.ghostTaskId) {
            index = tasks.length;
        } else {
            const task = state.taskById.get(taskEffect.taskId);
            if (!task) throw new NotFoundError("Task not found");
            index = assertExists(state.taskIdByOrderKey.getIndexByKey(task.orderKey));
        }

        taskEffect.effect(assertExists(taskRowByIndexRef.current.get(index)));
    }, [
        state.taskEffectRef,
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
                    ref={taskRowByIndexRefCallbacks.get(index)}
                    key={getTaskRowKey(row, index)}
                    row={row}
                    rowIndex={index}
                    nextTaskRow={index < taskRows.length - 1 ? taskRows[index + 1]! : null}
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
