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
import {DataLossError, NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

// TODO(calebmer): We store state locally for our task prototype. Once we land
// on an interaction experience we like, this should all be moved to a
// realtime, collaborative, server implementation.

export type LocalTask = SchemaType<typeof LocalTaskSchema>;

const LocalTaskSchema = Schema.object({
    id: Schema.id<LocalTaskId>(),
    title: TaskTitleSchema,
    orderKey: OrderKeySchema,
});

export type LocalTasksState = SchemaType<typeof LocalTasksStateSchema>;

const LocalTasksStateSchema = Schema.object({
    taskById: Schema.map(Schema.id<LocalTaskId>(), LocalTaskSchema),
    taskIdByOrderKey: Schema.map(OrderKeySchema, Schema.id<LocalTaskId>()).transform<
        ImmutableMap<OrderKey, LocalTaskId>
    >({
        serialize: taskIdByOrderKey => new Map(taskIdByOrderKey),
        deserialize: taskIdByOrderKey => ImmutableMap.from(taskIdByOrderKey),
    }),
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
        taskIdByOrderKey: ImmutableMap.empty(),
        ghostTaskId: generateId(),
        taskEffectRef: {current: null},
    };
}

export type LocalTasksAction =
    | LocalTasksRestoreStateAction
    | LocalTasksResetStateAction
    | LocalTasksUpdateTaskTitleAction
    | LocalTasksSplitTaskFromTitleAction
    | LocalTasksJoinTaskFromTitleAction;

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

type LocalTasksSplitTaskFromTitleAction = {
    readonly type: "SplitTaskFromTitle";
    readonly taskId: LocalTaskId;
    readonly titleSelection: Selection;
};

type LocalTasksJoinTaskFromTitleAction = {
    readonly type: "JoinTaskFromTitle";
    readonly deleteTaskId: LocalTaskId;
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
            iterableEvery(
                newState.taskById.values(),
                task => newState.taskIdByOrderKey.get(task.orderKey) === task.id,
            ),
            "Every task in `taskById` must be present in `taskIdByOrderKey`",
        );
        assert(
            iterableEvery(newState.taskIdByOrderKey, ([orderKey, taskId]) =>
                newState.taskById.has(taskId),
            ),
            "Every task in `taskIdByOrderKey` must be present in `taskById`",
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
                    title: action.title,
                    orderKey: generateOrderKeyBetween(
                        state.taskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    ),
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newTask.id, newTask);

                const newTaskIdByOrderKey = state.taskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    taskIdByOrderKey: newTaskIdByOrderKey,
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
        case "SplitTaskFromTitle": {
            // If we are splitting a ghost task, then create the ghost task and move focus
            // to the new ghost task.
            if (action.taskId === state.ghostTaskId) {
                const newTask: LocalTask = {
                    id: state.ghostTaskId,
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        state.taskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    ),
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newTask.id, newTask);

                const newTaskIdByOrderKey = state.taskIdByOrderKey.set(
                    newTask.orderKey,
                    newTask.id,
                );

                const newGhostTaskId = generateId<LocalTaskId>();

                return {
                    ...state,
                    taskById: newTaskById,
                    taskIdByOrderKey: newTaskIdByOrderKey,
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
                const newSplitTask: LocalTask = {
                    id: generateId(),
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        state.taskIdByOrderKey.getEntryBefore(oldTask.orderKey)?.[0] ?? null,
                        oldTask.orderKey,
                    ),
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newSplitTask.id, newSplitTask);

                const newTaskIdByOrderKey = state.taskIdByOrderKey.set(
                    newSplitTask.orderKey,
                    newSplitTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    taskIdByOrderKey: newTaskIdByOrderKey,
                };
            }

            // If the selection is at the end of the title then add an empty task below and
            // move focus to that empty task.
            if (
                action.titleSelection.from === action.titleSelection.to &&
                action.titleSelection.from === oldTask.title.nodeSize - 2
            ) {
                const newSplitTask: LocalTask = {
                    id: generateId(),
                    title: emptyTaskTitle,
                    orderKey: generateOrderKeyBetween(
                        oldTask.orderKey,
                        state.taskIdByOrderKey.getEntryAfter(oldTask.orderKey)?.[0] ?? null,
                    ),
                };

                const newTaskById = new Map(state.taskById);
                newTaskById.set(newSplitTask.id, newSplitTask);

                const newTaskIdByOrderKey = state.taskIdByOrderKey.set(
                    newSplitTask.orderKey,
                    newSplitTask.id,
                );

                return {
                    ...state,
                    taskById: newTaskById,
                    taskIdByOrderKey: newTaskIdByOrderKey,
                    taskEffectRef: {
                        current: {
                            taskId: newSplitTask.id,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            }

            const newTask: LocalTask = {
                ...oldTask,
                title: assertTaskTitle(oldTask.title.cut(0, action.titleSelection.from)),
            };

            const newSplitTask: LocalTask = {
                id: generateId(),
                title: assertTaskTitle(oldTask.title.cut(action.titleSelection.to)),
                orderKey: generateOrderKeyBetween(
                    oldTask.orderKey,
                    state.taskIdByOrderKey.getEntryAfter(oldTask.orderKey)?.[0] ?? null,
                ),
            };

            const newTaskById = new Map(state.taskById);
            newTaskById.set(newTask.id, newTask);
            newTaskById.set(newSplitTask.id, newSplitTask);

            const newTaskIdByOrderKey = state.taskIdByOrderKey.set(
                newSplitTask.orderKey,
                newSplitTask.id,
            );

            return {
                ...state,
                taskById: newTaskById,
                taskIdByOrderKey: newTaskIdByOrderKey,
                taskEffectRef: {
                    current: {
                        taskId: newSplitTask.id,
                        effect: view => view.focusTitleStart(),
                    },
                },
            };
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
        case "JoinTaskFromTitle": {
            // You can't delete a ghost task. So move focus to the last entry instead.
            if (action.deleteTaskId === state.ghostTaskId) {
                const lastTaskEntry = state.taskIdByOrderKey.getLastEntry();
                if (!lastTaskEntry) return state;

                const lastTask = assertExists(state.taskById.get(lastTaskEntry[1]));

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
            newTaskById.delete(oldDeleteTask.id);

            const newTaskIdByOrderKey = state.taskIdByOrderKey.delete(oldDeleteTask.orderKey);

            // If there is no previous task pressing delete can not join back. If the task
            // title is empty we will delete the task. This way if you have only one task
            // you can still delete it.
            const previousTaskEntry = state.taskIdByOrderKey.getEntryBefore(oldDeleteTask.orderKey);
            if (!previousTaskEntry) {
                if (oldDeleteTask.title.childCount > 0) return state;

                const nextTaskEntry = state.taskIdByOrderKey.getEntryAfter(oldDeleteTask.orderKey);

                return {
                    ...state,
                    taskById: newTaskById,
                    taskIdByOrderKey: newTaskIdByOrderKey,
                    taskEffectRef: {
                        current: {
                            taskId: nextTaskEntry?.[1] ?? state.ghostTaskId,
                            effect: view => view.focusTitleStart(),
                        },
                    },
                };
            }

            const oldPreviousTask = assertExists(state.taskById.get(previousTaskEntry[1]));

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
                taskIdByOrderKey: newTaskIdByOrderKey,
                taskEffectRef: {
                    current: {
                        taskId: oldPreviousTask.id,
                        effect: view => view.focusTitlePos(oldPreviousTask.title.nodeSize - 2),
                    },
                },
            };
        }

        default:
            throw exhaustive(action);
    }
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
