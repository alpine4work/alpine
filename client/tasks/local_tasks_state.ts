import {MutableRefObject, useEffect, useReducer, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {DataLossError, FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
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
    name: Schema.string.maxLength(512).singleLine(),
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
    focusTaskRef: Schema.object({current: Schema.value(null)}).transform<
        MutableRefObject<{taskId: LocalTaskId; direction: "Start" | "End"} | null>
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
        focusTaskRef: {current: null},
    };
}

export type LocalTasksAction =
    | LocalTasksRestoreStateAction
    | LocalTasksResetStateAction
    | LocalTasksCreateTaskFromGhostAction
    | LocalTasksUpdateTaskNameAction
    | LocalTasksSplitTaskFromNameAction;

type LocalTasksRestoreStateAction = {
    readonly type: "RestoreState";
    readonly serializedStateString: string;
};

type LocalTasksResetStateAction = {
    readonly type: "ResetState";
};

type LocalTasksCreateTaskFromGhostAction = {
    readonly type: "CreateTaskFromGhost";
    readonly name: string;
};

type LocalTasksUpdateTaskNameAction = {
    readonly type: "UpdateTaskName";
    readonly taskId: LocalTaskId;
    readonly name: string;
};

type LocalTasksSplitTaskFromNameAction = {
    readonly type: "SplitTaskFromName";
    readonly taskId: LocalTaskId;
    readonly nameSelectionStart: number;
    readonly nameSelectionEnd: number;
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
        case "CreateTaskFromGhost": {
            const task: LocalTask = {
                id: state.ghostTaskId,
                name: action.name,
                orderKey: generateOrderKeyBetween(
                    state.taskIdByOrderKey.getLastEntry()?.[0] ?? null,
                    null,
                ),
            };

            const newTaskById = new Map(state.taskById);
            newTaskById.set(task.id, task);

            const newTaskIdByOrderKey = state.taskIdByOrderKey.set(task.orderKey, task.id);

            return {
                ...state,
                taskById: newTaskById,
                taskIdByOrderKey: newTaskIdByOrderKey,
                ghostTaskId: generateId(),
            };
        }
        case "UpdateTaskName": {
            if (action.taskId === state.ghostTaskId)
                throw new FailedPreconditionError("Can't update ghost task name");

            const newTaskById = new Map(state.taskById);
            const oldTask = newTaskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");
            newTaskById.set(action.taskId, {...oldTask, name: action.name});
            return {...state, taskById: newTaskById};
        }
        case "SplitTaskFromName": {
            // If we are splitting a ghost task, then create the ghost task and move focus
            // to the new ghost task.
            if (action.taskId === state.ghostTaskId) {
                state = actuallyReduceLocalTasksState(state, {
                    type: "CreateTaskFromGhost",
                    name: "",
                });
                return {
                    ...state,
                    focusTaskRef: {current: {taskId: state.ghostTaskId, direction: "Start"}},
                };
            }

            const oldTask = state.taskById.get(action.taskId);
            if (!oldTask) throw new NotFoundError("Task not found");

            // If the selection is at the start of the name then add an empty task above
            // and keep focus in the existing task.
            if (action.nameSelectionStart === 0 && action.nameSelectionEnd === 0) {
                const newSplitTask: LocalTask = {
                    id: generateId(),
                    name: "",
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

            // If the selection is at the end of the name then add an empty task below and
            // move focus to that empty task.
            if (
                action.nameSelectionStart === oldTask.name.length - 1 &&
                action.nameSelectionEnd === oldTask.name.length - 1
            ) {
                const newSplitTask: LocalTask = {
                    id: generateId(),
                    name: "",
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
                    focusTaskRef: {current: {taskId: newSplitTask.id, direction: "Start"}},
                };
            }

            const newTask: LocalTask = {
                ...oldTask,
                name: oldTask.name.slice(0, action.nameSelectionStart),
            };

            const newSplitTask: LocalTask = {
                id: generateId(),
                name: oldTask.name.slice(action.nameSelectionEnd),
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
                focusTaskRef: {current: {taskId: newSplitTask.id, direction: "Start"}},
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function useLocalTasksState(): [LocalTasksState, (action: LocalTasksAction) => void] {
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

    return [state, dispatch];
}
