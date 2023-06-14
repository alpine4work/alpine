import {useMemo, useRef, useState} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
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
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
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

export function TaskCollectionGridView({
    state,
    dispatch,
    collectionId,
    filters,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    collectionId: LocalTaskCollectionId;
    filters: ReadonlyArray<TaskQueryFilter>;
}) {
    const {timeZone} = useClientInfo();
    const currentDate = useCurrentDate();
    const {currentAccount, space} = useSpaceContext();
    const peekStackContext = usePeekStackContext();
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const tasks = useMemo(() => {
        return state.database.queryCollectionTasks(collectionId, filters, {
            currentAccountId: currentAccount.id,
            currentDate,
        });
    }, [collectionId, currentAccount.id, currentDate, filters, state.database]);

    const [expandedTaskIds, setExpandedTaskIds] = useState(new Set<LocalTaskId>());

    const {taskRowIds, taskRows} = useMemo(() => {
        const taskRowIds = new Set<LocalTaskId>();
        const taskRows: Array<TaskCollectionGridViewRow> = [];

        const addChildTasks = (
            parentPositionStack: ReadonlyArray<TaskCollectionGridViewRowPosition>,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                taskRowIds.add(childTask.id);

                const position: TaskCollectionGridViewRowPosition = {
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

        for (const {task, orderKey} of tasks) {
            taskRowIds.add(task.id);

            const position: TaskCollectionGridViewRowPosition = {
                isRoot: true,
                collection: {id: collectionId, orderKey},
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
    }, [collectionId, expandedTaskIds, state.database, tasks]);

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
        <TaskGridPresentationalView<TaskCollectionGridViewRow>
            ref={gridViewRef}
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
                {task: {id: parentTaskId}},
                {position: oldPosition, task: {id: childTaskId}},
                titleSelection,
                newIndentation,
            ) => {
                // Immediate priority since we want React to batch the
                // `setExpandedChildTaskIds()` call and the `dispatch()` which doesn't go
                // through React state.
                runWithImmediatePriority(() => {
                    dispatch({
                        type: "NestTask",
                        parentTaskId,
                        childTaskId,
                        from: oldPosition.isRoot
                            ? {type: "Collection", collectionId: oldPosition.collection.id}
                            : {type: "ParentTask"},
                        onLayoutEffect: () => {
                            // TODO(calebmer): A production implementation probably shouldn't do an
                            // O(n) loop here.
                            const newIndex = taskRowsRef.current.findIndex(
                                ({task, parentPositionStack}) =>
                                    task.id === childTaskId &&
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
                        newExpandedTaskIds.add(parentTaskId);
                        return newExpandedTaskIds;
                    });
                });
            }}
            unnestTaskIfNestedRow={(
                {position, parentPositionStack, task: {id: childTaskId}},
                titleSelection,
            ) => {
                const from: LocalTasksMoveTaskFrom = position.isRoot
                    ? {type: "Collection", collectionId: position.collection.id}
                    : {type: "ParentTask"};

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

                if (parentPosition) {
                    dispatch({
                        type: "MoveTask",
                        taskId: childTaskId,
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
