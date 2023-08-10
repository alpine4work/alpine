import {Ref, forwardRef, useMemo, useRef, useState} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/demo_2/internal/task_delete_confirmation_modal_dialog.js";
import {
    LocalTask,
    LocalTasksAction,
    LocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state.js";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewRef,
    minTaskCountToShowTopGhostTask,
} from "~/client/tasks/demo_2/task_grid_presentational_view.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {LocalTaskId} from "~/shared/id/types/id_types.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";

// NOCOMMIT: Don't allow tab to indent for tasks that have a parent displayed.
// This can cause weird re-parenting operations. If the user hits tab maybe
// wiggle the parent as an explanation of why it's not allowed.

// NOCOMMIT: Don't allow tab to indent at all if the tasks aren't manually
// orderable? I would like some kind of interaction when the user hits tab to
// let them know it's disabled in queries. Maybe we show the drag handle when
// the task is focused and movable?

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

    const [expandedTaskIds, setExpandedTaskIds] = useState(new Set<`${LocalTaskId}-${number}`>());

    const taskRows = useMemo(() => {
        const taskRows: Array<TaskQueryGridViewRow> = [];

        const addChildTasks = (
            parentPositionStack: ReadonlyArray<TaskQueryGridViewRowPosition>,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                const position: TaskQueryGridViewRowPosition = {
                    isRoot: false,
                    parentTask: {id: parentTask.id, orderKey},
                };

                taskRows.push({
                    position,
                    parentPositionStack,
                    task: childTask,
                });

                if (expandedTaskIds.has(`${childTask.id}-${parentPositionStack.length}`)) {
                    addChildTasks([...parentPositionStack, position], childTask);
                }
            }
        };

        for (const task of tasks) {
            const position: TaskQueryGridViewRowPosition = {
                isRoot: true,
            };

            taskRows.push({
                position,
                parentPositionStack: [],
                task,
            });

            if (expandedTaskIds.has(`${task.id}-0`)) {
                addChildTasks([position], task);
            }
        }

        return taskRows;
    }, [expandedTaskIds, state.database, tasks]);

    const taskRowsRef = useRef(taskRows);
    useLayoutEffectWithoutServerSideWarning(() => {
        taskRowsRef.current = taskRows;
    });

    // Only show the top ghost row if the component mounts with tasks. Once the top
    // ghost row is consumed it doesn't come back until the component is
    // mounted again.
    const [topTaskGhostRowId, setTopTaskGhostRowId] = useState(() =>
        taskRows.length >= minTaskCountToShowTopGhostTask ? generateId<LocalTaskId>() : null,
    );

    if (taskRows.length < 1 && topTaskGhostRowId) setTopTaskGhostRowId(null);

    const [bottomTaskGhostRowId, setBottomTaskGhostRowId] = useState(() =>
        generateId<LocalTaskId>(),
    );

    const [showDeleteConfirmationForTaskId, setShowDeleteConfirmationForTaskId] =
        useState<LocalTaskId | null>(null);

    return (
        <>
            <TaskGridPresentationalView<TaskQueryGridViewRow>
                ref={useMergedRefs(ref, gridViewRef)}
                capabilities={useMemo(
                    () => ({
                        hasParentTaskTitle: true,
                        hasColumns: true,
                        hasMultilineTitle: false,
                        hasDenseAssigneeAndDueDate: false,
                    }),
                    [],
                )}
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
                getTaskPriority={({task}) => task.priority}
                onTaskPriorityChange={({task: {id: taskId}}, priority) => {
                    dispatch({
                        type: "UpdateTaskPriority",
                        taskId,
                        priority,
                    });
                }}
                getTaskDueDate={({task}) => task.dueDate}
                onTaskDueDateChange={({task: {id: taskId}}, dueDate) => {
                    dispatch({
                        type: "UpdateTaskDueDate",
                        taskId,
                        dueDate,
                    });
                }}
                allCollections={useMemo(
                    () => state.database.getAllTaskCollections(),
                    [state.database],
                )}
                getTaskCollections={({task}) =>
                    Array.from(task.collectionIds, collectionId =>
                        state.database.getTaskCollection(collectionId),
                    )
                }
                createCollectionAndAddToTask={({task: {id: taskId}}, taskCollection) =>
                    dispatch({type: "CreateTaskCollectionAndAddToTask", taskId, taskCollection})
                }
                addCollectionToTask={({task: {id: taskId}}, taskCollectionId) =>
                    dispatch({type: "AddTaskCollectionToTask", taskId, taskCollectionId})
                }
                removeCollectionFromTask={({task: {id: taskId}}, taskCollectionId) =>
                    dispatch({type: "RemoveTaskCollectionFromTask", taskId, taskCollectionId})
                }
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
                getTaskAreChildTasksCollapsed={({task, parentPositionStack}) =>
                    !expandedTaskIds.has(`${task.id}-${parentPositionStack.length}`)
                }
                onTaskAreChildTasksCollapsedToggle={({task: {id: taskId}, parentPositionStack}) => {
                    setExpandedTaskIds(expandedTaskIds => {
                        const newExpandedTaskIds = new Set(expandedTaskIds);
                        if (!newExpandedTaskIds.delete(`${taskId}-${parentPositionStack.length}`)) {
                            newExpandedTaskIds.add(`${taskId}-${parentPositionStack.length}`);
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
                                    taskRow.parentPositionStack.length ===
                                        parentPositionStack.length,
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
                createTaskAtEndFromBottomGhost={options => {
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
                            ...options,
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
                createTaskAtStartFromTopGhostWithoutNewGhost={options => {
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
                            ...options,
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
                            const index = taskRowsRef.current.findIndex(
                                ({task}) => task.id === taskId,
                            );

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
                    // NOCOMMIT: Do an equivalent thing here?
                    // const parentPosition =
                    //     parentPositionStack[parentPositionStack.length - 1] ?? null;
                    //
                    // const onLayoutEffect = () => {
                    //     // TODO(calebmer): A production implementation probably shouldn't do an
                    //     // O(n) loop here.
                    //     const newIndex = taskRowsRef.current.findIndex(
                    //         ({task, parentPositionStack: otherParentPositionStack}) =>
                    //             task.id === childTaskId &&
                    //             otherParentPositionStack.length === parentPositionStack.length - 1,
                    //     );
                    //
                    //     if (newIndex >= 0) {
                    //         gridViewRef.current?.focusTaskRowTitleSelection(
                    //             newIndex,
                    //             titleSelection,
                    //         );
                    //     }
                    // };
                    //
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
                deleteTaskAndAllChildrenMaybeWithConfirmation={({task: {id: taskId}}) => {
                    setShowDeleteConfirmationForTaskId(taskId);
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

                    // NOCOMMIT: Do an equivalent thing here?
                    // const position =
                    //     unnest === 0
                    //         ? belowTaskRow.position
                    //         : belowTaskRow.parentPositionStack[
                    //               belowTaskRow.parentPositionStack.length - unnest
                    //           ] ?? belowTaskRow.position;
                    //
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
            {showDeleteConfirmationForTaskId && (
                <TaskDeleteConfirmationModalDialog
                    state={state}
                    dispatch={dispatch}
                    taskId={showDeleteConfirmationForTaskId}
                    onClose={() => setShowDeleteConfirmationForTaskId(null)}
                />
            )}
        </>
    );
}
