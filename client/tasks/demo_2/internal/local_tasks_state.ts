import {Memo, MutableRefObject, useEffect, useReducer, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {TaskTitle, TaskTitleSchema, emptyTaskTitle} from "~/shared/tasks/task_title_schema";

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
            const validTaskIds = new Set<LocalTaskId>();

            const validateTask = (stack: Array<LocalTaskId>, task: LocalTask) => {
                if (validTaskIds.has(task.id)) return;

                assert(
                    !task.parentTaskId || taskById.has(task.parentTaskId),
                    "Parent task must exist",
                );

                assert(!stack.includes(task.id), "Tasks can not have parent/child cycles");

                stack.push(task.id);
                const childTaskIds = new Set<LocalTaskId>();
                for (const childTaskId of task.childTaskIdByOrderKey.values()) {
                    const childTask = taskById.get(childTaskId);

                    assert(!childTaskIds.has(childTaskId), "Child task IDs must be unique");
                    childTaskIds.add(childTaskId);

                    assert(
                        childTask?.parentTaskId === task.id,
                        "Child task must exist and must have the correct parent task",
                    );

                    validateTask(stack, childTask);
                }
                stack.pop();

                validTaskIds.add(task.id);
            };

            for (const [taskId, task] of taskById) {
                assert(taskId === task.id, "Key in `taskById` does not match value");
                validateTask([], task);
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

                const notepadPageTaskIds = new Set<LocalTaskId>();
                for (const taskId of taskIdByOrderKey.values()) {
                    assert(taskById.has(taskId), "Notepad task must exist");

                    assert(!notepadPageTaskIds.has(taskId), "Notepad page task IDs must be unique");
                    notepadPageTaskIds.add(taskId);
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

    public getTask(taskId: LocalTaskId) {
        const task = this._taskById.get(taskId);
        if (!task) throw new NotFoundError("Task not found");
        return task;
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

    private _validateNotepadPage(notepadPage: number) {
        if (!Number.isInteger(notepadPage))
            throw new InvalidArgumentError("Notepad page must be an integer");

        if (!(1 <= notepadPage && notepadPage <= this._notepadPageCount))
            throw new OutOfRangeError("Notepad page is out of range");
    }

    public getNotepadPageTasks(notepadPage: number): Iterable<[OrderKey, LocalTask]> {
        this._validateNotepadPage(notepadPage);

        return mapIterable(
            this._taskIdByOrderKeyByNotepadPage.get(notepadPage) ?? emptyArray,
            ([orderKey, taskId]) => [orderKey, assertExists(this._taskById.get(taskId))],
        );
    }

    public createTask(options?: LocalTasksDatabaseCreateTaskOptions) {
        return this.createAndReturnTask(options)[0];
    }

    public createAndReturnTask(options: LocalTasksDatabaseCreateTaskOptions = {}) {
        const task: LocalTask = {
            id: options.taskId ?? generateId(),
            status: "Open",
            title: options.title ?? emptyTaskTitle,
            parentTaskId: options.parentTask?.id ?? null,
            childTaskIdByOrderKey: ImmutableMap.empty(),
        };

        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPage = this._taskIdByOrderKeyByNotepadPage;

        if (taskById.has(task.id)) throw new FailedPreconditionError("Task IDs must be unique");

        taskById = taskById.set(task.id, task);

        if (options.parentTask) {
            let parentTask = taskById.get(options.parentTask.id);
            if (!parentTask) throw new NotFoundError("Parent task not found");

            let orderKey: OrderKey;
            if ((options.parentTask.side ?? options.side ?? "Below") === "Above") {
                if (options.parentTask.orderKey) {
                    orderKey = generateOrderKeyBetween(
                        parentTask.childTaskIdByOrderKey.getEntryBefore(
                            options.parentTask.orderKey,
                        )?.[0] ?? null,
                        options.parentTask.orderKey,
                    );
                } else {
                    orderKey = generateOrderKeyBetween(
                        null,
                        parentTask.childTaskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                    );
                }
            } else {
                if (options.parentTask.orderKey) {
                    orderKey = generateOrderKeyBetween(
                        options.parentTask.orderKey,
                        parentTask.childTaskIdByOrderKey.getEntryAfter(
                            options.parentTask.orderKey,
                        )?.[0] ?? null,
                    );
                } else {
                    orderKey = generateOrderKeyBetween(
                        parentTask.childTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    );
                }
            }

            parentTask = {
                ...parentTask,
                childTaskIdByOrderKey: parentTask.childTaskIdByOrderKey.set(orderKey, task.id),
            };

            taskById = taskById.set(parentTask.id, parentTask);
        }

        if (options.notepad) {
            this._validateNotepadPage(options.notepad.page);

            let taskIdByOrderKey =
                taskIdByOrderKeyByNotepadPage.get(options.notepad.page) ?? ImmutableMap.empty();

            let orderKey: OrderKey;
            if ((options.notepad.side ?? options.side ?? "Below") === "Above") {
                if (options.notepad.orderKey) {
                    orderKey = generateOrderKeyBetween(
                        taskIdByOrderKey.getEntryBefore(options.notepad.orderKey)?.[0] ?? null,
                        options.notepad.orderKey,
                    );
                } else {
                    orderKey = generateOrderKeyBetween(
                        null,
                        taskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                    );
                }
            } else {
                if (options.notepad.orderKey) {
                    orderKey = generateOrderKeyBetween(
                        options.notepad.orderKey,
                        taskIdByOrderKey.getEntryAfter(options.notepad.orderKey)?.[0] ?? null,
                    );
                } else {
                    orderKey = generateOrderKeyBetween(
                        taskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    );
                }
            }

            taskIdByOrderKey = taskIdByOrderKey.set(orderKey, task.id);

            taskIdByOrderKeyByNotepadPage = taskIdByOrderKeyByNotepadPage.set(
                options.notepad.page,
                taskIdByOrderKey,
            );
        }

        return [
            new LocalTasksDatabase({
                taskById,
                notepadPageCount: this._notepadPageCount,
                taskIdByOrderKeyByNotepadPage,
            }),
            task,
        ] as const;
    }
}

type LocalTasksDatabaseCreateTaskOptions = {
    /**
     * The ID to use for this task. The ID should not yet exist in our database. If
     * not provided then we will generate an ID.
     */
    taskId?: LocalTaskId;

    /**
     * The title of the new task.
     */
    title?: TaskTitle;

    /**
     * Set this to create a task with another task as its parent.
     *
     * Provide an `orderKey` to specify where in the parent's child tasks you want
     * to create this task. You may use `side` to specify whether you want to
     * create the task above or below the provided `orderKey`.
     *
     * If an `orderKey` is not provided then we create the start or end of the
     * parent's child tasks depending on `side`.
     *
     * `side` defaults to `Below`.
     */
    parentTask?: {id: LocalTaskId; orderKey?: OrderKey; side?: "Above" | "Below"};

    /**
     * Set this to create a task in a notepad page.
     *
     * Provide an `orderKey` to specify where in the notepad page you want to
     * create this task. You may use `side` to specify whether you want to
     * create the task above or below the provided `orderKey`.
     *
     * If an `orderKey` is not provided then we create the start or end of the
     * parent's child tasks depending on `side`.
     *
     * `side` defaults to `Below`.
     */
    notepad?: {page: number; orderKey?: OrderKey; side?: "Above" | "Below"};

    /**
     * Should we create the task above or below the order keys provided in `parent`
     * and `notepad`?
     *
     * `parent` and `notepad` inherit this value if they don't provide their own
     * `side` option is provided.
     */
    side?: "Above" | "Below";
};

const LocalTasksDatabaseInternalSchema = Schema.object({
    taskById: Schema.map(Schema.id<LocalTaskId>(), LocalTaskSchema),
    notepadPageCount: Schema.integer.min(1),
    taskIdByOrderKeyByNotepadPage: Schema.map(Schema.integer.min(1), LocalTaskIdByOrderKeySchema),
});

const LocalTasksDatabaseSchema = LocalTasksDatabaseInternalSchema.transform<LocalTasksDatabase>({
    serialize: database => database.serialize(),
    deserialize: database => LocalTasksDatabase.deserialize(database),
});

export type LocalTasksState = SchemaType<typeof LocalTasksStateSchema>;

const LocalTasksStateSchema = Schema.object({
    database: LocalTasksDatabaseSchema,
    ghostTaskId: Schema.id<LocalTaskId>(),
    layoutEffectRef: Schema.object({current: Schema.value(null)}).transform<
        MutableRefObject<(() => void) | null>
    >({
        // Don't serialize mutable ref value it should only be used in process.
        serialize: () => ({current: null}),
        deserialize: () => ({current: null}),
    }),
});

function getInitialLocalTasksState(): LocalTasksState {
    return {
        database: LocalTasksDatabase.empty,
        ghostTaskId: generateId(),
        layoutEffectRef: {current: null},
    };
}

export type LocalTasksAction =
    | LocalTasksRestoreStateAction
    | LocalTasksResetStateAction
    | LocalTasksCreateNotepadPageAction
    | LocalTasksCreateTaskAction;

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

type LocalTasksCreateTaskAction = LocalTasksDatabaseCreateTaskOptions & {
    readonly type: "CreateTask";
    readonly onLayoutEffect?: (taskId: LocalTaskId) => void;
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

        case "CreateTask": {
            const {type, onLayoutEffect, ...options} = action;

            const [database, task] = state.database.createAndReturnTask(options);

            return {
                ...state,
                database,
                ghostTaskId: task.id === state.ghostTaskId ? generateId() : state.ghostTaskId,
                layoutEffectRef: onLayoutEffect
                    ? {current: () => onLayoutEffect(task.id)}
                    : state.layoutEffectRef,
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

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.layoutEffectRef.current) return;
        const layoutEffect = state.layoutEffectRef.current;
        state.layoutEffectRef.current = null;
        layoutEffect();
    }, [state.layoutEffectRef]);

    useDevConsoleTool("localTasksState", () => ({
        reset: () => dispatch({type: "ResetState"}),
    }));

    return [state, dispatch as Memo<(action: LocalTasksAction) => void>];
}
