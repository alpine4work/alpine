import {Memo, MutableRefObject, useEffect, useReducer, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {TaskRowViewRef} from "~/client/tasks/demo_1/internal/task_row_view.js";
import {DataLossError, FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {LocalTaskId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskTitle, TaskTitleSchema, emptyTaskTitle} from "~/shared/tasks/task_title_schema_old.js";

// TODO(calebmer): We store state locally for our task prototype. Once we land
// on an interaction experience we like, this should all be moved to a
// realtime, collaborative, server implementation.

// TODO(calebmer): This needs some tests. The indent/dedent split/join actions
// can get quite complex.

export type LocalTask = SchemaType<typeof LocalTaskSchema>;

const LocalTaskIdByOrderKeySchema = Schema.map(OrderKeySchema, Schema.id<LocalTaskId>()).transform<
    ImmutableMap<OrderKey, LocalTaskId>
>({
    serialize: taskIdByOrderKey => new Map(taskIdByOrderKey),
    deserialize: taskIdByOrderKey => ImmutableMap.from(taskIdByOrderKey),
});

const LocalTaskSchema = Schema.object({
    id: Schema.id<LocalTaskId>(),
    isOpen: Schema.boolean.default(true),
    title: TaskTitleSchema,
    orderKey: OrderKeySchema,
    parentTaskId: Schema.id<LocalTaskId>().nullable(),
    childTaskIdByOrderKey: LocalTaskIdByOrderKeySchema,
    isExpanded: Schema.boolean.default(true),
});

export type LocalTasksState = SchemaType<typeof LocalTasksStateSchema>;

const LocalTasksStateSchema = Schema.object({
    taskById: Schema.map(Schema.id<LocalTaskId>(), LocalTaskSchema),
    rootTaskIdByOrderKey: LocalTaskIdByOrderKeySchema,
    ghostTaskId: Schema.id<LocalTaskId>(),
    taskEffectRef: Schema.object({current: Schema.value(null)}).transform<
        MutableRefObject<{taskId: LocalTaskId; effect: (view: TaskRowViewRef) => void} | null>
    >({
        // Don't serialize mutable ref value it should only be used in process.
        serialize: () => ({current: null}),
        deserialize: () => ({current: null}),
    }),
});

function getInitialLocalTasksState(): LocalTasksState {
    return {
        taskById: new Map(),
        rootTaskIdByOrderKey: ImmutableMap.empty(),
        ghostTaskId: generateId(),
        taskEffectRef: {current: null},
    };
}

export type LocalTasksAction =
    | LocalTasksRestoreStateAction
    | LocalTasksResetStateAction
    | LocalTasksUpdateTaskTitleAction
    | LocalTasksUpdateTaskIsOpenAction
    | LocalTasksUpdateTaskIsExpandedAction
    | LocalTasksCreateTaskBelowAction
    | LocalTasksCreateTaskAboveAction
    | LocalTasksDeleteTaskAndAllSubtasksTitleAction
    | LocalTasksIndentTaskAction
    | LocalTasksDedentTaskAction;

type LocalTasksRestoreStateAction = {
    readonly type: "RestoreState";
    readonly serializedStateString: string;
};

type LocalTasksResetStateAction = {
    readonly type: "ResetState";
};

type LocalTasksUpdateTaskTitleAction = {
    readonly type: "UpdateTaskTitle";
    readonly taskId: LocalTaskId;
    readonly title: TaskTitle;
};

type LocalTasksUpdateTaskIsOpenAction = {
    readonly type: "UpdateTaskIsOpen";
    readonly taskId: LocalTaskId;
    readonly isOpen: boolean;
};

type LocalTasksUpdateTaskIsExpandedAction = {
    readonly type: "UpdateTaskIsExpanded";
    readonly taskId: LocalTaskId;
    readonly isExpanded: boolean;
};

type LocalTasksCreateTaskBelowAction = {
    readonly type: "CreateTaskBelow";
    readonly taskId: LocalTaskId;
};

type LocalTasksCreateTaskAboveAction = {
    readonly type: "CreateTaskAbove";
    readonly taskId: LocalTaskId;
};

type LocalTasksDeleteTaskAndAllSubtasksTitleAction = {
    readonly type: "DeleteTaskAndAllSubtasks";
    readonly taskId: LocalTaskId;
};

type LocalTasksIndentTaskAction = {
    readonly type: "IndentTask";
    readonly taskId: LocalTaskId;
    readonly previousTaskId: LocalTaskId;
};

type LocalTasksDedentTaskAction = {
    readonly type: "DedentTask";
    readonly taskId: LocalTaskId;
};

function reduceLocalTasksState(
    oldState: LocalTasksState,
    action: LocalTasksAction,
): LocalTasksState {
    const newState = actuallyReduceLocalTasksState(oldState, action);

    if (process.env.NODE_ENV !== "production") {
        assert(
            iterableEvery(newState.taskById, ([taskId, task]) => taskId === task.id),
            "Every entry in `taskById` should have a consistent ID in the key and value",
        );

        assert(
            iterableEvery(newState.taskById.values(), task =>
                task.parentTaskId
                    ? newState.taskById
                          .get(task.parentTaskId)
                          ?.childTaskIdByOrderKey.get(task.orderKey) === task.id
                    : newState.rootTaskIdByOrderKey.get(task.orderKey) === task.id,
            ),
            "Every task in `taskById` must be present in `rootTaskIdByOrderKey` or its parent task's `childTaskIdByOrderKey`",
        );

        assert(
            iterableEvery(newState.rootTaskIdByOrderKey.values(), taskId =>
                newState.taskById.has(taskId),
            ),
            "Every task in `rootTaskIdByOrderKey` must be present in `taskById`",
        );

        assert(
            iterableEvery(newState.taskById.values(), task =>
                iterableEvery(task.childTaskIdByOrderKey.values(), taskId =>
                    newState.taskById.has(taskId),
                ),
            ),
            "Every task in a task's `childTaskIdByOrderKey` must be present in `taskById`",
        );

        const hasCycle = (stack: Array<LocalTaskId>, task: LocalTask): boolean => {
            if (stack.includes(task.id)) return true;

            stack.push(task.id);
            const childHasCycle = iterableSome(task.childTaskIdByOrderKey.values(), childTaskId =>
                hasCycle(stack, assertExists(newState.taskById.get(childTaskId))),
            );
            stack.pop();

            return childHasCycle;
        };

        assert(
            iterableEvery(
                newState.rootTaskIdByOrderKey.values(),
                taskId => !hasCycle([], assertExists(newState.taskById.get(taskId))),
            ),
            "Cycles are not allowed in task children",
        );
    }

    return newState;
}

function actuallyReduceLocalTasksState(
    state: LocalTasksState,
    action: LocalTasksAction,
): LocalTasksState {
    switch (action.type) {
        case "RestoreState": {
            try {
                const serializedState = JSON.parse(action.serializedStateString);
                return LocalTasksStateSchema.deserialize(serializedState);
            } catch (_error) {
                const error = DataLossError.from(_error, "Bad local tasks state (logged below)");

                // This is for local development only. Don't bother reporting errors.
                // eslint-disable-next-line no-console
                console.error(error);

                try {
                    // eslint-disable-next-line no-console
                    console.log(`Bad local tasks state:`, JSON.parse(action.serializedStateString));
                } catch {
                    // eslint-disable-next-line no-console
                    console.log(`Bad local tasks state:`, action.serializedStateString);
                }

                return state;
            }
        }

        case "ResetState": {
            return getInitialLocalTasksState();
        }

        case "UpdateTaskTitle": {
            // If we are updating the title of a ghost task then turn the ghost task into a
            // real task and generate a new ghost task id.
            if (action.taskId === state.ghostTaskId) {
                const newTask: LocalTask = {
                    id: state.ghostTaskId,
                    isOpen: true,
                    title: action.title,
                    orderKey: generateOrderKeyBetween(
                        state.rootTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    ),
                    parentTaskId: null,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newTask.id, newTask);

                const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                    ghostTaskId: generateId(),
                };
            }

            const newTaskById = new Map(state.taskById);

            const oldTask = newTaskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            const newTask = {...oldTask, title: action.title};
            newTaskById.set(action.taskId, newTask);

            return {...state, taskById: newTaskById};
        }

        case "UpdateTaskIsOpen": {
            if (action.taskId === state.ghostTaskId) {
                throw new FailedPreconditionError("Can't open or close a ghost task");
            }

            const newTaskById = new Map(state.taskById);

            const oldTask = newTaskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            const newTask = {...oldTask, isOpen: action.isOpen};
            newTaskById.set(action.taskId, newTask);

            return {...state, taskById: newTaskById};
        }

        case "UpdateTaskIsExpanded": {
            if (action.taskId === state.ghostTaskId) {
                throw new FailedPreconditionError("Can't expand or collapse a ghost task");
            }

            const newTaskById = new Map(state.taskById);

            const oldTask = newTaskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            const newTask = {...oldTask, isExpanded: action.isExpanded};
            newTaskById.set(action.taskId, newTask);

            return {...state, taskById: newTaskById};
        }

        case "CreateTaskBelow": {
            // If we are create a new task below a ghost task, then convert the ghost task
            // to a real task and move focus to the new ghost task.
            if (action.taskId === state.ghostTaskId) {
                const newTask: LocalTask = {
                    id: state.ghostTaskId,
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        state.rootTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    ),
                    parentTaskId: null,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newTask.id, newTask);

                const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                const newGhostTaskId = generateId<LocalTaskId>();

                return {
                    ...state,
                    taskById: newTaskById,
                    rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                    ghostTaskId: newGhostTaskId,
                    taskEffectRef: {
                        current: {
                            taskId: newGhostTaskId,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            }

            const oldAfterTask = state.taskById.get(action.taskId);
            if (!oldAfterTask) throw new NotFoundError("Task not found");

            // If the task has some children then creating a new task puts that new task as
            // the first child to avoid jumping around in the scroll position.
            if (oldAfterTask.isExpanded && oldAfterTask.childTaskIdByOrderKey.size > 0) {
                const newTaskById = new Map(state.taskById);

                const newTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        null,
                        oldAfterTask.childTaskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                    ),
                    parentTaskId: oldAfterTask.id,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                const newAfterTask: LocalTask = {
                    ...oldAfterTask,
                    childTaskIdByOrderKey: oldAfterTask.childTaskIdByOrderKey.set(
                        newTask.orderKey,
                        newTask.id,
                    ),
                };

                newTaskById.set(newTask.id, newTask);
                newTaskById.set(newAfterTask.id, newAfterTask);

                return {
                    ...state,
                    taskById: newTaskById,
                    taskEffectRef: {
                        current: {
                            taskId: newTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            } else if (oldAfterTask.parentTaskId === null) {
                const newTaskById = new Map(state.taskById);

                const newTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        oldAfterTask.orderKey,
                        state.rootTaskIdByOrderKey.getEntryAfter(oldAfterTask.orderKey)?.[0] ??
                            null,
                    ),
                    parentTaskId: null,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                newTaskById.set(newTask.id, newTask);

                const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                    taskEffectRef: {
                        current: {
                            taskId: newTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            } else {
                const oldParentTask = assertExists(state.taskById.get(oldAfterTask.parentTaskId));

                const newTaskById = new Map(state.taskById);

                const newTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        oldAfterTask.orderKey,
                        oldParentTask.childTaskIdByOrderKey.getEntryAfter(
                            oldAfterTask.orderKey,
                        )?.[0] ?? null,
                    ),
                    parentTaskId: oldAfterTask.parentTaskId,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                const newParentTask: LocalTask = {
                    ...oldParentTask,
                    childTaskIdByOrderKey: oldParentTask.childTaskIdByOrderKey.set(
                        newTask.orderKey,
                        newTask.id,
                    ),
                };

                newTaskById.set(newTask.id, newTask);
                newTaskById.set(newParentTask.id, newParentTask);

                return {
                    ...state,
                    taskById: newTaskById,
                    taskEffectRef: {
                        current: {
                            taskId: newTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            }
        }

        case "CreateTaskAbove": {
            // If we are create a new task above a ghost task, then convert the ghost task
            // to a real task and keep focus in that ghost task.
            if (action.taskId === state.ghostTaskId) {
                const newTask: LocalTask = {
                    id: state.ghostTaskId,
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        state.rootTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    ),
                    parentTaskId: null,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newTask.id, newTask);

                const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                const newGhostTaskId = generateId<LocalTaskId>();

                return {
                    ...state,
                    taskById: newTaskById,
                    rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                    ghostTaskId: newGhostTaskId,
                };
            }

            const oldBeforeTask = state.taskById.get(action.taskId);
            if (!oldBeforeTask) throw new NotFoundError("Task not found");

            if (oldBeforeTask.parentTaskId === null) {
                const newTaskById = new Map(state.taskById);

                const newTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        state.rootTaskIdByOrderKey.getEntryBefore(oldBeforeTask.orderKey)?.[0] ??
                            null,
                        oldBeforeTask.orderKey,
                    ),
                    parentTaskId: null,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                newTaskById.set(newTask.id, newTask);

                const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                };
            } else {
                const oldParentTask = assertExists(state.taskById.get(oldBeforeTask.parentTaskId));

                const newTaskById = new Map(state.taskById);

                const newTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        oldParentTask.childTaskIdByOrderKey.getEntryBefore(
                            oldBeforeTask.orderKey,
                        )?.[0] ?? null,
                        oldBeforeTask.orderKey,
                    ),
                    parentTaskId: oldBeforeTask.parentTaskId,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                    isExpanded: true,
                };

                const newParentTask: LocalTask = {
                    ...oldParentTask,
                    childTaskIdByOrderKey: oldParentTask.childTaskIdByOrderKey.set(
                        newTask.orderKey,
                        newTask.id,
                    ),
                };

                newTaskById.set(newTask.id, newTask);
                newTaskById.set(newParentTask.id, newParentTask);

                return {
                    ...state,
                    taskById: newTaskById,
                };
            }
        }

        case "DeleteTaskAndAllSubtasks": {
            // You can't delete a ghost task. So move focus to the last entry instead.
            if (action.taskId === state.ghostTaskId) {
                const lastRootTaskEntry = state.rootTaskIdByOrderKey.getLastEntry();
                if (!lastRootTaskEntry) return state;

                let lastTask = assertExists(state.taskById.get(lastRootTaskEntry[1]));
                while (lastTask.isExpanded && lastTask.childTaskIdByOrderKey.size > 0) {
                    const lastChildTaskEntry = lastTask.childTaskIdByOrderKey.getLastEntry()!;
                    lastTask = assertExists(state.taskById.get(lastChildTaskEntry[1]));
                }

                return {
                    ...state,
                    taskEffectRef: {
                        current: {
                            taskId: lastTask.id,
                            effect: view => view.focusTitleEnd(),
                        },
                    },
                };
            }

            const oldTask = state.taskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            const newTaskById = new Map(state.taskById);
            let newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey;

            const deleteAll = (task: LocalTask) => {
                newTaskById.delete(task.id);

                for (const childTaskId of task.childTaskIdByOrderKey.values()) {
                    const childTask = assertExists(state.taskById.get(childTaskId));
                    deleteAll(childTask);
                }
            };

            deleteAll(oldTask);

            if (oldTask.parentTaskId === null) {
                newRootTaskIdByOrderKey = newRootTaskIdByOrderKey.delete(oldTask.orderKey);

                const previousTaskEntry = state.rootTaskIdByOrderKey.getEntryBefore(
                    oldTask.orderKey,
                );
                if (!previousTaskEntry) {
                    const nextTaskEntry = state.rootTaskIdByOrderKey.getEntryAfter(
                        oldTask.orderKey,
                    );

                    return {
                        ...state,
                        taskById: newTaskById,
                        rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                        taskEffectRef: {
                            current: {
                                taskId: nextTaskEntry?.[1] ?? state.ghostTaskId,
                                effect: view => view.focusTitleStart(),
                            },
                        },
                    };
                } else {
                    let previousTask = assertExists(state.taskById.get(previousTaskEntry[1]));

                    // If the task has children then the actual previous task, visually, is the
                    // last child task.
                    while (previousTask.isExpanded && previousTask.childTaskIdByOrderKey.size > 0) {
                        const lastChildTaskEntry: [OrderKey, LocalTaskId] =
                            previousTask.childTaskIdByOrderKey.getLastEntry()!;
                        previousTask = assertExists(state.taskById.get(lastChildTaskEntry[1]));
                    }

                    return {
                        ...state,
                        taskById: newTaskById,
                        rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                        taskEffectRef: {
                            current: {
                                taskId: previousTask.id,
                                effect: view => view.focusTitleEnd(),
                            },
                        },
                    };
                }
            } else {
                const oldParentTask = assertExists(state.taskById.get(oldTask.parentTaskId));

                const newParentTask: LocalTask = {
                    ...oldParentTask,
                    childTaskIdByOrderKey: oldParentTask.childTaskIdByOrderKey.delete(
                        oldTask.orderKey,
                    ),
                };
                newTaskById.set(newParentTask.id, newParentTask);

                // If there is no previous task at this level then pressing delete will join
                // with the parent task.
                const previousTaskEntry = oldParentTask.childTaskIdByOrderKey.getEntryBefore(
                    oldTask.orderKey,
                );
                if (!previousTaskEntry) {
                    return {
                        ...state,
                        taskById: newTaskById,
                        rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                        taskEffectRef: {
                            current: {
                                taskId: newParentTask.id,
                                effect: view => view.focusTitleEnd(),
                            },
                        },
                    };
                } else {
                    let previousTask = assertExists(state.taskById.get(previousTaskEntry[1]));

                    // If the task has children then the actual previous task, visually, is the
                    // last child task.
                    while (previousTask.isExpanded && previousTask.childTaskIdByOrderKey.size > 0) {
                        const lastChildTaskEntry: [OrderKey, LocalTaskId] =
                            previousTask.childTaskIdByOrderKey.getLastEntry()!;
                        previousTask = assertExists(state.taskById.get(lastChildTaskEntry[1]));
                    }

                    return {
                        ...state,
                        taskById: newTaskById,
                        rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                        taskEffectRef: {
                            current: {
                                taskId: previousTask.id,
                                effect: view => view.focusTitleEnd(),
                            },
                        },
                    };
                }
            }
        }

        case "IndentTask": {
            const oldTask = state.taskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            const oldPreviousTask = state.taskById.get(action.previousTaskId);
            if (!oldPreviousTask) throw new NotFoundError("Previous task not found");

            const oldTaskParentStack = getLocalTaskParentStack(state, oldTask);
            const oldPreviousTaskParentStack = getLocalTaskParentStack(state, oldPreviousTask);

            // If our task is already indented under the previous task we can't indent
            // it anymore.
            if (oldTaskParentStack.length > oldPreviousTaskParentStack.length) {
                return state;
            }

            const newTaskById = new Map(state.taskById);
            let newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey;

            const oldNewParentTask =
                oldTaskParentStack.length < oldPreviousTaskParentStack.length
                    ? oldPreviousTaskParentStack[oldTaskParentStack.length]!
                    : oldPreviousTask;

            // Remove our task from its old parent.
            if (!oldTask.parentTaskId) {
                newRootTaskIdByOrderKey = newRootTaskIdByOrderKey.delete(oldTask.orderKey);
            } else {
                const oldOldParentTask = assertExists(state.taskById.get(oldTask.parentTaskId));

                const newOldParentTask: LocalTask = {
                    ...oldOldParentTask,
                    childTaskIdByOrderKey: oldOldParentTask.childTaskIdByOrderKey.delete(
                        oldTask.orderKey,
                    ),
                };

                newTaskById.set(newOldParentTask.id, newOldParentTask);
            }

            // Add our task to its new parent.
            {
                const newOrderKey = generateOrderKeyBetween(
                    oldNewParentTask.childTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
                    null,
                );

                const newTask: LocalTask = {
                    ...oldTask,
                    parentTaskId: oldNewParentTask.id,
                    orderKey: newOrderKey,
                };

                const newNewParentTask: LocalTask = {
                    ...oldNewParentTask,
                    childTaskIdByOrderKey: oldNewParentTask.childTaskIdByOrderKey.set(
                        newOrderKey,
                        newTask.id,
                    ),
                    // Make sure the task we are indenting into is expanded so we don't lose
                    // the task.
                    isExpanded: true,
                };

                newTaskById.set(newTask.id, newTask);
                newTaskById.set(newNewParentTask.id, newNewParentTask);
            }

            return {
                ...state,
                taskById: newTaskById,
                rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
            };
        }

        case "DedentTask": {
            const oldTask = state.taskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            const oldTaskParentStack = getLocalTaskParentStack(state, oldTask);

            // This is already a root task.
            if (oldTaskParentStack.length === 0) return state;

            const newTaskById = new Map(state.taskById);
            let newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey;

            const oldOldParentTask = oldTaskParentStack[oldTaskParentStack.length - 1]!;
            const oldNewParentTask =
                oldTaskParentStack.length > 1
                    ? oldTaskParentStack[oldTaskParentStack.length - 2]!
                    : null;

            // Remove our task from its old parent.
            {
                const newOldParentTask: LocalTask = {
                    ...oldOldParentTask,
                    childTaskIdByOrderKey: oldOldParentTask.childTaskIdByOrderKey.delete(
                        oldTask.orderKey,
                    ),
                };

                newTaskById.set(newOldParentTask.id, newOldParentTask);
            }

            // Add our task to its new parent.
            {
                const newOrderKey = generateOrderKeyBetween(
                    oldOldParentTask.orderKey,
                    oldOldParentTask.parentTaskId
                        ? assertExists(
                              state.taskById.get(oldOldParentTask.parentTaskId),
                          ).childTaskIdByOrderKey.getEntryAfter(oldOldParentTask.orderKey)?.[0] ??
                              null
                        : state.rootTaskIdByOrderKey.getEntryAfter(
                              oldOldParentTask.orderKey,
                          )?.[0] ?? null,
                );

                if (!oldNewParentTask) {
                    const newTask: LocalTask = {
                        ...oldTask,
                        parentTaskId: null,
                        orderKey: newOrderKey,
                    };

                    newTaskById.set(newTask.id, newTask);
                    newRootTaskIdByOrderKey = newRootTaskIdByOrderKey.set(newOrderKey, newTask.id);
                } else {
                    const newTask: LocalTask = {
                        ...oldTask,
                        parentTaskId: oldNewParentTask.id,
                        orderKey: newOrderKey,
                    };

                    const newNewParentTask: LocalTask = {
                        ...oldNewParentTask,
                        childTaskIdByOrderKey: oldNewParentTask.childTaskIdByOrderKey.set(
                            newOrderKey,
                            newTask.id,
                        ),
                    };

                    newTaskById.set(newTask.id, newTask);
                    newTaskById.set(newNewParentTask.id, newNewParentTask);
                }
            }

            return {
                ...state,
                taskById: newTaskById,
                rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
            };
        }

        default:
            throw exhaustive(action);
    }
}

function getLocalTaskParentStack(state: LocalTasksState, task: LocalTask): Array<LocalTask> {
    const parentStack: Array<LocalTask> = [];

    let parentTaskId: LocalTaskId | null = task.parentTaskId;
    while (parentTaskId) {
        const parentTask = assertExists(state.taskById.get(parentTaskId));
        parentStack.push(parentTask);

        parentTaskId = parentTask.parentTaskId;
    }

    parentStack.reverse();
    return parentStack;
}

export function useLocalTasksState(): [LocalTasksState, Memo<(action: LocalTasksAction) => void>] {
    const [state, dispatch] = useReducer(reduceLocalTasksState, null, getInitialLocalTasksState);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const serializedStateString = localStorage.getItem("tasksLocalState");
        if (serializedStateString !== null) {
            dispatch({type: "RestoreState", serializedStateString});
        }
    }, []);

    useEffect(() => {
        const serializedState = LocalTasksStateSchema.serialize(state);
        const serializedStateString = JSON.stringify(serializedState);
        localStorage.setItem("tasksLocalState", serializedStateString);
    }, [state]);

    useDevConsoleTool("localTasksState", () => ({
        reset: () => dispatch({type: "ResetState"}),
    }));

    return [state, dispatch as Memo<(action: LocalTasksAction) => void>];
}
