import {useMemo, useRef, useState} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {usePeekContext} from "~/client/peek/peek_remix_embed";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    LocalTask,
    LocalTasksAction,
    LocalTasksMoveTaskFrom,
    LocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state";
import {
    TaskDetailPresentationalView,
    TaskDetailPresentationalViewRef,
} from "~/client/tasks/demo_2/task_detail_presentational_view";
import {
    TaskGridPresentationalView,
    minTaskCountToShowTopGhostTask,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {assert} from "~/shared/helpers/control/assert";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";

type TaskViewChildTasksGridViewRowPosition = {
    parentTask: {id: LocalTaskId; orderKey: OrderKey};
};

export function TaskView({
    state,
    dispatch,
    taskId,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    taskId: LocalTaskId;
}) {
    const {timeZone} = useClientInfo();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContext();
    const peekStackContext = usePeekStackContext();
    const peekContext = usePeekContext();
    const detailViewRef = useRef<TaskDetailPresentationalViewRef>(null);
    const task = useMemo(() => state.database.getTask(taskId), [state.database, taskId]);

    const [expandedChildTaskIds, setExpandedChildTaskIds] = useState<ReadonlySet<LocalTaskId>>(
        new Set(),
    );

    const {childTaskRowIds, childTaskRows} = useMemo(() => {
        const childTaskRowIds = new Set<LocalTaskId>();

        const childTaskRows: Array<{
            position: TaskViewChildTasksGridViewRowPosition;
            parentPositionStack: ReadonlyArray<TaskViewChildTasksGridViewRowPosition>;
            task: LocalTask;
        }> = [];

        const addChildTasks = (
            parentPositionStack: ReadonlyArray<TaskViewChildTasksGridViewRowPosition>,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                assert(!childTaskRowIds.has(childTask.id), "Tasks in child tasks must be unique");
                childTaskRowIds.add(childTask.id);

                const position: TaskViewChildTasksGridViewRowPosition = {
                    parentTask: {id: parentTask.id, orderKey},
                };

                childTaskRows.push({
                    position,
                    parentPositionStack,
                    task: childTask,
                });

                if (expandedChildTaskIds.has(childTask.id)) {
                    addChildTasks([...parentPositionStack, position], childTask);
                }
            }
        };

        addChildTasks([], task);

        return {childTaskRowIds, childTaskRows};
    }, [expandedChildTaskIds, state.database, task]);

    // Remove any `expandedTaskIds` that do not exist in `taskIds`. If we a delete
    // a task this is how we update our expanded task IDs set.
    //
    // NOTE(calebmer): This isn't the most efficient! In a production
    // implementation maybe we use `symmetricDiffTree()` to get deleted tasks from
    // our database.
    {
        const newExpandedChildTaskIds = useMemo(() => {
            let newExpandedChildTaskIds: Set<LocalTaskId> | null = null;

            for (const taskId of expandedChildTaskIds) {
                if (!childTaskRowIds.has(taskId)) {
                    if (!newExpandedChildTaskIds)
                        newExpandedChildTaskIds = new Set(expandedChildTaskIds);
                    newExpandedChildTaskIds.delete(taskId);
                }
            }

            return newExpandedChildTaskIds;
        }, [expandedChildTaskIds, childTaskRowIds]);

        if (newExpandedChildTaskIds) {
            setExpandedChildTaskIds(newExpandedChildTaskIds);
        }
    }

    const childTaskRowsRef = useRef(childTaskRows);
    useLayoutEffectWithoutServerSideWarning(() => {
        childTaskRowsRef.current = childTaskRows;
    });

    // Only show the top ghost row if the component mounts with tasks. Once the top
    // ghost row is consumed it doesn't come back until the component is
    // mounted again.
    const [topTaskGhostRowId, setTopTaskGhostRowId] = useState(() =>
        childTaskRows.length >= minTaskCountToShowTopGhostTask ? generateId<LocalTaskId>() : null,
    );

    if (childTaskRows.length < 1 && topTaskGhostRowId) setTopTaskGhostRowId(null);

    const [bottomTaskGhostRowId, setBottomTaskGhostRowId] = useState(() =>
        generateId<LocalTaskId>(),
    );

    return (
        <TaskDetailPresentationalView<{
            position: TaskViewChildTasksGridViewRowPosition;
            parentPositionStack: ReadonlyArray<TaskViewChildTasksGridViewRowPosition>;
            task: LocalTask;
        }>
            ref={detailViewRef}
            status={task.status}
            onStatusChange={status => dispatch({type: "UpdateTaskStatus", taskId, status})}
            title={task.title}
            onTitleChange={title => dispatch({type: "UpdateTaskTitle", taskId, title})}
            assignee={task.assignee}
            onAssigneeChange={assignee => dispatch({type: "UpdateTaskAssignee", taskId, assignee})}
            priority={task.priority}
            onPriorityChange={priority => dispatch({type: "UpdateTaskPriority", taskId, priority})}
            dueDate={task.dueDate}
            onDueDateChange={dueDate => dispatch({type: "UpdateTaskDueDate", taskId, dueDate})}
            allCollections={useMemo(() => state.database.getAllTaskCollections(), [state.database])}
            collections={useMemo(
                () =>
                    Array.from(task.collectionIds, collectionId =>
                        state.database.getTaskCollection(collectionId),
                    ),
                [state.database, task.collectionIds],
            )}
            createCollectionAndAddToTask={taskCollection =>
                dispatch({type: "CreateTaskCollectionAndAddToTask", taskId, taskCollection})
            }
            addCollectionToTask={taskCollectionId =>
                dispatch({type: "AddTaskCollectionToTask", taskId, taskCollectionId})
            }
            removeCollectionFromTask={taskCollectionId =>
                dispatch({type: "RemoveTaskCollectionFromTask", taskId, taskCollectionId})
            }
            notesContent={task.notesContent}
            onNotesContentChange={notesContent =>
                dispatch({type: "UpdateTaskNotesContent", taskId, notesContent})
            }
            childTaskCount={task.childTaskIdByOrderKey.size}
            closedChildTaskCount={reduceIterable(
                task.childTaskIdByOrderKey.values(),
                (closedChildTaskCount, childTaskId) =>
                    closedChildTaskCount +
                    (state.database.getTask(childTaskId).status.type === "Closed" ? 1 : 0),
                0,
            )}
            childTasksGridView={
                <TaskGridPresentationalView<{
                    position: TaskViewChildTasksGridViewRowPosition;
                    parentPositionStack: ReadonlyArray<TaskViewChildTasksGridViewRowPosition>;
                    task: LocalTask;
                }>
                    capabilities={useMemo(
                        () => ({
                            hasMultilineTitle: true,
                            hasDenseAssigneeAndDueDate: true,
                            hasParentTaskTitle: false,
                            hasColumns: false,
                        }),
                        [],
                    )}
                    taskRowCount={childTaskRows.length}
                    getTaskRow={index => childTaskRows[index]!}
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
                                (state.database.getTask(childTaskId).status.type === "Closed"
                                    ? 1
                                    : 0),
                            0,
                        )
                    }
                    getTaskAreChildTasksCollapsed={({task}) => !expandedChildTaskIds.has(task.id)}
                    onTaskAreChildTasksCollapsedToggle={({task: {id: taskId}}) => {
                        setExpandedChildTaskIds(expandedTaskIds => {
                            const newExpandedTaskIds = new Set(expandedTaskIds);
                            if (!newExpandedTaskIds.delete(taskId)) {
                                newExpandedTaskIds.add(taskId);
                            }
                            return newExpandedTaskIds;
                        });
                    }}
                    onTaskExpand={async ({task: {id: taskId}}) => {
                        // If we are already in a peek then navigate the peek instead of opening a
                        // new one.
                        if (peekContext?.withMobileLayout) {
                            await navigate(`/s/${space.id}/tasks/demo-2/${taskId}`);
                        } else {
                            await peekStackContext.push(`/s/${space.id}/tasks/demo-2/${taskId}`);
                        }
                    }}
                    getTaskRowIndentation={({parentPositionStack}) => parentPositionStack.length}
                    createTaskAbove={({position}) => {
                        dispatch({
                            type: "CreateTask",
                            creatorId: currentAccount.id,
                            creatorTimeZone: timeZone,
                            normalizedFilters: null,
                            ...position,
                            side: "Above",
                        });
                    }}
                    createTaskBelowAndFocus={({position}) => {
                        dispatch({
                            type: "CreateTask",
                            creatorId: currentAccount.id,
                            creatorTimeZone: timeZone,
                            normalizedFilters: null,
                            ...position,
                            side: "Below",
                            onLayoutEffect: taskId => {
                                // TODO(calebmer): A production implementation probably shouldn't do an
                                // O(n) loop here.
                                const index = childTaskRowsRef.current.findIndex(
                                    ({task}) => task.id === taskId,
                                );

                                if (index >= 0) {
                                    detailViewRef.current
                                        ?.getChildTasksGridView()
                                        .focusTaskRowTitleStart(index);
                                }
                            },
                        });
                    }}
                    createTaskChildAtStartAndFocus={({task: {id: taskId}}) => {
                        dispatch({
                            type: "CreateTask",
                            creatorId: currentAccount.id,
                            creatorTimeZone: timeZone,
                            normalizedFilters: null,
                            parentTask: {id: taskId, side: "Above"},
                            onLayoutEffect: taskId => {
                                // TODO(calebmer): A production implementation probably shouldn't do an
                                // O(n) loop here.
                                const index = childTaskRowsRef.current.findIndex(
                                    ({task}) => task.id === taskId,
                                );

                                if (index >= 0) {
                                    detailViewRef.current
                                        ?.getChildTasksGridView()
                                        .focusTaskRowTitleStart(index);
                                }
                            },
                        });
                    }}
                    createTaskAtEndFromBottomGhost={options => {
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
                                normalizedFilters: null,
                                taskId: bottomTaskGhostRowId,
                                parentTask: {id: task.id, side: "Below"},
                                ...options,
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
                                normalizedFilters: null,
                                taskId: bottomTaskGhostRowId,
                                title,
                                parentTask: {id: task.id, side: "Below"},
                                onLayoutEffect: () => {
                                    detailViewRef.current?.getChildTasksGridView().focusEnd();
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
                            // Don't create a new top ghost row.
                            setTopTaskGhostRowId(null);

                            dispatch({
                                type: "CreateTask",
                                creatorId: currentAccount.id,
                                creatorTimeZone: timeZone,
                                normalizedFilters: null,
                                taskId: topTaskGhostRowId,
                                parentTask: {id: task.id, side: "Above"},
                                ...options,
                            });
                        });
                    }}
                    createTaskAtStartFromTopGhostAndFocus={title => {
                        dispatch({
                            type: "CreateTask",
                            creatorId: currentAccount.id,
                            creatorTimeZone: timeZone,
                            normalizedFilters: null,
                            title,
                            parentTask: {id: task.id, side: "Above"},
                            onLayoutEffect: taskId => {
                                // TODO(calebmer): A production implementation probably shouldn't do an
                                // O(n) loop here.
                                const index = childTaskRowsRef.current.findIndex(
                                    ({task}) => task.id === taskId,
                                );

                                if (index >= 0) {
                                    detailViewRef.current
                                        ?.getChildTasksGridView()
                                        .focusTaskRowTitleStart(index);
                                }
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
                            dispatch({
                                type: "NestTask",
                                parentTaskId,
                                childTaskId,
                                from: {type: "ParentTask"},
                                onLayoutEffect: () => {
                                    // TODO(calebmer): A production implementation probably shouldn't do an
                                    // O(n) loop here.
                                    const newIndex = childTaskRowsRef.current.findIndex(
                                        ({task, parentPositionStack}) =>
                                            task.id === childTaskId &&
                                            parentPositionStack.length === newIndentation,
                                    );

                                    if (newIndex >= 0) {
                                        detailViewRef.current
                                            ?.getChildTasksGridView()
                                            .focusTaskRowTitleSelection(newIndex, titleSelection);
                                    }
                                },
                            });

                            setExpandedChildTaskIds(expandedTaskIds => {
                                const newExpandedTaskIds = new Set(expandedTaskIds);
                                newExpandedTaskIds.add(parentTaskId);
                                return newExpandedTaskIds;
                            });
                        });
                    }}
                    unnestTaskIfNestedRow={(
                        {parentPositionStack, task: {id: childTaskId}},
                        titleSelection,
                    ) => {
                        const parentPosition = parentPositionStack[parentPositionStack.length - 1];

                        if (parentPosition) {
                            dispatch({
                                type: "MoveTask",
                                taskId: childTaskId,
                                from: {type: "ParentTask"},
                                to: {
                                    type: "ParentTask",
                                    parentTaskId: parentPosition.parentTask.id,
                                    belowOrderKey: parentPosition.parentTask.orderKey,
                                },
                                onLayoutEffect: () => {
                                    // TODO(calebmer): A production implementation probably shouldn't do an
                                    // O(n) loop here.
                                    const newIndex = childTaskRowsRef.current.findIndex(
                                        ({task, parentPositionStack: otherParentPositionStack}) =>
                                            task.id === childTaskId &&
                                            otherParentPositionStack.length ===
                                                parentPositionStack.length - 1,
                                    );

                                    if (newIndex >= 0) {
                                        detailViewRef.current
                                            ?.getChildTasksGridView()
                                            .focusTaskRowTitleSelection(newIndex, titleSelection);
                                    }
                                },
                            });
                        }
                    }}
                    deleteTaskAndAllChildrenAndFocusPreviousRow={({task: {id: taskId}}) => {
                        // TODO(calebmer): A production implementation probably shouldn't do an
                        // O(n) loop here.
                        const oldIndex = childTaskRowsRef.current.findIndex(
                            ({task}) => task.id === taskId,
                        );

                        dispatch({
                            type: "DeleteTaskAndAllChildren",
                            taskId,
                            onLayoutEffect: () => {
                                if (childTaskRowsRef.current.length === 0 || oldIndex === 0) {
                                    detailViewRef.current?.getChildTasksGridView().focusStart();
                                } else {
                                    detailViewRef.current
                                        ?.getChildTasksGridView()
                                        .focusTaskRowTitleEnd(oldIndex - 1);
                                }
                            },
                        });
                    }}
                    moveTaskBelow={(belowTaskRow, unnest, taskRow) => {
                        const from: LocalTasksMoveTaskFrom = {type: "ParentTask"};

                        if (!belowTaskRow) {
                            dispatch({
                                type: "MoveTask",
                                taskId: taskRow.task.id,
                                from,
                                to: {
                                    type: "ParentTask",
                                    parentTaskId: taskId,
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
                            to: {
                                type: "ParentTask",
                                parentTaskId: newPosition.parentTask.id,
                                belowOrderKey: newPosition.parentTask.orderKey,
                            },
                        });
                    }}
                    moveTaskToParentTop={(parentTaskRow, taskRow) => {
                        dispatch({
                            type: "MoveTask",
                            taskId: taskRow.task.id,
                            from: {type: "ParentTask"},
                            to: {
                                type: "ParentTask",
                                parentTaskId: parentTaskRow.task.id,
                                belowOrderKey: null,
                            },
                        });
                    }}
                />
            }
        />
    );
}
