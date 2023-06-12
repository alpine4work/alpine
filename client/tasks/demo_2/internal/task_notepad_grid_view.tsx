import {Dispatch, Ref, SetStateAction, forwardRef, useMemo, useRef, useState} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    LocalTask,
    LocalTasksAction,
    LocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewRef,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {useTaskGhostRowPlaceholderTutorial} from "~/client/tasks/demo_2/use_task_ghost_row_placeholder_tutorial";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";

const TaskNotepadGridViewForwardRef = forwardRef(TaskNotepadGridView);
export {TaskNotepadGridViewForwardRef as TaskNotepadGridView};

type TaskNotepadGridViewRowPosition =
    | {
          readonly isRoot: true;
          readonly notepad: {readonly page: number; readonly orderKey: OrderKey};
      }
    | {
          readonly isRoot: false;
          readonly parentTask: {readonly id: LocalTaskId; readonly orderKey: OrderKey};
      };

export type TaskNotepadGridViewRow = {
    readonly position: TaskNotepadGridViewRowPosition;
    readonly parentPositionStack: ReadonlyArray<TaskNotepadGridViewRowPosition>;
    readonly task: LocalTask;
};

function TaskNotepadGridView(
    {
        state,
        dispatch,
        notepadPage,
        expandedTaskIds,
        setExpandedTaskIds,
        moveTaskBelow,
        moveTaskToParentTop,
    }: {
        state: LocalTasksState;
        dispatch: (action: LocalTasksAction) => void;
        notepadPage: number;
        expandedTaskIds: ReadonlySet<LocalTaskId>;
        setExpandedTaskIds: Dispatch<SetStateAction<ReadonlySet<LocalTaskId>>>;
        moveTaskBelow: (
            belowTaskRow: TaskNotepadGridViewRow | null,
            unnest: number,
            taskRow: TaskNotepadGridViewRow,
        ) => void;
        moveTaskToParentTop: (
            parentTaskRow: TaskNotepadGridViewRow,
            taskRow: TaskNotepadGridViewRow,
        ) => void;
    },
    ref: Ref<TaskGridPresentationalViewRef>,
) {
    const {timeZone} = useClientInfo();
    const {space, currentAccount} = useSpaceContext();
    const peekStackContext = usePeekStackContext();
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const tasks = useMemo(
        () => Array.from(state.database.getNotepadPageTasks(notepadPage)),
        [notepadPage, state.database],
    );

    const {taskRowIds, taskRows} = useMemo(() => {
        const taskRowIds = new Set<LocalTaskId>();

        const taskRows: Array<TaskNotepadGridViewRow> = [];

        const addChildTasks = (
            parentPositionStack: ReadonlyArray<TaskNotepadGridViewRowPosition>,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                taskRowIds.add(childTask.id);

                const position: TaskNotepadGridViewRowPosition = {
                    isRoot: false,
                    parentTask: {id: parentTask.id, orderKey},
                };

                taskRows.push({
                    position,
                    parentPositionStack,
                    task: childTask,
                });

                if (expandedTaskIds.has(childTask.id)) {
                    addChildTasks([...parentPositionStack, position], childTask);
                }
            }
        };

        for (const [orderKey, task] of tasks) {
            taskRowIds.add(task.id);

            const position: TaskNotepadGridViewRowPosition = {
                isRoot: true,
                notepad: {page: notepadPage, orderKey},
            };

            taskRows.push({
                position,
                parentPositionStack: [],
                task,
            });

            if (expandedTaskIds.has(task.id)) {
                addChildTasks([position], task);
            }
        }

        return {taskRowIds, taskRows};
    }, [expandedTaskIds, notepadPage, state.database, tasks]);

    // Remove any `expandedTaskIds` that do not exist in `taskIds`. If we a delete
    // a task this is how we update our expanded task IDs set.
    //
    // NOTE(calebmer): This isn't the most efficient! In a production
    // implementation maybe we use `symmetricDiffTree()` to get deleted tasks from
    // our database.
    {
        const newExpandedTaskIds = useMemo(() => {
            let newExpandedTaskIds: Set<LocalTaskId> | null = null;

            for (const taskId of expandedTaskIds) {
                if (!taskRowIds.has(taskId)) {
                    if (!newExpandedTaskIds) newExpandedTaskIds = new Set(expandedTaskIds);
                    newExpandedTaskIds.delete(taskId);
                }
            }

            return newExpandedTaskIds;
        }, [expandedTaskIds, taskRowIds]);

        if (newExpandedTaskIds) {
            setExpandedTaskIds(newExpandedTaskIds);
        }
    }

    const taskRowsRef = useRef(taskRows);
    useLayoutEffectWithoutServerSideWarning(() => {
        taskRowsRef.current = taskRows;
    });

    const {taskGhostRowPlaceholder} = useTaskGhostRowPlaceholderTutorial(taskRows.length);

    // Only show the top ghost row if the component mounts with tasks. Once the top
    // ghost row is consumed it doesn't come back until the component is
    // mounted again.
    const [topTaskGhostRowId, setTopTaskGhostRowId] = useState(() =>
        taskRows.length >= 3 ? generateId<LocalTaskId>() : null,
    );

    if (taskRows.length < 1 && topTaskGhostRowId) setTopTaskGhostRowId(null);

    const [bottomTaskGhostRowId, setBottomTaskGhostRowId] = useState(() =>
        generateId<LocalTaskId>(),
    );

    return (
        <TaskGridPresentationalView<TaskNotepadGridViewRow>
            ref={useMergedRefs(ref, gridViewRef)}
            taskGhostRowPlaceholder={taskGhostRowPlaceholder}
            taskRowCount={taskRows.length}
            getTaskRow={index => taskRows[index]!}
            topGhostTaskKey={topTaskGhostRowId}
            bottomGhostTaskKey={bottomTaskGhostRowId}
            getTaskKey={({task}) => task.id}
            getTaskStatus={({task}) => task.status}
            onTaskStatusChange={({task: {id: taskId}}, status) => {
                dispatch({
                    type: "UpdateTaskStatus",
                    taskId,
                    status,
                });
            }}
            getTaskTitle={({task}) => task.title}
            onTaskTitleChange={({task: {id: taskId}}, title) => {
                dispatch({
                    type: "UpdateTaskTitle",
                    taskId,
                    title,
                });
            }}
            getTaskAssignee={({task}) => task.assignee}
            onTaskAssigneeChange={({task: {id: taskId}}, assignee) => {
                dispatch({
                    type: "UpdateTaskAssignee",
                    taskId,
                    assignee,
                });
            }}
            getTaskParentTaskTitle={({task}) =>
                task.parentTaskId ? state.database.getTask(task.parentTaskId).title : null
            }
            getTaskChildTaskCount={({task}) => task.childTaskIdByOrderKey.size}
            getTaskClosedChildTaskCount={({task}) =>
                reduceIterable(
                    task.childTaskIdByOrderKey.values(),
                    (closedChildTaskCount, childTaskId) =>
                        closedChildTaskCount +
                        (state.database.getTask(childTaskId).status.type === "Closed" ? 1 : 0),
                    0,
                )
            }
            getTaskAreChildTasksCollapsed={({task}) => !expandedTaskIds.has(task.id)}
            onTaskAreChildTasksCollapsedToggle={({task: {id: taskId}}) => {
                setExpandedTaskIds(expandedTaskIds => {
                    const newExpandedTaskIds = new Set(expandedTaskIds);
                    if (!newExpandedTaskIds.delete(taskId)) {
                        newExpandedTaskIds.add(taskId);
                    }
                    return newExpandedTaskIds;
                });
            }}
            onTaskExpand={async ({task: {id: taskId}}) => {
                await peekStackContext.push(`/s/${space.id}/tasks/demo-2/${taskId}`);
            }}
            getTaskRowIndentation={({parentPositionStack}) => parentPositionStack.length}
            createTaskAbove={({position}) => {
                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    ...position,
                    side: "Above",
                });
            }}
            createTaskBelowAndFocus={({position}) => {
                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    ...position,
                    side: "Below",
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(({task}) => task.id === taskId);

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            createTaskChildAtStartAndFocus={({task: {id: taskId}}) => {
                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    parentTask: {id: taskId, side: "Above"},
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(({task}) => task.id === taskId);

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            createTaskAtEndFromBottomGhost={title => {
                // Immediate priority since we want React to batch the
                // `setBottomTaskGhostRowId()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    // Generate a new ghost row...
                    setBottomTaskGhostRowId(generateId<LocalTaskId>());

                    dispatch({
                        type: "CreateTask",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                        taskId: bottomTaskGhostRowId,
                        title,
                        notepad: {page: notepadPage, side: "Below"},
                    });
                });
            }}
            createTaskAtEndFromBottomGhostAndFocusNewGhost={title => {
                // Immediate priority since we want React to batch the
                // `setBottomTaskGhostRowId()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    // Generate a new ghost row...
                    setBottomTaskGhostRowId(generateId<LocalTaskId>());

                    dispatch({
                        type: "CreateTask",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                        taskId: bottomTaskGhostRowId,
                        title,
                        notepad: {page: notepadPage, side: "Below"},
                        onLayoutEffect: () => {
                            gridViewRef.current?.focusEnd();
                        },
                    });
                });
            }}
            createTaskAtStartFromTopGhostWithoutNewGhost={title => {
                if (!topTaskGhostRowId) return;

                // Immediate priority since we want React to batch the
                // `setTopTaskGhostRowId()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    // Don't create a new top ghost row.
                    setTopTaskGhostRowId(null);

                    dispatch({
                        type: "CreateTask",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                        taskId: topTaskGhostRowId,
                        title,
                        notepad: {page: notepadPage, side: "Above"},
                    });
                });
            }}
            createTaskAtStartFromTopGhostAndFocus={title => {
                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    title,
                    notepad: {page: notepadPage, side: "Above"},
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(({task}) => task.id === taskId);

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            nestTaskAndExpandParentRow={({task: {id: parentTaskId}}, {task: {id: childTaskId}}) => {
                // Immediate priority since we want React to batch the
                // `setExpandedChildTaskIds()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    dispatch({
                        type: "NestTask",
                        parentTaskId,
                        childTaskId,
                    });

                    setExpandedTaskIds(expandedTaskIds => {
                        const newExpandedTaskIds = new Set(expandedTaskIds);
                        newExpandedTaskIds.add(parentTaskId);
                        return newExpandedTaskIds;
                    });
                });
            }}
            unnestTaskIfNestedRow={({parentPositionStack, task: {id: childTaskId}}) => {
                const parentPosition = parentPositionStack[parentPositionStack.length - 1] ?? null;

                if (parentPosition) {
                    if (parentPosition.isRoot) {
                        dispatch({
                            type: "MoveTaskToNotepad",
                            notepadPage: parentPosition.notepad.page,
                            belowOrderKey: parentPosition.notepad.orderKey,
                            taskId: childTaskId,
                        });
                    } else {
                        dispatch({
                            type: "MoveTaskToParentTask",
                            parentTaskId: parentPosition.parentTask.id,
                            belowOrderKey: parentPosition.parentTask.orderKey,
                            taskId: childTaskId,
                        });
                    }
                }
            }}
            deleteTaskAndAllChildrenAndFocusPreviousRow={({task: {id: taskId}}) => {
                // TODO(calebmer): A production implementation probably shouldn't do an
                // O(n) loop here.
                const oldIndex = taskRowsRef.current.findIndex(({task}) => task.id === taskId);

                dispatch({
                    type: "DeleteTaskAndAllChildren",
                    taskId,
                    onLayoutEffect: () => {
                        if (taskRowsRef.current.length === 0 || oldIndex === 0) {
                            gridViewRef.current?.focusStart();
                        } else {
                            gridViewRef.current?.focusTaskRowTitleEnd(oldIndex - 1);
                        }
                    },
                });
            }}
            moveTaskBelow={moveTaskBelow}
            moveTaskToParentTop={moveTaskToParentTop}
        />
    );
}
