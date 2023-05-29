import {Memo, useEffect, useReducer, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {DataLossError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {TaskTitleSchema} from "~/shared/tasks/task_title_schema";

const LocalTaskIdByOrderKeySchema = Schema.map(OrderKeySchema, Schema.id<LocalTaskId>()).transform<
    ImmutableMap<OrderKey, LocalTaskId>
>({
    serialize: taskIdByOrderKey => new Map(taskIdByOrderKey),
    deserialize: taskIdByOrderKey => ImmutableMap.from(taskIdByOrderKey),
});

export type LocalTask = SchemaType<typeof LocalTaskSchema>;

const LocalTaskSchema = Schema.object({
    id: Schema.id<LocalTaskId>(),
    status: Schema.enum(["Open", "Closed"]),
    title: TaskTitleSchema,
    parentTaskId: Schema.id<LocalTaskId>().nullable(),
    childTaskIdByOrderKey: LocalTaskIdByOrderKeySchema,
});

class LocalTasksDatabase {
    private readonly _taskById: ImmutableMap<LocalTaskId, LocalTask>;

    private readonly _notepadPageCount: number;

    private readonly _taskIdByOrderKeyByNotepadPage: ImmutableMap<
        number,
        ImmutableMap<OrderKey, LocalTaskId>
    >;

    private constructor({
        taskById,
        notepadPageCount,
        taskIdByOrderKeyByNotepadPage,
    }: {
        taskById: ImmutableMap<LocalTaskId, LocalTask>;
        notepadPageCount: number;
        taskIdByOrderKeyByNotepadPage: ImmutableMap<number, ImmutableMap<OrderKey, LocalTaskId>>;
    }) {
        // Validations that only run in local development to ensure the data structure
        // is formatted properly.
        if (process.env.NODE_ENV !== "production") {
            for (const [taskId, task] of taskById) {
                assert(taskId === task.id, "Key in `taskById` does not match value");

                assert(
                    !task.parentTaskId || taskById.has(task.parentTaskId),
                    "Parent task must exist",
                );

                for (const childTaskId of task.childTaskIdByOrderKey.values()) {
                    assert(
                        taskById.get(childTaskId)?.parentTaskId === task.id,
                        "Child task must exist and must have the correct parent task",
                    );
                }
            }

            assert(
                Number.isInteger(notepadPageCount) && notepadPageCount >= 1,
                "Notepad page count must be a positive non-zero integer",
            );

            for (const [notepadPage, taskIdByOrderKey] of taskIdByOrderKeyByNotepadPage) {
                assert(
                    Number.isInteger(notepadPage) &&
                        1 <= notepadPage &&
                        notepadPage <= notepadPageCount,
                    "Notepad page must be in notepad page count range",
                );

                for (const taskId of taskIdByOrderKey.values()) {
                    assert(taskById.has(taskId), "Notepad task must exist");
                }
            }
        }

        this._taskById = taskById;
        this._notepadPageCount = notepadPageCount;
        this._taskIdByOrderKeyByNotepadPage = taskIdByOrderKeyByNotepadPage;
    }

    public static readonly empty = new LocalTasksDatabase({
        taskById: ImmutableMap.empty(),
        notepadPageCount: 1,
        taskIdByOrderKeyByNotepadPage: ImmutableMap.empty(),
    });

    public serialize(): SchemaType<typeof LocalTasksDatabaseInternalSchema> {
        return {
            taskById: new Map(this._taskById),
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: new Map(this._taskIdByOrderKeyByNotepadPage),
        };
    }

    public static deserialize(data: SchemaType<typeof LocalTasksDatabaseInternalSchema>) {
        return new LocalTasksDatabase({
            taskById: ImmutableMap.from(data.taskById),
            notepadPageCount: data.notepadPageCount,
            taskIdByOrderKeyByNotepadPage: ImmutableMap.from(data.taskIdByOrderKeyByNotepadPage),
        });
    }

    public getNotepadPageCount() {
        return this._notepadPageCount;
    }

    public createNotepadPage() {
        return new LocalTasksDatabase({
            taskById: this._taskById,
            notepadPageCount: this._notepadPageCount + 1,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }
}

const LocalTasksDatabaseInternalSchema = Schema.object({
    taskById: Schema.map(Schema.id<LocalTaskId>(), LocalTaskSchema),
    notepadPageCount: Schema.integer.min(1),
    taskIdByOrderKeyByNotepadPage: Schema.map(Schema.integer.min(1), LocalTaskIdByOrderKeySchema),
});

const LocalTasksDatabaseSchema = LocalTasksDatabaseInternalSchema.transform<LocalTasksDatabase>({
    serialize: database => database.serialize(),
    deserialize: database => LocalTasksDatabase.deserialize(database),
});

type LocalTasksState = SchemaType<typeof LocalTasksStateSchema>;

const LocalTasksStateSchema = Schema.object({
    database: LocalTasksDatabaseSchema,
});

function getInitialLocalTasksState(): LocalTasksState {
    return {
        database: LocalTasksDatabase.empty,
    };
}

export type LocalTasksAction =
    | LocalTasksRestoreStateAction
    | LocalTasksResetStateAction
    | LocalTasksCreateNotepadPageAction;

type LocalTasksRestoreStateAction = {
    readonly type: "RestoreState";
    readonly serializedStateString: string;
};

type LocalTasksResetStateAction = {
    readonly type: "ResetState";
};

type LocalTasksCreateNotepadPageAction = {
    readonly type: "CreateNotepadPage";
};

function reduceLocalTasksState(state: LocalTasksState, action: LocalTasksAction): LocalTasksState {
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

        case "CreateNotepadPage": {
            return {
                ...state,
                database: state.database.createNotepadPage(),
            };
        }

        default:
            throw exhaustive(action);
    }
}

function maybeRestoreLocalTasksState(shouldRestoreState: boolean): LocalTasksState {
    let state = getInitialLocalTasksState();

    if (shouldRestoreState) {
        const serializedStateString = localStorage.getItem("tasksLocalState2");
        if (serializedStateString !== null) {
            state = reduceLocalTasksState(state, {type: "RestoreState", serializedStateString});
        }
    }

    return state;
}

export function useLocalTasksState(): [LocalTasksState, Memo<(action: LocalTasksAction) => void>] {
    const isInitialAppRender = useIsInitialAppRender();
    const [state, dispatch] = useReducer(
        reduceLocalTasksState,
        !isInitialAppRender,
        maybeRestoreLocalTasksState,
    );

    const shouldRestoreStateRef = useRef(isInitialAppRender);
    useEffect(() => {
        if (shouldRestoreStateRef.current) return;
        shouldRestoreStateRef.current = true;

        const serializedStateString = localStorage.getItem("tasksLocalState2");
        if (serializedStateString !== null) {
            dispatch({type: "RestoreState", serializedStateString});
        }
    }, []);

    useEffect(() => {
        if (isInitialAppRender) return;

        const serializedState = LocalTasksStateSchema.serialize(state);
        const serializedStateString = JSON.stringify(serializedState);
        localStorage.setItem("tasksLocalState2", serializedStateString);
    }, [isInitialAppRender, state]);

    useDevConsoleTool("localTasksState", () => ({
        reset: () => dispatch({type: "ResetState"}),
    }));

    return [state, dispatch as Memo<(action: LocalTasksAction) => void>];
}
