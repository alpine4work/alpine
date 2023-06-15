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
    LocalTasksMoveTaskFrom,
    LocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewRef,
    minTaskCountToShowTopGhostTask,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {TaskQuerySort} from "~/client/tasks/demo_2/task_query_sort";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskCollectionId, LocalTaskId} from "~/shared/id/types/id_types";

type TaskCollectionGridViewRowPosition =
    | {
          readonly isRoot: true;
          readonly collection: {readonly id: LocalTaskCollectionId; readonly orderKey: OrderKey};
      }
    | {
          readonly isRoot: false;
          readonly parentTask: {readonly id: LocalTaskId; readonly orderKey: OrderKey};
      };

export type TaskCollectionGridViewRow = {
    readonly position: TaskCollectionGridViewRowPosition;
    readonly parentPositionStack: ReadonlyArray<TaskCollectionGridViewRowPosition>;
    readonly task: LocalTask;
};

const TaskCollectionGridViewForwardRef = forwardRef(TaskCollectionGridView);
export {TaskCollectionGridViewForwardRef as TaskCollectionGridView};

function TaskCollectionGridView(
    {
        state,
        dispatch,
        collectionId,
        filters,
        sorts,
    }: {
        state: LocalTasksState;
        dispatch: (action: LocalTasksAction) => void;
        collectionId: LocalTaskCollectionId;
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
        return state.database.queryCollectionTasks(collectionId, filters, sorts, {
            currentAccountId: currentAccount.id,
            currentDate,
        });
    }, [collectionId, currentAccount.id, currentDate, filters, sorts, state.database]);

    const [expandedTaskIds, setExpandedTaskIds] = useState(new Set<`${LocalTaskId}-${number}`>());

    const taskRows = useMemo(() => {
        const taskRows: Array<TaskCollectionGridViewRow> = [];

        const addChildTasks = (
            parentPositionStack: ReadonlyArray<TaskCollectionGridViewRowPosition>,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                const position: TaskCollectionGridViewRowPosition = {
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

        for (const {task, orderKey} of tasks) {
            const position: TaskCollectionGridViewRowPosition = {
                isRoot: true,
                collection: {id: collectionId, orderKey},
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
    }, [collectionId, expandedTaskIds, state.database, tasks]);

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

    return (
        <TaskGridPresentationalView<TaskCollectionGridViewRow>
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
            shouldRenderMultilineTitle={false}
            getTaskTitle={({task}) => task.title}
            onTaskTitleChange={({task: {id: taskId}}, title) => {
                dispatch({
                    type: "UpdateTaskTitle",
                    taskId,
                    title,
                });
            }}
            shouldShowDenseAssigneeAndDueDate={false}
            getTaskAssignee={({task}) => task.assignee}
            onTaskAssigneeChange={({task: {id: taskId}}, assignee) => {
                dispatch({
                    type: "UpdateTaskAssignee",
                    taskId,
                    assignee,
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
            getTaskAreChildTasksCollapsed={({parentPositionStack, task}) =>
                !expandedTaskIds.has(`${task.id}-${parentPositionStack.length}`)
            }
            onTaskAreChildTasksCollapsedToggle={({parentPositionStack, task: {id: taskId}}) => {
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
                        collection: {id: collectionId, side: "Below"},
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
                        collection: {id: collectionId, side: "Below"},
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
                        collection: {id: collectionId, side: "Above"},
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
                    collection: {id: collectionId, side: "Above"},
                    onLayoutEffect: taskId => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const index = taskRowsRef.current.findIndex(({task}) => task.id === taskId);

                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            nestTaskAndExpandParentRow={(
                parentTaskRow,
                childTaskRow,
                titleSelection,
                newIndentation,
            ) => {
                // Immediate priority since we want React to batch the
                // `setExpandedChildTaskIds()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    dispatch({
                        type: "NestTask",
                        parentTaskId: parentTaskRow.task.id,
                        childTaskId: childTaskRow.task.id,
                        from: childTaskRow.position.isRoot
                            ? {
                                  type: "Collection",
                                  collectionId: childTaskRow.position.collection.id,
                              }
                            : {type: "ParentTask"},
                        onLayoutEffect: () => {
                            // TODO(calebmer): A production implementation probably shouldn't do an
                            // O(n) loop here.
                            const newIndex = taskRowsRef.current.findIndex(
                                ({task, parentPositionStack}) =>
                                    task.id === childTaskRow.task.id &&
                                    parentPositionStack.length === newIndentation,
                            );

                            if (newIndex >= 0) {
                                gridViewRef.current?.focusTaskRowTitleSelection(
                                    newIndex,
                                    titleSelection,
                                );
                            }
                        },
                    });

                    setExpandedTaskIds(expandedTaskIds => {
                        const newExpandedTaskIds = new Set(expandedTaskIds);

                        newExpandedTaskIds.add(
                            `${parentTaskRow.task.id}-${parentTaskRow.parentPositionStack.length}`,
                        );

                        // Remove the expanded task entry from the current indentation level and add it
                        // to its new indentation level.
                        //
                        // TODO(calebmer): I'd love to have a better identification mechanism for
                        // multiple of the same task in a grid...If another user is watching in
                        // realtime this would not preserve the expansion state of their task.
                        if (
                            newExpandedTaskIds.delete(
                                `${childTaskRow.task.id}-${childTaskRow.parentPositionStack.length}`,
                            )
                        ) {
                            newExpandedTaskIds.add(`${childTaskRow.task.id}-${newIndentation}`);
                        }

                        return newExpandedTaskIds;
                    });
                });
            }}
            unnestTaskIfNestedRow={(childTaskRow, titleSelection) => {
                const from: LocalTasksMoveTaskFrom = childTaskRow.position.isRoot
                    ? {type: "Collection", collectionId: childTaskRow.position.collection.id}
                    : {type: "ParentTask"};

                const parentPosition =
                    childTaskRow.parentPositionStack[childTaskRow.parentPositionStack.length - 1] ??
                    null;

                const onLayoutEffect = () => {
                    // TODO(calebmer): A production implementation probably shouldn't do an
                    // O(n) loop here.
                    const newIndex = taskRowsRef.current.findIndex(
                        ({task, parentPositionStack: otherParentPositionStack}) =>
                            task.id === childTaskRow.task.id &&
                            otherParentPositionStack.length ===
                                childTaskRow.parentPositionStack.length - 1,
                    );

                    if (newIndex >= 0) {
                        gridViewRef.current?.focusTaskRowTitleSelection(newIndex, titleSelection);
                    }
                };

                if (parentPosition) {
                    // Immediate priority since we want React to batch the
                    // `setExpandedChildTaskIds()` call and the `dispatch()` which doesn't go
                    // through React state.
                    runWithImmediatePriority(() => {
                        dispatch({
                            type: "MoveTask",
                            taskId: childTaskRow.task.id,
                            from,
                            to: parentPosition.isRoot
                                ? {
                                      type: "Collection",
                                      collectionId: parentPosition.collection.id,
                                      belowOrderKey: parentPosition.collection.orderKey,
                                  }
                                : {
                                      type: "ParentTask",
                                      parentTaskId: parentPosition.parentTask.id,
                                      belowOrderKey: parentPosition.parentTask.orderKey,
                                  },
                            onLayoutEffect,
                        });

                        setExpandedTaskIds(expandedTaskIds => {
                            const newExpandedTaskIds = new Set(expandedTaskIds);

                            // Remove the expanded task entry from the current indentation level and add it
                            // to its new indentation level.
                            //
                            // TODO(calebmer): I'd love to have a better identification mechanism for
                            // multiple of the same task in a grid...If another user is watching in
                            // realtime this would not preserve the expansion state of their task.
                            if (
                                newExpandedTaskIds.delete(
                                    `${childTaskRow.task.id}-${childTaskRow.parentPositionStack.length}`,
                                )
                            ) {
                                newExpandedTaskIds.add(
                                    `${childTaskRow.task.id}-${
                                        childTaskRow.parentPositionStack.length - 1
                                    }`,
                                );
                            }

                            return newExpandedTaskIds;
                        });
                    });
                }
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
                const from: LocalTasksMoveTaskFrom = taskRow.position.isRoot
                    ? {type: "Collection", collectionId: taskRow.position.collection.id}
                    : {type: "ParentTask"};

                if (!belowTaskRow) {
                    dispatch({
                        type: "MoveTask",
                        taskId: taskRow.task.id,
                        from,
                        to: {
                            type: "Collection",
                            collectionId,
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
                              type: "Collection",
                              collectionId: newPosition.collection.id,
                              belowOrderKey: newPosition.collection.orderKey,
                          }
                        : {
                              type: "ParentTask",
                              parentTaskId: newPosition.parentTask.id,
                              belowOrderKey: newPosition.parentTask.orderKey,
                          },
                });
            }}
            moveTaskToParentTop={(parentTaskRow, taskRow) => {
                const from: LocalTasksMoveTaskFrom = taskRow.position.isRoot
                    ? {type: "Collection", collectionId: taskRow.position.collection.id}
                    : {type: "ParentTask"};

                dispatch({
                    type: "MoveTask",
                    taskId: taskRow.task.id,
                    from,
                    to: {
                        type: "ParentTask",
                        parentTaskId: parentTaskRow.task.id,
                        belowOrderKey: null,
                    },
                });
            }}
        />
    );
}
