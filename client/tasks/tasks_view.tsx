import {Key, RefObject, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {LocalTask, useLocalTasksState} from "~/client/tasks/internal/local_tasks_state";
import {TaskRow} from "~/client/tasks/internal/task_row";
import {TaskRowView, TaskRowViewRef} from "~/client/tasks/internal/task_row_view";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {LazyMap} from "~/shared/helpers/control/lazy_map";
import {LocalTaskId} from "~/shared/id/types/id_types";

// TODO(calebmer): Some stuff this view needs:
//
// - Subtasks
// - Arrow navigation not working quite right with subtasks
// - Open/close button
// - Drag to reorder
// - Due date
// - Assignee
// - Drag selection should select multiple tasks
// - Select all
// - Undo
//
// Generally I should overview a list of document shortcuts and keyboard
// shortcuts and incorporate all that make sense.

/**
 * The first couple times you add tasks we show a short tutorial in the
 * placeholder of the ghost row. These are the entries in that tutorial.
 */
const taskGhostRowPlaceholderTutorial = [
    "Click to add a task…",
    "Press enter to add another task…",
    "Press tab to convert into a subtask…",
    "Keep adding tasks…",
];

export function TasksView() {
    const [state, dispatch] = useLocalTasksState();

    const {taskRows, normalTaskRowCount} = useMemo(() => {
        const taskRows: Array<TaskRow> = [];

        const addTasks = (parentStack: ReadonlyArray<LocalTask>, taskId: LocalTaskId) => {
            const task = assertExists(state.taskById.get(taskId));
            taskRows.push({type: "Normal", parentStack, task});

            parentStack = [...parentStack, task];

            for (const taskId of task.childTaskIdByOrderKey.values()) {
                addTasks(parentStack, taskId);
            }
        };

        for (const taskId of state.rootTaskIdByOrderKey.values()) {
            addTasks([], taskId);
        }

        const normalTaskRowCount = taskRows.length;

        taskRows.push({type: "InteractiveGhost", ghostTaskId: state.ghostTaskId});
        if (normalTaskRowCount <= 1) taskRows.push({type: "DecorativeGhost"});
        if (normalTaskRowCount <= 0) taskRows.push({type: "DecorativeGhost"});

        return {taskRows, normalTaskRowCount};
    }, [state.ghostTaskId, state.rootTaskIdByOrderKey, state.taskById]);

    const taskRowRefByIndex = useConstant(
        () => new LazyMap<number, RefObject<TaskRowViewRef>>(() => ({current: null})),
    );

    // If our start had a ref instructing us to focus a task, then consume that ref
    // and focus the corresponding task.
    useLayoutEffectWithoutServerSideWarning(() => {
        const taskEffect = state.taskEffectRef.current;
        if (!taskEffect) return;
        state.taskEffectRef.current = null;

        // NOCOMMIT: Reimplement

        // let index: number;

        // // TODO(calebmer): It's hard to remember to always check for ghost tasks. Can
        // // we abstract this somehow?
        // if (taskEffect.taskId === state.ghostTaskId) {
        //     index = rootTasks.length;
        // } else {
        //     const task = state.taskById.get(taskEffect.taskId);
        //     if (!task) throw new NotFoundError("Task not found");
        //     index = assertExists(state.rootTaskIdByOrderKey.getIndexByKey(task.orderKey));
        // }

        // taskEffect.effect(assertExists(taskRowRefByIndex.get(index).current));
    }, [
        state.taskEffectRef,
        state.ghostTaskId,
        state.taskById,
        state.rootTaskIdByOrderKey,
        taskRowRefByIndex,
    ]);

    /* ========================================================================== *\
     *                      Ghost row placeholder tutorial                        *
    \* ========================================================================== */

    const [
        shouldShowTaskGhostRowPlaceholderTutorial,
        setShouldShowTaskGhostRowPlaceholderTutorial,
    ] = useState(normalTaskRowCount === 0);

    // If the user deletes all their tasks then show the placeholder
    // tutorial again.
    if (normalTaskRowCount === 0 && !shouldShowTaskGhostRowPlaceholderTutorial) {
        setShouldShowTaskGhostRowPlaceholderTutorial(true);
    }

    // Once we complete the tutorial we shouldn't show it again if the user starts
    // deleting tasks. Unless the user deletes all their tasks.
    if (
        normalTaskRowCount >= taskGhostRowPlaceholderTutorial.length &&
        shouldShowTaskGhostRowPlaceholderTutorial
    ) {
        setShouldShowTaskGhostRowPlaceholderTutorial(false);
    }

    const taskGhostRowPlaceholder =
        shouldShowTaskGhostRowPlaceholderTutorial &&
        normalTaskRowCount < taskGhostRowPlaceholderTutorial.length
            ? taskGhostRowPlaceholderTutorial[normalTaskRowCount]!
            : "Add a task…";

    /* ========================================================================== *\
     *                            Arrow key navigation                            *
    \* ========================================================================== */

    const lastArrowNavigationXRef = useRef<{setTime: Date; x: number} | null>(null);

    // Clear the last arrow navigation X position whenever the user's caret moves
    // somewhere else.
    useEffect(() => {
        const clearLastArrowNavigationX = () => {
            if (
                lastArrowNavigationXRef.current &&
                // If we just set this ref, don't clear it. We're processing browser events
                // that happened because of the arrow navigation.
                new Date().getTime() - lastArrowNavigationXRef.current.setTime.getTime() > 10
            ) {
                lastArrowNavigationXRef.current = null;
            }
        };

        document.addEventListener("focus", clearLastArrowNavigationX);
        document.addEventListener("blur", clearLastArrowNavigationX);
        document.addEventListener("selectionchange", clearLastArrowNavigationX);
        return () => {
            document.removeEventListener("focus", clearLastArrowNavigationX);
            document.removeEventListener("blur", clearLastArrowNavigationX);
            document.removeEventListener("selectionchange", clearLastArrowNavigationX);
        };
    }, []);

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
                    const taskRowView = assertExists(
                        taskRowRefByIndex.get(taskRows.length - 1).current,
                    );
                    taskRowView.focusTitleEnd();
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
                        assertExists(taskRowRefByIndex.get(0).current).focusTitleStart();
                    }
                }}
            />
            {taskRows.map((taskRow, index) => (
                <TaskRowView
                    ref={taskRowRefByIndex.get(index)}
                    key={getTaskRowKey(taskRow, index)}
                    taskRow={taskRow}
                    nextTaskRow={index < taskRows.length - 1 ? taskRows[index + 1]! : null}
                    nextTaskRowRef={taskRowRefByIndex.get(index + 1)}
                    previousTaskRow={index > 0 ? taskRows[index - 1]! : null}
                    previousTaskRowRef={taskRowRefByIndex.get(index - 1)}
                    firstTaskRowRef={taskRowRefByIndex.get(0)}
                    lastTaskRowRef={taskRowRefByIndex.get(taskRows.length - 1)}
                    taskGhostRowPlaceholder={taskGhostRowPlaceholder}
                    lastArrowNavigationXRef={lastArrowNavigationXRef}
                    dispatch={dispatch}
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
