import {Memo, Ref, forwardRef, useMemo, useRef, useState} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {
    LocalTask,
    LocalTasksAction,
    LocalTasksState,
} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewRef,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {useTaskGhostRowPlaceholderTutorial} from "~/client/tasks/demo_2/use_task_ghost_row_placeholder_tutorial";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";

// TODO(calebmer): Ghost at the top of the grid?

const TaskNotepadGridViewForwardRef = forwardRef(TaskNotepadGridView);
export {TaskNotepadGridViewForwardRef as TaskNotepadGridView};

type TaskNotepadGridViewRowPosition =
    | {
          isRoot: true;
          indentation: 0;
          notepad: {page: number; orderKey: OrderKey};
      }
    | {
          isRoot: false;
          indentation: number;
          parentTask: {id: LocalTaskId; orderKey: OrderKey};
      };

function TaskNotepadGridView(
    {
        state,
        dispatch,
        notepadPage,
    }: {
        state: LocalTasksState;
        dispatch: Memo<(action: LocalTasksAction) => void>;
        notepadPage: number;
    },
    ref: Ref<TaskGridPresentationalViewRef>,
) {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const tasks = useMemo(
        () => Array.from(state.database.getNotepadPageTasks(notepadPage)),
        [notepadPage, state.database],
    );

    const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<LocalTaskId>>(new Set());

    const {taskRowIds, taskRows} = useMemo(() => {
        const taskRowIds = new Set<LocalTaskId>();

        const taskRows: Array<{
            position: TaskNotepadGridViewRowPosition;
            parentPosition: TaskNotepadGridViewRowPosition | null;
            task: LocalTask;
        }> = [];

        const addChildTasks = (
            parentPosition: TaskNotepadGridViewRowPosition | null,
            indentation: number,
            parentTask: LocalTask,
        ) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                taskRowIds.add(childTask.id);

                const position: TaskNotepadGridViewRowPosition = {
                    isRoot: false,
                    indentation: indentation,
                    parentTask: {id: parentTask.id, orderKey},
                };

                taskRows.push({
                    position,
                    parentPosition,
                    task: childTask,
                });

                if (expandedTaskIds.has(childTask.id)) {
                    addChildTasks(position, indentation + 1, childTask);
                }
            }
        };

        for (const [orderKey, task] of tasks) {
            taskRowIds.add(task.id);

            const position: TaskNotepadGridViewRowPosition = {
                isRoot: true,
                indentation: 0,
                notepad: {page: notepadPage, orderKey},
            };

            taskRows.push({
                position,
                parentPosition: null,
                task,
            });

            if (expandedTaskIds.has(task.id)) {
                addChildTasks(position, 1, task);
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
        <TaskGridPresentationalView<{
            position: TaskNotepadGridViewRowPosition;
            parentPosition: TaskNotepadGridViewRowPosition | null;
            task: LocalTask;
        }>
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
            getTaskAssignee={() => null}
            getTaskChildTaskCount={({task}) => task.childTaskIdByOrderKey.size}
            getTaskAreChildTasksCollapsed={({task}) => !expandedTaskIds.has(task.id)}
            onAreChildTasksCollapsedToggle={({task: {id: taskId}}) => {
                setExpandedTaskIds(expandedTaskIds => {
                    const newExpandedTaskIds = new Set(expandedTaskIds);
                    if (!newExpandedTaskIds.delete(taskId)) {
                        newExpandedTaskIds.add(taskId);
                    }
                    return newExpandedTaskIds;
                });
            }}
            getTaskRowIndentation={({position}) => position.indentation}
            createTaskAbove={({position}) => {
                dispatch({
                    type: "CreateTask",
                    ...position,
                    side: "Above",
                });
            }}
            createTaskBelowAndFocus={({position}) => {
                dispatch({
                    type: "CreateTask",
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
                // Generate a new ghost row...
                setBottomTaskGhostRowId(generateId<LocalTaskId>());

                dispatch({
                    type: "CreateTask",
                    taskId: bottomTaskGhostRowId,
                    title,
                    notepad: {page: notepadPage, side: "Below"},
                });
            }}
            createTaskAtEndFromBottomGhostAndFocusNewGhost={title => {
                // Generate a new ghost row...
                setBottomTaskGhostRowId(generateId<LocalTaskId>());

                dispatch({
                    type: "CreateTask",
                    taskId: bottomTaskGhostRowId,
                    title,
                    notepad: {page: notepadPage, side: "Below"},
                    onLayoutEffect: () => {
                        gridViewRef.current?.focusEnd();
                    },
                });
            }}
            createTaskAtStartFromTopGhostWithoutNewGhost={title => {
                if (!topTaskGhostRowId) return;

                // Don't create a new top ghost row.
                setTopTaskGhostRowId(null);

                dispatch({
                    type: "CreateTask",
                    taskId: topTaskGhostRowId,
                    title,
                    notepad: {page: notepadPage, side: "Above"},
                });
            }}
            createTaskAtStartFromTopGhostAndFocus={title => {
                dispatch({
                    type: "CreateTask",
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
            }}
            unnestTaskIfNestedRow={({parentPosition, task: {id: childTaskId}}) => {
                if (parentPosition) {
                    if (parentPosition.isRoot) {
                        dispatch({
                            type: "UnnestTaskToNotepad",
                            notepadPage: parentPosition.notepad.page,
                            belowOrderKey: parentPosition.notepad.orderKey,
                            childTaskId,
                        });
                    } else {
                        dispatch({
                            type: "UnnestTaskToParentTask",
                            parentTaskId: parentPosition.parentTask.id,
                            belowOrderKey: parentPosition.parentTask.orderKey,
                            childTaskId,
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
        />
    );
}
