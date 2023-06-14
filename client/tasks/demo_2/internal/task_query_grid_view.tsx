import {Ref, forwardRef, useMemo, useRef, useState} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {useSpaceContext} from "~/client/spaces/space_context";
import {normalizeTaskQueryFilters} from "~/client/tasks/demo_2/internal/normalize_task_query_filters";
import {
    LocalTask,
    LocalTasksAction,
    LocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewRef,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {TaskQuerySort} from "~/client/tasks/demo_2/task_query_sort";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";

type TaskQueryGridViewRowPosition =
    | {
          readonly isRoot: true;
      }
    | {
          readonly isRoot: false;
          readonly parentTask: {readonly id: LocalTaskId; readonly orderKey: OrderKey};
      };

export type TaskQueryGridViewRow = {
    readonly position: TaskQueryGridViewRowPosition;
    readonly parentPositionStack: ReadonlyArray<TaskQueryGridViewRowPosition>;
    readonly task: LocalTask;
};

const TaskQueryGridViewForwardRef = forwardRef(TaskQueryGridView);
export {TaskQueryGridViewForwardRef as TaskQueryGridView};

function TaskQueryGridView(
    {
        state,
        dispatch,
        filters,
        sorts,
    }: {
        state: LocalTasksState;
        dispatch: (action: LocalTasksAction) => void;
        filters: ReadonlyArray<TaskQueryFilter>;
        sorts: ReadonlyArray<TaskQuerySort>;
    },
    ref: Ref<TaskGridPresentationalViewRef>,
) {
    const {timeZone} = useClientInfo();
    const currentDate = useCurrentDate();
    const {currentAccount, space} = useSpaceContext();
    const peekStackContext = usePeekStackContext();
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const tasks = useMemo(() => {
        return state.database.queryAllTasks(filters, sorts, {
            currentAccountId: currentAccount.id,
            currentDate,
        });
    }, [currentAccount.id, currentDate, filters, sorts, state.database]);

    const [expandedTaskIds, setExpandedTaskIds] = useState(new Set<LocalTaskId>());

    const {taskRowIds, taskRows} = useMemo(() => {
        const taskRowIds = new Set<LocalTaskId>();

        const taskRows: Array<TaskQueryGridViewRow> = [];

        const addChildTasks = (
            parentPositionStack: ReadonlyArray<TaskQueryGridViewRowPosition>,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                taskRowIds.add(childTask.id);

                const position: TaskQueryGridViewRowPosition = {
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

        for (const task of tasks) {
            taskRowIds.add(task.id);

            const position: TaskQueryGridViewRowPosition = {
                isRoot: true,
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
    }, [expandedTaskIds, state.database, tasks]);

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
        <TaskGridPresentationalView<TaskQueryGridViewRow>
            ref={useMergedRefs(ref, gridViewRef)}
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
            shouldShowParentTaskTitle={true}
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
                const normalizeResult = normalizeTaskQueryFilters(filters, {
                    currentAccountId: currentAccount.id,
                    currentDate,
                });

                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    normalizedFilters:
                        normalizeResult.type === "Possible"
                            ? normalizeResult.normalizedFilters
                            : null,
                    ...position,
                    side: "Above",
                });
            }}
            createTaskBelowAndFocus={({position, parentPositionStack}) => {
                const normalizeResult = normalizeTaskQueryFilters(filters, {
                    currentAccountId: currentAccount.id,
                    currentDate,
                });

                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    normalizedFilters:
                        normalizeResult.type === "Possible"
                            ? normalizeResult.normalizedFilters
                            : null,
                    ...position,
                    side: "Below",
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(
                            taskRow =>
                                taskRow.task.id === taskId &&
                                taskRow.parentPositionStack.length === parentPositionStack.length,
                        );

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            createTaskChildAtStartAndFocus={({task: {id: taskId}, parentPositionStack}) => {
                const normalizeResult = normalizeTaskQueryFilters(filters, {
                    currentAccountId: currentAccount.id,
                    currentDate,
                });

                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    normalizedFilters:
                        normalizeResult.type === "Possible"
                            ? normalizeResult.normalizedFilters
                            : null,
                    parentTask: {id: taskId, side: "Above"},
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(
                            taskRow =>
                                taskRow.task.id === taskId &&
                                taskRow.parentPositionStack.length ===
                                    parentPositionStack.length + 1,
                        );

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            createTaskAtEndFromBottomGhost={title => {
                // Immediate priority since we want React to batch the
                // `setBottomTaskGhostRowId()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    const normalizeResult = normalizeTaskQueryFilters(filters, {
                        currentAccountId: currentAccount.id,
                        currentDate,
                    });

                    // Generate a new ghost row...
                    setBottomTaskGhostRowId(generateId<LocalTaskId>());

                    dispatch({
                        type: "CreateTask",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                        normalizedFilters:
                            normalizeResult.type === "Possible"
                                ? normalizeResult.normalizedFilters
                                : null,
                        taskId: bottomTaskGhostRowId,
                        title,
                        // NOCOMMIT: Do an equivalent thing here?
                        // notepad: {page: notepadPage, side: "Below"},
                    });
                });
            }}
            createTaskAtEndFromBottomGhostAndFocusNewGhost={title => {
                // Immediate priority since we want React to batch the
                // `setBottomTaskGhostRowId()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    const normalizeResult = normalizeTaskQueryFilters(filters, {
                        currentAccountId: currentAccount.id,
                        currentDate,
                    });

                    // Generate a new ghost row...
                    setBottomTaskGhostRowId(generateId<LocalTaskId>());

                    dispatch({
                        type: "CreateTask",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                        normalizedFilters:
                            normalizeResult.type === "Possible"
                                ? normalizeResult.normalizedFilters
                                : null,
                        taskId: bottomTaskGhostRowId,
                        title,
                        // NOCOMMIT: Do an equivalent thing here?
                        // notepad: {page: notepadPage, side: "Below"},
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
                    const normalizeResult = normalizeTaskQueryFilters(filters, {
                        currentAccountId: currentAccount.id,
                        currentDate,
                    });

                    // Don't create a new top ghost row.
                    setTopTaskGhostRowId(null);

                    dispatch({
                        type: "CreateTask",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                        normalizedFilters:
                            normalizeResult.type === "Possible"
                                ? normalizeResult.normalizedFilters
                                : null,
                        taskId: topTaskGhostRowId,
                        title,
                        // NOCOMMIT: Do an equivalent thing here?
                        // notepad: {page: notepadPage, side: "Below"},
                    });
                });
            }}
            createTaskAtStartFromTopGhostAndFocus={title => {
                const normalizeResult = normalizeTaskQueryFilters(filters, {
                    currentAccountId: currentAccount.id,
                    currentDate,
                });

                dispatch({
                    type: "CreateTask",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                    normalizedFilters:
                        normalizeResult.type === "Possible"
                            ? normalizeResult.normalizedFilters
                            : null,
                    title,
                    // NOCOMMIT: Do an equivalent thing here?
                    // notepad: {page: notepadPage, side: "Below"},
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(({task}) => task.id === taskId);

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            nestTaskAndExpandParentRow={(
                {task: {id: parentTaskId}},
                {task: {id: childTaskId}},
                titleSelection,
                newIndentation,
            ) => {
                // Immediate priority since we want React to batch the
                // `setExpandedChildTaskIds()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    // NOCOMMIT: Do an equivalent thing here?
                    // dispatch({
                    //     type: "NestTask",
                    //     parentTaskId,
                    //     childTaskId,
                    //     onLayoutEffect: () => {
                    //         // TODO(calebmer): A production implementation probably shouldn't do an
                    //         // O(n) loop here.
                    //         const newIndex = taskRowsRef.current.findIndex(
                    //             ({task, parentPositionStack}) =>
                    //                 task.id === childTaskId &&
                    //                 parentPositionStack.length === newIndentation,
                    //         );
                    //
                    //         if (newIndex >= 0) {
                    //             gridViewRef.current?.focusTaskRowTitleSelection(
                    //                 newIndex,
                    //                 titleSelection,
                    //             );
                    //         }
                    //     },
                    // });
                    //
                    // setExpandedTaskIds(expandedTaskIds => {
                    //     const newExpandedTaskIds = new Set(expandedTaskIds);
                    //     newExpandedTaskIds.add(parentTaskId);
                    //     return newExpandedTaskIds;
                    // });
                });
            }}
            unnestTaskIfNestedRow={(
                {parentPositionStack, task: {id: childTaskId}},
                titleSelection,
            ) => {
                const parentPosition = parentPositionStack[parentPositionStack.length - 1] ?? null;

                const onLayoutEffect = () => {
                    // TODO(calebmer): A production implementation probably shouldn't do an
                    // O(n) loop here.
                    const newIndex = taskRowsRef.current.findIndex(
                        ({task, parentPositionStack: otherParentPositionStack}) =>
                            task.id === childTaskId &&
                            otherParentPositionStack.length === parentPositionStack.length - 1,
                    );

                    if (newIndex >= 0) {
                        gridViewRef.current?.focusTaskRowTitleSelection(newIndex, titleSelection);
                    }
                };

                // NOCOMMIT: Do an equivalent thing here?
                // if (parentPosition) {
                //     if (parentPosition.isRoot) {
                //         dispatch({
                //             type: "MoveTaskToNotepad",
                //             notepadPage: parentPosition.notepad.page,
                //             belowOrderKey: parentPosition.notepad.orderKey,
                //             taskId: childTaskId,
                //             onLayoutEffect,
                //         });
                //     } else {
                //         dispatch({
                //             type: "MoveTaskToParentTask",
                //             parentTaskId: parentPosition.parentTask.id,
                //             belowOrderKey: parentPosition.parentTask.orderKey,
                //             taskId: childTaskId,
                //             onLayoutEffect,
                //         });
                //     }
                // }
            }}
            deleteTaskAndAllChildrenAndFocusPreviousRow={({
                task: {id: taskId},
                parentPositionStack,
            }) => {
                // TODO(calebmer): A production implementation probably shouldn't do an
                // O(n) loop here.
                const oldIndex = taskRowsRef.current.findIndex(
                    taskRow =>
                        taskRow.task.id === taskId &&
                        taskRow.parentPositionStack.length === parentPositionStack.length,
                );

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
            moveTaskBelow={(belowTaskRow, unnest, taskRow) => {
                if (!belowTaskRow) {
                    // NOCOMMIT: Do an equivalent thing here?
                    // dispatch({
                    //     type: "MoveTaskToNotepad",
                    //     notepadPage: notepadPage,
                    //     belowOrderKey: null,
                    //     taskId: taskRow.task.id,
                    // });
                    return;
                }

                const position =
                    unnest === 0
                        ? belowTaskRow.position
                        : belowTaskRow.parentPositionStack[
                              belowTaskRow.parentPositionStack.length - unnest
                          ] ?? belowTaskRow.position;

                // NOCOMMIT: Do an equivalent thing here?
                // if (position.isRoot) {
                //     dispatch({
                //         type: "MoveTaskToNotepad",
                //         notepadPage: position.notepad.page,
                //         belowOrderKey: position.notepad.orderKey,
                //         taskId: taskRow.task.id,
                //     });
                // } else {
                //     dispatch({
                //         type: "MoveTaskToParentTask",
                //         parentTaskId: position.parentTask.id,
                //         belowOrderKey: position.parentTask.orderKey,
                //         taskId: taskRow.task.id,
                //     });
                // }
            }}
            moveTaskToParentTop={(parentTaskRow, taskRow) => {
                // NOCOMMIT: Do an equivalent thing here?
                // dispatch({
                //     type: "MoveTaskToParentTask",
                //     parentTaskId: parentTaskRow.task.id,
                //     belowOrderKey: null,
                //     taskId: taskRow.task.id,
                // });
            }}
        />
    );
}
