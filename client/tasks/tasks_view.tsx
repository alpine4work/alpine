import {useMemo, useRef} from "react";
import {Box} from "~/client/design/box";
import {useLocalTasksState} from "~/client/tasks/local_tasks_state";
import {TaskRow, TaskRowView, TaskRowViewRef, getTaskRowKey} from "~/client/tasks/task_row_view";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";

export function TasksView() {
    const [state, dispatch] = useLocalTasksState();

    const tasks = useMemo(
        () =>
            Array.from(state.taskById.values()).sort((task1, task2) =>
                defaultCompareStrings(task1.orderKey, task2.orderKey),
            ),
        [state.taskById],
    );

    const taskRows = useMemo(() => {
        const taskRows: Array<TaskRow> = [];

        taskRows.push({type: "InteractiveGhost", ghostTaskId: state.ghostTaskId});
        taskRows.push({type: "DecorativeGhost"});
        taskRows.push({type: "DecorativeGhost"});

        return taskRows;
    }, [state.ghostTaskId]);

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
                    isFirstRow={index === 0}
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
