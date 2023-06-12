import {toCalendarDate} from "@internationalized/date";
import {CalendarDate, parseAbsolute, parseDate} from "@internationalized/date";
import {compareAsc} from "date-fns";
import {MutableRefObject, useEffect, useMemo, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {Store} from "~/client/helpers/store/store";
import {useStore} from "~/client/helpers/store/use_store";
import {ValueStore} from "~/client/helpers/store/value_store";
import {evaluateTaskQueryFilters} from "~/client/tasks/demo_2/internal/evaluate_task_query_filters";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {
    TaskAssignee,
    TaskAssigneeActiveStatus,
    TaskStatus,
    compareTaskAssigneeActiveStatus,
} from "~/client/tasks/demo_2/task_status_button";
import {AccountModel} from "~/shared/accounts/account_model";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {noop} from "~/shared/helpers/control/noop";
import {TimeZone} from "~/shared/helpers/date/time_zone";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key";
import {generateId} from "~/shared/id/id";
import {AccountId, LocalTaskCollectionId, LocalTaskId} from "~/shared/id/types/id_types";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema, SchemaDeserializationError, SchemaType} from "~/shared/schema/schema";
import {TimeZoneSchema} from "~/shared/schema/time_zone_schema";
import {
    TaskNotesContentWithReferences,
    TaskNotesContentWithReferencesSchema,
    emptyTaskNotesContentWithReferences,
} from "~/shared/tasks/task_notes_content_schema";
import {TaskTitle, TaskTitleSchema, emptyTaskTitle} from "~/shared/tasks/task_title_schema";

const LocalTaskIdByOrderKeySchema = Schema.map(OrderKeySchema, Schema.id<LocalTaskId>()).transform<
    ImmutableMap<OrderKey, LocalTaskId>
>({
    serialize: taskIdByOrderKey => new Map(taskIdByOrderKey),
    deserialize: taskIdByOrderKey => ImmutableMap.from(taskIdByOrderKey),
});

const CalendarDateSchema = Schema.string.transform<CalendarDate>({
    serialize: date => date.toString(),
    deserialize: date => parseDate(date),
});

export type LocalTask = SchemaType<typeof LocalTaskSchema>;

const LocalTaskSchema = Schema.object({
    id: Schema.id<LocalTaskId>(),
    creatorId: Schema.id<AccountId>(),
    createdTime: Schema.date,
    creatorTimeZone: TimeZoneSchema,
    // The date this task was created in its local time zone. We display this as
    // the created date to users and use it for filtering/sorting so users in
    // different time zones don't get different results.
    //
    // TODO(calebmer): Think about this more and document this better.
    createdDate: CalendarDateSchema,
    status: Schema.union({
        Open: Schema.object({
            type: Schema.value("Open"),
        }),
        Closed: Schema.object({
            type: Schema.value("Closed"),
            closerId: Schema.id<AccountId>(),
            closedTime: Schema.date,
            closerTimeZone: TimeZoneSchema,
            // The date this task was closed in its local time zone. We display this as
            // the closed date to users and use it for filtering/sorting so users in
            // different time zones don't get different results.
            //
            // TODO(calebmer): Think about this more and document this better.
            closedDate: CalendarDateSchema,
        }),
    }),
    title: TaskTitleSchema,
    assignee: Schema.object({
        account: AccountModel.schema(),
        assignerId: Schema.id<AccountId>(),
        assignedTime: Schema.date,
        assignerTimeZone: TimeZoneSchema,
        // The date this task was assigned in its local time zone. We display this
        // as the assigned date to users and use it for filtering/sorting so users
        // in different time zones don't get different results.
        //
        // TODO(calebmer): Think about this more and document this better.
        assignedDate: CalendarDateSchema,
        status: Schema.union({
            Inactive: Schema.object({
                type: Schema.value("Inactive"),
            }),
            Active: Schema.object({
                type: Schema.value("Active"),
                orderTime: Schema.date,
                orderKey: OrderKeySchema,
                activatorId: Schema.id<AccountId>(),
                activatedTime: Schema.date,
                activatorTimeZone: TimeZoneSchema,
                // The date this task was assigned in its local time zone. We display this
                // as the assigned date to users and use it for filtering/sorting so users
                // in different time zones don't get different results.
                //
                // TODO(calebmer): Think about this more and document this better.
                activatedDate: CalendarDateSchema,
            }),
        }),
    })
        .nullable()
        .default(null),
    dueDate: CalendarDateSchema.nullable().default(null),
    collectionIds: Schema.set(Schema.id<LocalTaskCollectionId>())
        .default(new Set())
        .originalPropertyKey("taskCollectionIds"),
    notesContent: TaskNotesContentWithReferencesSchema,
    parentTaskId: Schema.id<LocalTaskId>().nullable(),
    childTaskIdByOrderKey: LocalTaskIdByOrderKeySchema,
});

export type LocalTaskCollection = SchemaType<typeof LocalTaskCollectionSchema>;

const LocalTaskCollectionSchema = Schema.object({
    id: Schema.id<LocalTaskCollectionId>(),
    name: LabelStringSchema,
    color: Schema.enum(themeColors),
    createdTime: Schema.date.default(new Date("2023-06-05T20:28:14.198Z")),
    lastTaskAddedOrRemovedTimeRoundedToDay: Schema.date
        .transform<Date>({
            serialize: date => {
                assert(date.toISOString() === roundDateToDay(date).toISOString());
                return date;
            },
            deserialize: date => {
                if (date.toISOString() !== roundDateToDay(date).toISOString()) {
                    throw new SchemaDeserializationError("Expected date to be rounded to day");
                }
                return date;
            },
        })
        .nullable()
        .default(null),
    // TODO(calebmer): In a production implementation this should be the open
    // task count.
    taskCount: Schema.integer.default(0),
});

/**
 * Round the provided date to the start of the current day.
 */
export function roundDateToDay(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), 0, 0, 0, 0);
}

class LocalTasksDatabase {
    private readonly _taskById: ImmutableMap<LocalTaskId, LocalTask>;
    private readonly _taskCollectionById: ImmutableMap<LocalTaskCollectionId, LocalTaskCollection>;

    private readonly _notepadPageCount: number;

    private readonly _taskIdByOrderKeyByNotepadPage: ImmutableMap<
        number,
        ImmutableMap<OrderKey, LocalTaskId>
    >;

    private constructor({
        taskById,
        taskCollectionById,
        notepadPageCount,
        taskIdByOrderKeyByNotepadPage,
    }: {
        taskById: ImmutableMap<LocalTaskId, LocalTask>;
        taskCollectionById: ImmutableMap<LocalTaskCollectionId, LocalTaskCollection>;
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

            for (const [taskCollectionId, taskCollection] of taskCollectionById) {
                assert(
                    taskCollectionId === taskCollection.id,
                    "Key in `taskCollectionById` does not match value",
                );
            }
        }

        this._taskById = taskById;
        this._taskCollectionById = taskCollectionById;
        this._notepadPageCount = notepadPageCount;
        this._taskIdByOrderKeyByNotepadPage = taskIdByOrderKeyByNotepadPage;
    }

    public static readonly empty = new LocalTasksDatabase({
        taskById: ImmutableMap.empty(),
        taskCollectionById: ImmutableMap.empty(),
        notepadPageCount: 1,
        taskIdByOrderKeyByNotepadPage: ImmutableMap.empty(),
    });

    public serialize(): SchemaType<typeof LocalTasksDatabaseInternalSchema> {
        return {
            taskById: new Map(this._taskById),
            taskCollectionById: new Map(this._taskCollectionById),
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: new Map(this._taskIdByOrderKeyByNotepadPage),
        };
    }

    public static deserialize(data: SchemaType<typeof LocalTasksDatabaseInternalSchema>) {
        return new LocalTasksDatabase({
            taskById: ImmutableMap.from(data.taskById),
            taskCollectionById: ImmutableMap.from(data.taskCollectionById),
            notepadPageCount: data.notepadPageCount,
            taskIdByOrderKeyByNotepadPage: ImmutableMap.from(data.taskIdByOrderKeyByNotepadPage),
        });
    }

    public getTask(taskId: LocalTaskId) {
        const task = this._taskById.get(taskId);
        if (!task) throw new NotFoundError("Task not found");
        return task;
    }

    public getTaskCollection(taskCollectionId: LocalTaskCollectionId) {
        const taskCollection = this._taskCollectionById.get(taskCollectionId);
        if (!taskCollection) throw new NotFoundError("Task collection not found");
        return taskCollection;
    }

    public getNotepadPageCount() {
        return this._notepadPageCount;
    }

    public createNotepadPage() {
        return new LocalTasksDatabase({
            taskById: this._taskById,
            taskCollectionById: this._taskCollectionById,
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

    public createTask(options: LocalTasksDatabaseCreateTaskOptions) {
        return this.createAndReturnTask(options)[0];
    }

    public createAndReturnTask(options: LocalTasksDatabaseCreateTaskOptions) {
        const createdTime = new Date();
        const createdDate = toCalendarDate(
            parseAbsolute(createdTime.toISOString(), options.creatorTimeZone),
        );

        const task: LocalTask = {
            id: options.taskId ?? generateId(),
            createdTime: new Date(),
            creatorTimeZone: options.creatorTimeZone,
            createdDate,
            creatorId: options.creatorId,
            status: {type: "Open"},
            title: options.title ?? emptyTaskTitle,
            assignee: null,
            dueDate: null,
            collectionIds: new Set(),
            notesContent: emptyTaskNotesContentWithReferences,
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
                taskCollectionById: this._taskCollectionById,
                notepadPageCount: this._notepadPageCount,
                taskIdByOrderKeyByNotepadPage,
            }),
            task,
        ] as const;
    }

    public updateTaskTitle(taskId: LocalTaskId, title: TaskTitle) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {...task, title};
            }),
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public updateTaskAssignee(taskId: LocalTaskId, assignee: TaskAssignee | null) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {
                    ...task,
                    status: assignee?.status.type === "Active" ? {type: "Open"} : task.status,
                    assignee,
                };
            }),
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public updateTaskStatus(taskId: LocalTaskId, status: TaskStatus) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {
                    ...task,
                    status,
                    assignee: task.assignee ? {...task.assignee, status: {type: "Inactive"}} : null,
                };
            }),
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public updateTaskDueDate(taskId: LocalTaskId, dueDate: CalendarDate | null) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {...task, dueDate};
            }),
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public updateTaskNotesContent(
        taskId: LocalTaskId,
        notesContent: TaskNotesContentWithReferences,
    ) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {...task, notesContent};
            }),
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public nestTask(parentTaskId: LocalTaskId, childTaskId: LocalTaskId) {
        if (parentTaskId === childTaskId)
            throw new InvalidArgumentError("Can't nest task under itself");

        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPage = this._taskIdByOrderKeyByNotepadPage;

        let childTask = taskById.get(childTaskId);
        if (!childTask) throw new NotFoundError("Child task not found");

        taskById = deleteTaskInParentTask(taskById, childTask);

        taskIdByOrderKeyByNotepadPage = deleteTaskInTaskIdByOrderKeyByNotepadPage(
            taskIdByOrderKeyByNotepadPage,
            childTaskId,
        );

        let parentTask = taskById.get(parentTaskId);
        if (!parentTask) throw new NotFoundError("Parent task not found");

        childTask = {
            ...childTask,
            parentTaskId: parentTask.id,
        };

        parentTask = {
            ...parentTask,
            childTaskIdByOrderKey: parentTask.childTaskIdByOrderKey.set(
                generateOrderKeyBetween(
                    parentTask.childTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
                    null,
                ),
                childTaskId,
            ),
        };

        taskById = taskById.set(childTask.id, childTask);
        taskById = taskById.set(parentTask.id, parentTask);

        return new LocalTasksDatabase({
            taskById,
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage,
        });
    }

    public moveTaskToNotepad(
        notepadPage: number,
        belowOrderKey: OrderKey | null,
        taskId: LocalTaskId,
    ) {
        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPage = this._taskIdByOrderKeyByNotepadPage;

        let task = taskById.get(taskId);
        if (!task) throw new NotFoundError("Child task not found");

        taskById = deleteTaskInParentTask(taskById, task);

        taskIdByOrderKeyByNotepadPage = deleteTaskInTaskIdByOrderKeyByNotepadPage(
            taskIdByOrderKeyByNotepadPage,
            taskId,
        );

        task = {
            ...task,
            parentTaskId: null,
        };

        taskById = taskById.set(task.id, task);

        this._validateNotepadPage(notepadPage);

        let taskIdByOrderKey =
            taskIdByOrderKeyByNotepadPage.get(notepadPage) ?? ImmutableMap.empty();

        taskIdByOrderKey = taskIdByOrderKey.set(
            belowOrderKey
                ? generateOrderKeyBetween(
                      belowOrderKey,
                      taskIdByOrderKey.getEntryAfter(belowOrderKey)?.[0] ?? null,
                  )
                : generateOrderKeyBetween(null, taskIdByOrderKey.getFirstEntry()?.[0] ?? null),
            task.id,
        );

        taskIdByOrderKeyByNotepadPage = taskIdByOrderKeyByNotepadPage.set(
            notepadPage,
            taskIdByOrderKey,
        );

        return new LocalTasksDatabase({
            taskById,
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage,
        });
    }

    public moveTaskToParentTask(
        parentTaskId: LocalTaskId,
        belowOrderKey: OrderKey | null,
        taskId: LocalTaskId,
    ) {
        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPage = this._taskIdByOrderKeyByNotepadPage;

        let task = taskById.get(taskId);
        if (!task) throw new NotFoundError("Child task not found");

        taskById = deleteTaskInParentTask(taskById, task);

        taskIdByOrderKeyByNotepadPage = deleteTaskInTaskIdByOrderKeyByNotepadPage(
            taskIdByOrderKeyByNotepadPage,
            taskId,
        );

        task = {
            ...task,
            parentTaskId,
        };

        taskById = taskById.set(task.id, task);

        let parentTask = taskById.get(parentTaskId);
        if (!parentTask) throw new NotFoundError("Parent task not found");

        parentTask = {
            ...parentTask,
            childTaskIdByOrderKey: parentTask.childTaskIdByOrderKey.set(
                belowOrderKey
                    ? generateOrderKeyBetween(
                          belowOrderKey,
                          parentTask.childTaskIdByOrderKey.getEntryAfter(belowOrderKey)?.[0] ??
                              null,
                      )
                    : generateOrderKeyBetween(
                          null,
                          parentTask.childTaskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                      ),
                task.id,
            ),
        };

        taskById = taskById.set(parentTask.id, parentTask);

        return new LocalTasksDatabase({
            taskById,
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage,
        });
    }

    public deleteTaskAndAllChildren(taskId: LocalTaskId) {
        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPage = this._taskIdByOrderKeyByNotepadPage;

        const deleteTask = (taskId: LocalTaskId, shouldDeleteFromParent: boolean) => {
            const [task, _taskById] = taskById.getAndDelete(taskId);
            taskById = _taskById;

            if (!task) throw new NotFoundError("Task not found");

            if (shouldDeleteFromParent) {
                taskById = deleteTaskInParentTask(taskById, task);
            }

            taskIdByOrderKeyByNotepadPage = deleteTaskInTaskIdByOrderKeyByNotepadPage(
                taskIdByOrderKeyByNotepadPage,
                taskId,
            );

            for (const childTaskId of task.childTaskIdByOrderKey.values()) {
                deleteTask(childTaskId, false);
            }
        };

        deleteTask(taskId, true);

        return new LocalTasksDatabase({
            taskById,
            taskCollectionById: this._taskCollectionById,
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage,
        });
    }

    public getActiveTasksForAccount(accountId: AccountId) {
        const activeTasks: Array<{
            task: LocalTask;
            assigneeActiveStatus: TaskAssigneeActiveStatus;
        }> = [];

        for (const task of this._taskById.values()) {
            if (
                task.status.type === "Open" &&
                task.assignee?.account.id === accountId &&
                task.assignee.status.type === "Active"
            ) {
                activeTasks.push({task, assigneeActiveStatus: task.assignee.status});
            }
        }

        activeTasks.sort(({assigneeActiveStatus: status1}, {assigneeActiveStatus: status2}) =>
            compareTaskAssigneeActiveStatus(status1, status2),
        );

        return activeTasks;
    }

    public createTaskCollectionAndAddToTask(
        taskId: LocalTaskId,
        taskCollection: {
            id: LocalTaskCollectionId;
            name: string;
            color: ThemeColor;
        },
    ) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {
                    ...task,
                    collectionIds: new Set([...task.collectionIds, taskCollection.id]),
                };
            }),
            taskCollectionById: this._taskCollectionById.update(
                taskCollection.id,
                oldTaskCollection => {
                    if (oldTaskCollection)
                        throw new FailedPreconditionError("Task collection already exists");

                    const createdTime = new Date();

                    return {
                        ...taskCollection,
                        createdTime,
                        lastTaskAddedOrRemovedTimeRoundedToDay: roundDateToDay(createdTime),
                        taskCount: 1,
                    };
                },
            ),
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public addTaskCollectionToTask(taskId: LocalTaskId, taskCollectionId: LocalTaskCollectionId) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");

                const newCollectionIds = new Set(task.collectionIds);
                newCollectionIds.add(taskCollectionId);

                return {...task, collectionIds: newCollectionIds};
            }),
            taskCollectionById: this._taskCollectionById.update(
                taskCollectionId,
                taskCollection => {
                    if (!taskCollection) throw new NotFoundError("Task collection not found");

                    return {
                        ...taskCollection,
                        lastTaskAddedOrRemovedTimeRoundedToDay: roundDateToDay(new Date()),
                        taskCount: taskCollection.taskCount + 1,
                    };
                },
            ),
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public removeTaskCollectionFromTask(
        taskId: LocalTaskId,
        taskCollectionId: LocalTaskCollectionId,
    ) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");

                const newCollectionIds = new Set(task.collectionIds);
                newCollectionIds.delete(taskCollectionId);

                return {...task, collectionIds: newCollectionIds};
            }),
            taskCollectionById: this._taskCollectionById.update(
                taskCollectionId,
                taskCollection => {
                    if (!taskCollection) throw new NotFoundError("Task collection not found");

                    return {
                        ...taskCollection,
                        lastTaskAddedOrRemovedTimeRoundedToDay: roundDateToDay(new Date()),
                        taskCount: taskCollection.taskCount - 1,
                    };
                },
            ),
            notepadPageCount: this._notepadPageCount,
            taskIdByOrderKeyByNotepadPage: this._taskIdByOrderKeyByNotepadPage,
        });
    }

    public getAllTaskCollections() {
        return Array.from(this._taskCollectionById.values()).sort((collection1, collection2) =>
            collection1.name.localeCompare(collection2.name),
        );
    }

    public query(
        filters: ReadonlyArray<TaskQueryFilter>,
        context: {currentAccountId: AccountId; currentDate: CalendarDate},
    ) {
        const tasks = [];

        for (const task of this._taskById.values()) {
            if (evaluateTaskQueryFilters(filters, task, context)) {
                tasks.push(task);
            }
        }

        tasks.sort((task1, task2) => {
            return -(
                task1.createdDate.compare(task2.createdDate) ||
                compareAsc(task1.createdTime, task2.createdTime)
            );
        });

        return tasks;
    }
}

function deleteTaskInParentTask(taskById: ImmutableMap<LocalTaskId, LocalTask>, task: LocalTask) {
    if (task.parentTaskId) {
        let parentTask = taskById.get(task.parentTaskId);
        if (!parentTask) throw new NotFoundError("Parent task not found");

        parentTask = {
            ...parentTask,
            // TODO(calebmer): In a production implementation we should have a reverse
            // index since a scan could be expensive.
            childTaskIdByOrderKey: reduceIterable(
                parentTask.childTaskIdByOrderKey.entries(),
                (childTaskIdByOrderKey, [orderKey, otherTaskId]) =>
                    otherTaskId === task.id
                        ? childTaskIdByOrderKey.delete(orderKey)
                        : childTaskIdByOrderKey,
                parentTask.childTaskIdByOrderKey,
            ),
        };

        taskById = taskById.set(parentTask.id, parentTask);
    }

    return taskById;
}

function deleteTaskInTaskIdByOrderKeyByNotepadPage(
    taskIdByOrderKeyByNotepadPage: ImmutableMap<number, ImmutableMap<OrderKey, LocalTaskId>>,
    taskId: LocalTaskId,
) {
    // TODO(calebmer): In a production implementation we should have a reverse
    // index since a scan could be expensive.
    for (const [notepadPage, oldTaskIdByOrderKey] of taskIdByOrderKeyByNotepadPage) {
        let newTaskIdByOrderKey = oldTaskIdByOrderKey;

        for (const [orderKey, otherTaskId] of oldTaskIdByOrderKey) {
            if (otherTaskId === taskId) newTaskIdByOrderKey = newTaskIdByOrderKey.delete(orderKey);
        }

        if (oldTaskIdByOrderKey !== newTaskIdByOrderKey) {
            taskIdByOrderKeyByNotepadPage = taskIdByOrderKeyByNotepadPage.set(
                notepadPage,
                newTaskIdByOrderKey,
            );
        }
    }

    return taskIdByOrderKeyByNotepadPage;
}

type LocalTasksDatabaseCreateTaskOptions = {
    /**
     * The account who created this task.
     */
    creatorId: AccountId;

    /**
     * The time zone the task was created in.
     */
    creatorTimeZone: TimeZone;

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
    taskCollectionById: Schema.map(
        Schema.id<LocalTaskCollectionId>(),
        LocalTaskCollectionSchema,
    ).default(new Map()),
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
        layoutEffectRef: {current: null},
    };
}

export type LocalTasksAction =
    | LocalTasksRestoreStateAction
    | LocalTasksResetStateAction
    | LocalTasksCreateNotepadPageAction
    | LocalTasksCreateTaskAction
    | LocalTasksUpdateTaskTitleAction
    | LocalTasksUpdateTaskAssigneeAction
    | LocalTasksUpdateTaskStatusAction
    | LocalTasksUpdateTaskDueDateAction
    | LocalTasksUpdateTaskNotesContentAction
    | LocalTasksDeleteTaskAndAllChildrenAction
    | LocalTasksNestTaskAction
    | LocalTasksMoveTaskToParentTaskAction
    | LocalTasksMoveTaskToNotepadAction
    | LocalTasksCreateTaskCollectionAndAddToTaskAction
    | LocalTasksAddTaskCollectionToTaskAction
    | LocalTasksRemoveTaskCollectionFromTaskAction;

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

type LocalTasksUpdateTaskTitleAction = {
    readonly type: "UpdateTaskTitle";
    readonly taskId: LocalTaskId;
    readonly title: TaskTitle;
};

type LocalTasksUpdateTaskAssigneeAction = {
    readonly type: "UpdateTaskAssignee";
    readonly taskId: LocalTaskId;
    readonly assignee: TaskAssignee | null;
};

type LocalTasksUpdateTaskStatusAction = {
    readonly type: "UpdateTaskStatus";
    readonly taskId: LocalTaskId;
    readonly status: TaskStatus;
};

type LocalTasksUpdateTaskDueDateAction = {
    readonly type: "UpdateTaskDueDate";
    readonly taskId: LocalTaskId;
    readonly dueDate: CalendarDate | null;
};

type LocalTasksUpdateTaskNotesContentAction = {
    readonly type: "UpdateTaskNotesContent";
    readonly taskId: LocalTaskId;
    readonly notesContent: TaskNotesContentWithReferences;
};

type LocalTasksDeleteTaskAndAllChildrenAction = {
    readonly type: "DeleteTaskAndAllChildren";
    readonly taskId: LocalTaskId;
    readonly onLayoutEffect?: () => void;
};

type LocalTasksNestTaskAction = {
    readonly type: "NestTask";
    readonly parentTaskId: LocalTaskId;
    readonly childTaskId: LocalTaskId;
};

type LocalTasksMoveTaskToParentTaskAction = {
    readonly type: "MoveTaskToParentTask";
    readonly parentTaskId: LocalTaskId;
    readonly belowOrderKey: OrderKey | null;
    readonly taskId: LocalTaskId;
};

type LocalTasksMoveTaskToNotepadAction = {
    readonly type: "MoveTaskToNotepad";
    readonly notepadPage: number;
    readonly belowOrderKey: OrderKey | null;
    readonly taskId: LocalTaskId;
};

type LocalTasksCreateTaskCollectionAndAddToTaskAction = {
    readonly type: "CreateTaskCollectionAndAddToTask";
    readonly taskId: LocalTaskId;
    readonly taskCollection: {
        readonly id: LocalTaskCollectionId;
        readonly name: string;
        readonly color: ThemeColor;
    };
};

type LocalTasksAddTaskCollectionToTaskAction = {
    readonly type: "AddTaskCollectionToTask";
    readonly taskId: LocalTaskId;
    readonly taskCollectionId: LocalTaskCollectionId;
};

type LocalTasksRemoveTaskCollectionFromTaskAction = {
    readonly type: "RemoveTaskCollectionFromTask";
    readonly taskId: LocalTaskId;
    readonly taskCollectionId: LocalTaskCollectionId;
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
                layoutEffectRef: onLayoutEffect
                    ? {current: () => onLayoutEffect(task.id)}
                    : state.layoutEffectRef,
            };
        }

        case "UpdateTaskTitle": {
            return {
                ...state,
                database: state.database.updateTaskTitle(action.taskId, action.title),
            };
        }

        case "UpdateTaskAssignee": {
            return {
                ...state,
                database: state.database.updateTaskAssignee(action.taskId, action.assignee),
            };
        }

        case "UpdateTaskStatus": {
            return {
                ...state,
                database: state.database.updateTaskStatus(action.taskId, action.status),
            };
        }

        case "UpdateTaskDueDate": {
            return {
                ...state,
                database: state.database.updateTaskDueDate(action.taskId, action.dueDate),
            };
        }

        case "UpdateTaskNotesContent": {
            return {
                ...state,
                database: state.database.updateTaskNotesContent(action.taskId, action.notesContent),
            };
        }

        case "DeleteTaskAndAllChildren": {
            const {taskId, onLayoutEffect} = action;

            return {
                ...state,
                database: state.database.deleteTaskAndAllChildren(taskId),
                layoutEffectRef: onLayoutEffect
                    ? {current: () => onLayoutEffect()}
                    : state.layoutEffectRef,
            };
        }

        case "NestTask": {
            return {
                ...state,
                database: state.database.nestTask(action.parentTaskId, action.childTaskId),
            };
        }

        case "MoveTaskToParentTask": {
            return {
                ...state,
                database: state.database.moveTaskToParentTask(
                    action.parentTaskId,
                    action.belowOrderKey,
                    action.taskId,
                ),
            };
        }

        case "MoveTaskToNotepad": {
            return {
                ...state,
                database: state.database.moveTaskToNotepad(
                    action.notepadPage,
                    action.belowOrderKey,
                    action.taskId,
                ),
            };
        }

        case "CreateTaskCollectionAndAddToTask": {
            return {
                ...state,
                database: state.database.createTaskCollectionAndAddToTask(
                    action.taskId,
                    action.taskCollection,
                ),
            };
        }

        case "AddTaskCollectionToTask": {
            return {
                ...state,
                database: state.database.addTaskCollectionToTask(
                    action.taskId,
                    action.taskCollectionId,
                ),
            };
        }

        case "RemoveTaskCollectionFromTask": {
            return {
                ...state,
                database: state.database.removeTaskCollectionFromTask(
                    action.taskId,
                    action.taskCollectionId,
                ),
            };
        }

        default:
            throw exhaustive(action);
    }
}

const localTasksStateStore = new Lazy<{
    state: Store<LocalTasksState>;
    dispatch: (action: LocalTasksAction) => void;
}>(() => {
    let initialState = getInitialLocalTasksState();

    const serializedStateString = localStorage.getItem("tasksLocalState2");
    if (serializedStateString !== null) {
        initialState = reduceLocalTasksState(initialState, {
            type: "RestoreState",
            serializedStateString,
        });
    }

    const stateStore = new ValueStore(initialState);

    const dispatch = (action: LocalTasksAction) => {
        stateStore.set(state => reduceLocalTasksState(state, action));
    };

    stateStore.subscribe(() => {
        const serializedState = LocalTasksStateSchema.serialize(stateStore.getSnapshot());
        const serializedStateString = JSON.stringify(serializedState);
        localStorage.setItem("tasksLocalState2", serializedStateString);
    });

    return {
        state: stateStore,
        dispatch,
    };
});

export function useLocalTasksState(): [LocalTasksState, (action: LocalTasksAction) => void] {
    const isInitialAppRender = useIsInitialAppRender();

    const store = useMemo(() => {
        if (!isInitialAppRender) return localTasksStateStore.get();

        return {
            state: new ValueStore(getInitialLocalTasksState()),
            dispatch: noop,
        };
    }, [isInitialAppRender]);

    const state = useStore(store.state);

    const shouldRestoreStateRef = useRef(isInitialAppRender);
    useEffect(() => {
        if (shouldRestoreStateRef.current) return;
        shouldRestoreStateRef.current = true;

        const serializedStateString = localStorage.getItem("tasksLocalState2");
        if (serializedStateString !== null) {
            store.dispatch({type: "RestoreState", serializedStateString});
        }
    }, [store]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.layoutEffectRef.current) return;
        const layoutEffect = state.layoutEffectRef.current;
        state.layoutEffectRef.current = null;

        // HACK(calebmer): We want this to run after all components which use this hook
        // have rendered. So schedule in a microtask to make that happen. In a
        // production implementation we should really find a better way to manage
        // shared task state and local component state...
        scheduleMicrotask(() => {
            layoutEffect();
        });
    }, [state.layoutEffectRef]);

    useDevConsoleTool("localTasksState", () => ({
        reset: () => store.dispatch({type: "ResetState"}),
    }));

    return [state, store.dispatch];
}
