import {useEffect, useReducer, useRef} from "react";
import {DataLossError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

// TODO(calebmer): We store state locally for our task prototype. Once we land
// on an interaction experience we like, this should all be moved to a
// realtime, collaborative, server implementation.
export type LocalTasksState = SchemaType<typeof LocalTasksStateSchema>;

const LocalTaskSchema = Schema.object({
    id: Schema.id<LocalTaskId>(),
    name: LabelStringSchema,
    orderKey: OrderKeySchema,
});

const LocalTasksStateSchema = Schema.object({
    ghostTaskId: Schema.id<LocalTaskId>(),
    taskById: Schema.map(Schema.id<LocalTaskId>(), LocalTaskSchema),
    taskIdByOrderKey: Schema.map(OrderKeySchema, Schema.id<LocalTaskId>()),
});

function getInitialLocalTasksState(): LocalTasksState {
    return {
        ghostTaskId: generateId(),
        taskById: new Map(),
        taskIdByOrderKey: new Map(),
    };
}

export type LocalTasksAction = LocalTasksRestoreStateAction;

type LocalTasksRestoreStateAction = {
    readonly type: "RestoreState";
    readonly serializedStateString: string;
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
    oldState: LocalTasksState,
    action: LocalTasksAction,
): LocalTasksState {
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

        return oldState;
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

    return [state, dispatch];
}
