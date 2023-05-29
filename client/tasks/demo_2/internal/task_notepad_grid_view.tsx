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
import {LocalTaskId} from "~/shared/id/types/id_types";

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

    const taskIds = useMemo(() => new Set(tasks.map(([, task]) => task.id)), [tasks]);

    const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<LocalTaskId>>(new Set());

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
                if (!taskIds.has(taskId)) {
                    if (!newExpandedTaskIds) newExpandedTaskIds = new Set(expandedTaskIds);
                    newExpandedTaskIds.delete(taskId);
                }
            }

            return newExpandedTaskIds;
        }, [expandedTaskIds, taskIds]);

        if (newExpandedTaskIds) {
            setExpandedTaskIds(newExpandedTaskIds);
        }
    }

    const taskRows = useMemo(() => {
        const taskRows: Array<{
            position: TaskNotepadGridViewRowPosition;
            task: LocalTask;
        }> = [];

        const addChildTasks = (indentation: number, parentTask: LocalTask) => {
            for (const [orderKey, childTaskId] of parentTask.childTaskIdByOrderKey) {
                const childTask = state.database.getTask(childTaskId);

                taskRows.push({
                    position: {
                        isRoot: false,
                        indentation: indentation,
                        parentTask: {id: parentTask.id, orderKey},
                    },
                    task: childTask,
                });

                if (expandedTaskIds.has(childTask.id)) {
                    addChildTasks(indentation + 1, childTask);
                }
            }
        };

        for (const [orderKey, task] of tasks) {
            taskRows.push({
                position: {
                    isRoot: true,
                    indentation: 0,
                    notepad: {page: notepadPage, orderKey},
                },
                task,
            });

            if (expandedTaskIds.has(task.id)) {
                addChildTasks(1, task);
            }
        }

        return taskRows;
    }, [expandedTaskIds, notepadPage, state.database, tasks]);

    const taskRowsRef = useRef(taskRows);
    useLayoutEffectWithoutServerSideWarning(() => {
        taskRowsRef.current = taskRows;
    });

    const {taskGhostRowPlaceholder} = useTaskGhostRowPlaceholderTutorial(taskRows.length);

    return (
        <TaskGridPresentationalView<{position: TaskNotepadGridViewRowPosition; task: LocalTask}>
            ref={useMergedRefs(ref, gridViewRef)}
            taskGhostRowPlaceholder={taskGhostRowPlaceholder}
            taskRowCount={taskRows.length}
            getTaskRow={index => taskRows[index]!}
            ghostTaskKey={state.ghostTaskId}
            getTaskKey={({task}) => task.id}
            getTaskStatus={({task}) => task.status}
            onTaskStatusChange={({task: {id: taskId}}, status) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (const task of tasks) {
                                if (task.id === taskId) {
                                    task.status = status;
                                    return true;
                                }

                                if (loop(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            getTaskTitle={({task}) => task.title}
            onTaskTitleChange={({task: {id: taskId}}, title) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (const task of tasks) {
                                if (task.id === taskId) {
                                    task.title = castDraft(title);
                                    return true;
                                }

                                if (loop(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
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
                        const index = taskRowsRef.current.findIndex(({task}) => task.id === taskId);
                        if (index >= 0) gridViewRef.current?.focusTaskRowTitleStart(index);
                    },
                });
            }}
            createTaskAtEndFromGhost={title => {
                dispatch({
                    type: "CreateTask",
                    taskId: state.ghostTaskId,
                    title,
                    notepad: {page: notepadPage, side: "Below"},
                });
            }}
            createTaskAtEndFromGhostAndFocusNewGhost={title => {
                dispatch({
                    type: "CreateTask",
                    taskId: state.ghostTaskId,
                    title,
                    notepad: {page: notepadPage, side: "Below"},
                    onLayoutEffect: () => {
                        gridViewRef.current?.focusGhostTaskRow();
                    },
                });
            }}
            nestTaskAndExpandParentRow={({task: {id: parentTaskId}}, {task: {id: childTaskId}}) => {
                setState(state =>
                    produce(state, state => {
                        if (parentTaskId === childTaskId) {
                            throw new InvalidArgumentError("Can't nest task under itself");
                        }

                        const loop1 = (
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ): Draft<TaskGridDemoTask> | null => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === childTaskId) {
                                    tasks.splice(taskIndex, 1);
                                    return task;
                                }

                                const childTask = loop1(task.childTasks);
                                if (childTask) return childTask;
                            }

                            return null;
                        };

                        const childTask = loop1(state.tasks);
                        if (!childTask) {
                            throw new NotFoundError("Child task not found");
                        }

                        const loop2 = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === parentTaskId) {
                                    task.areChildTasksCollapsed = false;
                                    task.childTasks.push(childTask);
                                    return true;
                                }

                                if (loop2(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop2(state.tasks)) {
                            throw new NotFoundError("Parent task not found");
                        }
                    }),
                );
            }}
            unnestTaskIfNestedRow={({task: {id: childTaskId}}) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (
                            parent: {
                                tasks: Draft<ReadonlyArray<TaskGridDemoTask>>;
                                taskIndex: number;
                            } | null,
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === childTaskId) {
                                    if (parent) {
                                        tasks.splice(taskIndex, 1);
                                        parent.tasks.splice(parent.taskIndex + 1, 0, task);
                                    }
                                    return true;
                                }

                                if (loop({tasks, taskIndex}, task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(null, state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            deleteTaskAndAllChildrenAndFocusPreviousRow={({task: {id: taskId}}) => {
                setState(state =>
                    produce(state, state => {
                        let taskRowIndex: number = 0;

                        const loop = (
                            isTaskCollapsed: boolean,
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === taskId) {
                                    tasks.splice(taskIndex, 1);

                                    if (!isTaskCollapsed) {
                                        if (tasks === state.tasks && tasks.length === 0) {
                                            state.effectRef = new MutableRefObjectClass(gridView =>
                                                gridView.focusGhostTaskRow(),
                                            );
                                        } else if (taskRowIndex === 0) {
                                            state.effectRef = new MutableRefObjectClass(gridView =>
                                                gridView.focusTaskRowTitleStart(0),
                                            );
                                        } else {
                                            const focusTaskRowIndex = taskRowIndex - 1;
                                            state.effectRef = new MutableRefObjectClass(gridView =>
                                                gridView.focusTaskRowTitleEnd(focusTaskRowIndex),
                                            );
                                        }
                                    }

                                    return true;
                                }

                                if (!isTaskCollapsed) taskRowIndex++;

                                if (
                                    loop(
                                        isTaskCollapsed || task.areChildTasksCollapsed,
                                        task.childTasks,
                                    )
                                ) {
                                    return true;
                                }
                            }

                            return false;
                        };

                        if (!loop(false, state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
        />
    );
}
