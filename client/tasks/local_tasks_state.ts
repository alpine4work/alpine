import {useEffect, useReducer, useRef} from "react";
import {Schema, SchemaType} from "~/shared/schema/schema";

// TODO(calebmer): We store state locally for our task prototype. Once we land
// on an interaction experience we like, this should all be moved to a
// realtime, collaborative, server implementation.
export type LocalTasksState = SchemaType<typeof LocalTasksStateSchema>;

const LocalTasksStateSchema = Schema.object({});

const initialLocalTasksState: LocalTasksState = {};

export type LocalTasksAction = LocalTasksRestoreStateAction;

type LocalTasksRestoreStateAction = {
    readonly type: "RestoreState";
    readonly serializedStateString: string;
};

function reduceLocalTasksState(
    oldState: LocalTasksState,
    action: LocalTasksAction,
): LocalTasksState {
    try {
        const serializedState = JSON.parse(action.serializedStateString);
        return LocalTasksStateSchema.deserialize(serializedState);
    } catch (error) {
        // This is for local development only. Don't bother reporting errors.
        // eslint-disable-next-line no-console
        console.error(error);
        return oldState;
    }
}

export function useLocalTasksState(): [LocalTasksState, (action: LocalTasksAction) => void] {
    const [state, dispatch] = useReducer(reduceLocalTasksState, initialLocalTasksState);

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
