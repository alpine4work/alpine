import {Selection} from "prosemirror-state";
import {Memo, MutableRefObject, useEffect, useReducer, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {TaskRowViewRef} from "~/client/tasks/internal/task_row_view";
import {
    TaskTitle,
    TaskTitleSchema,
    assertTaskTitle,
    emptyTaskTitle,
} from "~/client/tasks/internal/task_title_schema";
import {DataLossError, FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

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
    | LocalTasksSplitTaskTitleAction
    | LocalTasksJoinTaskTitleAction
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

type LocalTasksSplitTaskTitleAction = {
    readonly type: "SplitTaskTitle";
    readonly taskId: LocalTaskId;
    readonly titleSelection: Selection;
};

type LocalTasksJoinTaskTitleAction = {
    readonly type: "JoinTaskTitle";
    readonly deleteTaskId: LocalTaskId;
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

        // When the enter key is pressed we dispatch this action to create a new task.
        //
        // Our task view uses paradigms from a text editor for ease of use. In a text
        // editor the enter key is used to create newlines but more generically,
        // depending on the selection, it is used to "split" content. If the cursor
        // is in the middle of text it puts the text after the cursor on a newline.
        //
        // We could break this paradigm and only create tasks after the current task
        // when the user hits enter. However, one nice property is if the user hits
        // enter at the start of a task title it creates a task above instead of below!
        // We believe making this behavior easy and intuitive is worth the slightly
        // uncommon capability of being able to split tasks in half.
        case "SplitTaskTitle": {
            // If we are splitting a ghost task, then create the ghost task and move focus
            // to the new ghost task.
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

            const oldTask = state.taskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            // If the selection is at the start of the title then add an empty task above
            // and keep focus in the existing task.
            if (
                action.titleSelection.from === action.titleSelection.to &&
                action.titleSelection.from === 0
            ) {
                if (oldTask.parentTaskId === null) {
                    const newSplitTask: LocalTask = {
                        id: generateId(),
                        isOpen: true,
                        title: emptyTaskTitle,
                        orderKey: generateOrderKeyBetween(
                            state.rootTaskIdByOrderKey.getEntryBefore(oldTask.orderKey)?.[0] ??
                                null,
                            oldTask.orderKey,
                        ),
                        parentTaskId: null,
                        childTaskIdByOrderKey: ImmutableMap.empty(),
                    };

                    const newTaskById = new Map(state.taskById);
                    newTaskById.set(newSplitTask.id, newSplitTask);

                    const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                        newSplitTask.orderKey,
                        newSplitTask.id,
                    );

                    return {
                        ...state,
                        taskById: newTaskById,
                        rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                    };
                } else {
                    const oldParentTask = assertExists(state.taskById.get(oldTask.parentTaskId));

                    const newSplitTask: LocalTask = {
                        id: generateId(),
                        isOpen: true,
                        title: emptyTaskTitle,
                        orderKey: generateOrderKeyBetween(
                            oldParentTask.childTaskIdByOrderKey.getEntryBefore(
                                oldTask.orderKey,
                            )?.[0] ?? null,
                            oldTask.orderKey,
                        ),
                        parentTaskId: oldTask.parentTaskId,
                        childTaskIdByOrderKey: ImmutableMap.empty(),
                    };

                    const newParentTask: LocalTask = {
                        ...oldParentTask,
                        childTaskIdByOrderKey: oldParentTask.childTaskIdByOrderKey.set(
                            newSplitTask.orderKey,
                            newSplitTask.id,
                        ),
                    };

                    const newTaskById = new Map(state.taskById);
                    newTaskById.set(newSplitTask.id, newSplitTask);
                    newTaskById.set(newParentTask.id, newParentTask);

                    return {
                        ...state,
                        taskById: newTaskById,
                    };
                }
            }

            // If the task has some children then creating a new task puts that new task as
            // the first child to avoid jumping around in the scroll position.
            if (oldTask.childTaskIdByOrderKey.size > 0) {
                const newTaskById = new Map(state.taskById);

                let newTask: LocalTask = oldTask;

                if (
                    action.titleSelection.from !== action.titleSelection.to ||
                    action.titleSelection.from !== oldTask.title.nodeSize - 2
                ) {
                    newTask = {
                        ...oldTask,
                        title: assertTaskTitle(oldTask.title.cut(0, action.titleSelection.from)),
                    };

                    newTaskById.set(newTask.id, newTask);
                }

                const newSplitTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: assertTaskTitle(oldTask.title.cut(action.titleSelection.to)),
                    orderKey: generateOrderKeyBetween(
                        null,
                        oldTask.childTaskIdByOrderKey.getEntryAfter(oldTask.orderKey)?.[0] ?? null,
                    ),
                    parentTaskId: oldTask.id,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                };

                newTask = {
                    ...newTask,
                    childTaskIdByOrderKey: newTask.childTaskIdByOrderKey.set(
                        newSplitTask.orderKey,
                        newSplitTask.id,
                    ),
                };

                newTaskById.set(newSplitTask.id, newSplitTask);
                newTaskById.set(newTask.id, newTask);

                return {
                    ...state,
                    taskById: newTaskById,
                    taskEffectRef: {
                        current: {
                            taskId: newSplitTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            } else if (oldTask.parentTaskId === null) {
                const newTaskById = new Map(state.taskById);

                if (
                    action.titleSelection.from !== action.titleSelection.to ||
                    action.titleSelection.from !== oldTask.title.nodeSize - 2
                ) {
                    const newTask: LocalTask = {
                        ...oldTask,
                        title: assertTaskTitle(oldTask.title.cut(0, action.titleSelection.from)),
                    };

                    newTaskById.set(newTask.id, newTask);
                }

                const newSplitTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: assertTaskTitle(oldTask.title.cut(action.titleSelection.to)),
                    orderKey: generateOrderKeyBetween(
                        oldTask.orderKey,
                        state.rootTaskIdByOrderKey.getEntryAfter(oldTask.orderKey)?.[0] ?? null,
                    ),
                    parentTaskId: null,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                };

                newTaskById.set(newSplitTask.id, newSplitTask);

                const newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey.set(
                    newSplitTask.orderKey,
                    newSplitTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                    taskEffectRef: {
                        current: {
                            taskId: newSplitTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            } else {
                const oldParentTask = assertExists(state.taskById.get(oldTask.parentTaskId));

                const newTaskById = new Map(state.taskById);

                if (
                    action.titleSelection.from !== action.titleSelection.to ||
                    action.titleSelection.from !== oldTask.title.nodeSize - 2
                ) {
                    const newTask: LocalTask = {
                        ...oldTask,
                        title: assertTaskTitle(oldTask.title.cut(0, action.titleSelection.from)),
                    };

                    newTaskById.set(newTask.id, newTask);
                }

                const newSplitTask: LocalTask = {
                    id: generateId(),
                    isOpen: true,
                    title: assertTaskTitle(oldTask.title.cut(action.titleSelection.to)),
                    orderKey: generateOrderKeyBetween(
                        oldTask.orderKey,
                        oldParentTask.childTaskIdByOrderKey.getEntryAfter(oldTask.orderKey)?.[0] ??
                            null,
                    ),
                    parentTaskId: oldTask.parentTaskId,
                    childTaskIdByOrderKey: ImmutableMap.empty(),
                };

                const newParentTask: LocalTask = {
                    ...oldParentTask,
                    childTaskIdByOrderKey: oldParentTask.childTaskIdByOrderKey.set(
                        newSplitTask.orderKey,
                        newSplitTask.id,
                    ),
                };

                newTaskById.set(newSplitTask.id, newSplitTask);
                newTaskById.set(newParentTask.id, newParentTask);

                return {
                    ...state,
                    taskById: newTaskById,
                    taskEffectRef: {
                        current: {
                            taskId: newSplitTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            }
        }

        // When the backspace key is pressed at the start of a task title we
        // dispatch this action to delete the task.
        //
        // Our task view uses paradigms from a text editor for ease of use. In a text
        // editor when you're at the start of a line and hit backspace it deletes the
        // line. If there was content on the line then that content is joined with the
        // previous line. So more generically we call backspace "join".
        //
        // Because deleting tasks is so easy (backspace press at the start of the title
        // input) and it's a little counter-intuitive we should probably have a warning
        // when you're about to delete a task filled with content.
        case "JoinTaskTitle": {
            // You can't delete a ghost task. So move focus to the last entry instead.
            if (action.deleteTaskId === state.ghostTaskId) {
                const lastRootTaskEntry = state.rootTaskIdByOrderKey.getLastEntry();
                if (!lastRootTaskEntry) return state;

                let lastTask = assertExists(state.taskById.get(lastRootTaskEntry[1]));
                while (lastTask.childTaskIdByOrderKey.size > 0) {
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

            const oldDeleteTask = state.taskById.get(action.deleteTaskId);
            if (!oldDeleteTask) throw new NotFoundError("Task not found");

            const newTaskById = new Map(state.taskById);
            let newRootTaskIdByOrderKey = state.rootTaskIdByOrderKey;

            newTaskById.delete(oldDeleteTask.id);

            let oldPreviousTask: LocalTask | null;
            if (oldDeleteTask.parentTaskId === null) {
                newRootTaskIdByOrderKey = newRootTaskIdByOrderKey.delete(oldDeleteTask.orderKey);

                const previousTaskEntry = state.rootTaskIdByOrderKey.getEntryBefore(
                    oldDeleteTask.orderKey,
                );
                if (!previousTaskEntry) {
                    oldPreviousTask = null;
                } else {
                    oldPreviousTask = assertExists(state.taskById.get(previousTaskEntry[1]));

                    // If the task has children then the actual previous task, visually, is the
                    // last child task.
                    while (oldPreviousTask.childTaskIdByOrderKey.size > 0) {
                        const lastChildTaskEntry: [OrderKey, LocalTaskId] =
                            oldPreviousTask.childTaskIdByOrderKey.getLastEntry()!;
                        oldPreviousTask = assertExists(state.taskById.get(lastChildTaskEntry[1]));
                    }
                }
            } else {
                const oldParentTask = assertExists(state.taskById.get(oldDeleteTask.parentTaskId));

                const newParentTask: LocalTask = {
                    ...oldParentTask,
                    childTaskIdByOrderKey: oldParentTask.childTaskIdByOrderKey.delete(
                        oldDeleteTask.orderKey,
                    ),
                };
                newTaskById.set(newParentTask.id, newParentTask);

                // If there is no previous task at this level then pressing delete will join
                // with the parent task.
                const previousTaskEntry = oldParentTask.childTaskIdByOrderKey.getEntryBefore(
                    oldDeleteTask.orderKey,
                );
                if (!previousTaskEntry) {
                    oldPreviousTask = newParentTask;
                } else {
                    oldPreviousTask = assertExists(state.taskById.get(previousTaskEntry[1]));

                    // If the task has children then the actual previous task, visually, is the
                    // last child task.
                    while (oldPreviousTask.childTaskIdByOrderKey.size > 0) {
                        const lastChildTaskEntry: [OrderKey, LocalTaskId] =
                            oldPreviousTask.childTaskIdByOrderKey.getLastEntry()!;
                        oldPreviousTask = assertExists(state.taskById.get(lastChildTaskEntry[1]));
                    }
                }
            }

            // If there is no previous task pressing delete can not join back. If the task
            // title is empty we will delete the task. This way if you have only one task
            // you can still delete it.
            if (!oldPreviousTask) {
                if (oldDeleteTask.title.childCount > 0) return state;

                const nextTaskEntry = state.rootTaskIdByOrderKey.getEntryAfter(
                    oldDeleteTask.orderKey,
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
            }

            if (oldDeleteTask.title.childCount > 0) {
                const newPreviousTask: LocalTask = {
                    ...oldPreviousTask,
                    title: assertTaskTitle(
                        oldPreviousTask.title.type.create(
                            null,
                            oldPreviousTask.title.content.append(oldDeleteTask.title.content),
                        ),
                    ),
                };

                newTaskById.set(newPreviousTask.id, newPreviousTask);
            }

            return {
                ...state,
                taskById: newTaskById,
                rootTaskIdByOrderKey: newRootTaskIdByOrderKey,
                taskEffectRef: {
                    current: {
                        taskId: oldPreviousTask.id,
                        effect: view => view.focusTitlePos(oldPreviousTask!.title.nodeSize - 2),
                    },
                },
            };
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
