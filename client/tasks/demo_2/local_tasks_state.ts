import {CalendarDate, parseAbsolute, parseDate, toCalendarDate} from "@internationalized/date";
import {MutableRefObject, useEffect, useMemo, useRef} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {createTaskQuerySortsCompareFunction} from "~/client/tasks/demo_2/internal/create_task_query_sorts_compare_function.js";
import {evaluateTaskQueryNormalizedFilters} from "~/client/tasks/demo_2/internal/evaluate_task_query_normalized_filters.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/client/tasks/demo_2/internal/normalize_task_query_filters.js";
import {TaskQuerySort} from "~/client/tasks/demo_2/task_query_sort.js";
import {
    TaskAssignee,
    TaskAssigneeActiveStatus,
    TaskStatus,
    compareTaskAssigneeActiveStatus,
} from "~/client/tasks/demo_2/task_status_button.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors.js";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {
    OrderKey,
    generateOrderKeyBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, LocalTaskCollectionId, LocalTaskId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/label_string_schema.js";
import {OrderKeySchema} from "~/shared/schema/order_key_schema.js";
import {Schema, SchemaDeserializationError, SchemaType} from "~/shared/schema/schema.js";
import {TimeZoneSchema} from "~/shared/schema/time_zone_schema.js";
import {
    TaskNotesContentWithReferences,
    TaskNotesContentWithReferencesSchema,
    emptyTaskNotesContentWithReferences,
} from "~/shared/tasks/task_notes_content.js";
import {TaskPriority, TaskPrioritySchema} from "~/shared/tasks/task_priority.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskTitle, TaskTitleSchema, emptyTaskTitle} from "~/shared/tasks/task_title_schema_old.js";

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
    priority: TaskPrioritySchema.nullable().default(null),
    collectionIds: Schema.set(Schema.id<LocalTaskCollectionId>()).default(new Set()),
    notesContent: TaskNotesContentWithReferencesSchema,
    parentTaskId: Schema.id<LocalTaskId>().nullable(),
    childTaskIdByOrderKey: LocalTaskIdByOrderKeySchema,
});

export type LocalTaskCollection = SchemaType<typeof LocalTaskCollectionSchema>;

const LocalTaskCollectionSchema = Schema.object({
    id: Schema.id<LocalTaskCollectionId>(),
    name: LabelStringSchema,
    // TODO(calebmer): In our production implementation consider excluding
    // yellow for now and defaulting to grey.
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
    taskIdByOrderKey: LocalTaskIdByOrderKeySchema.default(ImmutableMap.empty()),
});

/**
 * Round the provided date to the start of the current day.
 */
export function roundDateToDay(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), 0, 0, 0, 0);
}

export type LocalTasksMoveTaskFrom =
    | {
          readonly type: "ParentTask";
      }
    | {
          readonly type: "Notepad";
          readonly notepadPageId: number;
      }
    | {
          readonly type: "Collection";
          readonly collectionId: LocalTaskCollectionId;
      };

export type LocalTasksMoveTaskTo =
    | {
          readonly type: "ParentTask";
          readonly parentTaskId: LocalTaskId;
          readonly belowOrderKey: OrderKey | null;
      }
    | {
          readonly type: "Notepad";
          readonly notepadPageId: number;
          readonly belowOrderKey: OrderKey | null;
      }
    | {
          readonly type: "Collection";
          readonly collectionId: LocalTaskCollectionId;
          readonly belowOrderKey: OrderKey | null;
      };

class LocalTasksDatabase {
    private readonly _taskById: ImmutableMap<LocalTaskId, LocalTask>;
    private readonly _taskCollectionById: ImmutableMap<LocalTaskCollectionId, LocalTaskCollection>;

    private readonly _taskIdByOrderKeyByNotepadPageId: ImmutableMap<
        number,
        ImmutableMap<OrderKey, LocalTaskId>
    >;

    private constructor({
        taskById,
        taskCollectionById,
        taskIdByOrderKeyByNotepadPageId,
    }: {
        taskById: ImmutableMap<LocalTaskId, LocalTask>;
        taskCollectionById: ImmutableMap<LocalTaskCollectionId, LocalTaskCollection>;
        taskIdByOrderKeyByNotepadPageId: ImmutableMap<number, ImmutableMap<OrderKey, LocalTaskId>>;
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

                for (const collectionId of task.collectionIds) {
                    const collection = taskCollectionById.get(collectionId);
                    assert(collection, "Task collection must exist");

                    assert(
                        iterableSome(
                            collection.taskIdByOrderKey.values(),
                            collectionTaskId => collectionTaskId === task.id,
                        ),
                        "Task must exist in collection",
                    );
                }

                validTaskIds.add(task.id);
            };

            for (const [taskId, task] of taskById) {
                assert(taskId === task.id, "Key in `taskById` does not match value");
                validateTask([], task);
            }

            for (const [notepadPageId, taskIdByOrderKey] of taskIdByOrderKeyByNotepadPageId) {
                assert(
                    notepadPageId >= 0 && Number.isSafeInteger(notepadPageId),
                    "Notepad page ID must be a positive integer",
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

                const collectionTaskIds = new Set<LocalTaskId>();

                for (const taskId of taskCollection.taskIdByOrderKey.values()) {
                    const task = taskById.get(taskId);
                    assert(task, "Collection task must exist");

                    assert(
                        task.collectionIds.has(taskCollectionId),
                        "Collection task does not include collection ID in `collectionIds`",
                    );

                    assert(!collectionTaskIds.has(taskId), "Collection task IDs must be unique");
                    collectionTaskIds.add(taskId);
                }
            }
        }

        this._taskById = taskById;
        this._taskCollectionById = taskCollectionById;
        this._taskIdByOrderKeyByNotepadPageId = taskIdByOrderKeyByNotepadPageId;
    }

    public static readonly empty = new LocalTasksDatabase({
        taskById: ImmutableMap.empty(),
        taskCollectionById: ImmutableMap.empty(),
        taskIdByOrderKeyByNotepadPageId: ImmutableMap.empty(),
    });

    public serialize(): SchemaType<typeof LocalTasksDatabaseInternalSchema> {
        return {
            taskById: new Map(this._taskById),
            taskCollectionById: new Map(this._taskCollectionById),
            taskIdByOrderKeyByNotepadPageId: new Map(this._taskIdByOrderKeyByNotepadPageId),
        };
    }

    public static deserialize(data: SchemaType<typeof LocalTasksDatabaseInternalSchema>) {
        return new LocalTasksDatabase({
            taskById: ImmutableMap.from(data.taskById),
            taskCollectionById: ImmutableMap.from(data.taskCollectionById),
            taskIdByOrderKeyByNotepadPageId: ImmutableMap.from(
                data.taskIdByOrderKeyByNotepadPageId,
            ),
        });
    }

    public getTask(taskId: LocalTaskId) {
        const task = this._taskById.get(taskId);
        if (!task) throw new NotFoundError("Task not found");
        return task;
    }

    public getTaskIfExists(taskId: LocalTaskId) {
        return this._taskById.get(taskId) ?? null;
    }

    public getTaskCollectionIfExists(taskCollectionId: LocalTaskCollectionId) {
        return this._taskCollectionById.get(taskCollectionId) ?? null;
    }

    public getTaskCollection(taskCollectionId: LocalTaskCollectionId) {
        const taskCollection = this._taskCollectionById.get(taskCollectionId);
        if (!taskCollection) throw new NotFoundError("Task collection not found");
        return taskCollection;
    }

    public getLatestNotepadPageId() {
        return this._taskIdByOrderKeyByNotepadPageId.getLastEntry()?.[0] ?? null;
    }

    public getNotepadPageIds() {
        return this._taskIdByOrderKeyByNotepadPageId.keysReverse();
    }

    public createNotepadPage(notepadPageId: number) {
        const latestNotepadPageId = this.getLatestNotepadPageId();

        assert(
            latestNotepadPageId === null || notepadPageId > latestNotepadPageId,
            "`notepadPageId` must be greater than the latest notepad page ID",
        );

        return new LocalTasksDatabase({
            taskById: this._taskById,
            taskCollectionById: this._taskCollectionById,
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId.set(
                notepadPageId,
                ImmutableMap.empty(),
            ),
        });
    }

    public getNotepadPageTasks(notepadPageId: number): Iterable<[OrderKey, LocalTask]> {
        const taskIdByOrderKey = this._taskIdByOrderKeyByNotepadPageId.get(notepadPageId);
        if (!taskIdByOrderKey) throw new NotFoundError("Notepad page does not exist");

        return mapIterable(taskIdByOrderKey, ([orderKey, taskId]) => [
            orderKey,
            assertExists(this._taskById.get(taskId)),
        ]);
    }

    public createTask(options: LocalTasksDatabaseCreateTaskOptions) {
        return this.createAndReturnTask(options)[0];
    }

    public createAndReturnTask(options: LocalTasksDatabaseCreateTaskOptions) {
        const createdTime = new Date();
        const createdDate = toCalendarDate(
            parseAbsolute(createdTime.toISOString(), options.creatorTimeZone),
        );

        let task: LocalTask = {
            id: options.taskId ?? generateId(),
            createdTime: new Date(),
            creatorTimeZone: options.creatorTimeZone,
            createdDate,
            creatorId: options.creatorId,
            status: {type: "Open"},
            title: options.title ?? emptyTaskTitle,
            assignee: options.assignee ?? null,
            dueDate: options.dueDate ?? null,
            priority: options.priority ?? null,
            collectionIds: options.collection ? new Set([options.collection.id]) : new Set(),
            notesContent: emptyTaskNotesContentWithReferences,
            parentTaskId: options.parentTask?.id ?? null,
            childTaskIdByOrderKey: ImmutableMap.empty(),
        };

        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPageId = this._taskIdByOrderKeyByNotepadPageId;
        let taskCollectionById = this._taskCollectionById;

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
            let taskIdByOrderKey = taskIdByOrderKeyByNotepadPageId.get(options.notepad.pageId);
            if (!taskIdByOrderKey) throw new NotFoundError("Notepad page not found");

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

            taskIdByOrderKeyByNotepadPageId = taskIdByOrderKeyByNotepadPageId.set(
                options.notepad.pageId,
                taskIdByOrderKey,
            );
        }

        if (options.collection) {
            let taskCollection = taskCollectionById.get(options.collection.id);
            if (!taskCollection) throw new NotFoundError("Task collection not found");

            let orderKey: OrderKey;
            if ((options.collection.side ?? options.side ?? "Below") === "Above") {
                if (options.collection.orderKey) {
                    orderKey = generateOrderKeyBetween(
                        taskCollection.taskIdByOrderKey.getEntryBefore(
                            options.collection.orderKey,
                        )?.[0] ?? null,
                        options.collection.orderKey,
                    );
                } else {
                    orderKey = generateOrderKeyBetween(
                        null,
                        taskCollection.taskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                    );
                }
            } else {
                if (options.collection.orderKey) {
                    orderKey = generateOrderKeyBetween(
                        options.collection.orderKey,
                        taskCollection.taskIdByOrderKey.getEntryAfter(
                            options.collection.orderKey,
                        )?.[0] ?? null,
                    );
                } else {
                    orderKey = generateOrderKeyBetween(
                        taskCollection.taskIdByOrderKey.getLastEntry()?.[0] ?? null,
                        null,
                    );
                }
            }

            taskCollection = {
                ...taskCollection,
                taskIdByOrderKey: taskCollection.taskIdByOrderKey.set(orderKey, task.id),
            };

            taskCollectionById = taskCollectionById.set(taskCollection.id, taskCollection);
        }

        // Fill in task fields to match what's in our normalized filters.
        if (options.normalizedFilters) {
            // TypeScript errors here when new normalized filters are added. If you add a
            // new normalized filter you should make sure to update this code.
            assertEqualTypes<
                keyof TaskQueryNormalizedFilters,
                | "statusFilter"
                | "collectionsFilter"
                | "priorityFilter"
                | "assigneeFilter"
                | "creatorFilter"
                | "assignerFilter"
                | "dueDateFilter"
                | "createdDateFilter"
                | "assignedDateFilter"
                | "closedDateFilter"
                | "activatedDateFilter"
            >();

            const filters = options.normalizedFilters;

            // NOTE(calebmer): We intentionally don't auto-fill the active status when
            // creating a new task. New tasks don't have an assignee so we'd have to
            // auto-assign to the current account. This could create a lot of active task
            // cards making their active task section less useful.
            if (!filters.statusFilter.ifOpenInactive && filters.statusFilter.ifClosed) {
                task = {
                    ...task,
                    status: {
                        type: "Closed",
                        closedTime: task.createdTime,
                        closerTimeZone: task.creatorTimeZone,
                        closedDate: task.createdDate,
                        closerId: task.creatorId,
                    },
                };

                taskById = taskById.set(task.id, task);
            }

            if (filters.collectionsFilter) {
                const newCollectionIds = [];

                if (filters.collectionsFilter.type === "IncludesAllOf") {
                    for (const collectionId of filters.collectionsFilter.collectionIds) {
                        newCollectionIds.push(collectionId);
                    }
                }

                if (filters.collectionsFilter.type === "IncludesOneOf") {
                    const firstStep =
                        filters.collectionsFilter.collectionIds[Symbol.iterator]().next();
                    if (!firstStep.done) {
                        newCollectionIds.push(firstStep.value);
                    }
                }

                const oldCollectionIds = task.collectionIds;

                task = {
                    ...task,
                    collectionIds: new Set([...task.collectionIds, ...newCollectionIds]),
                };

                taskById = taskById.set(task.id, task);

                for (const collectionId of newCollectionIds) {
                    let taskCollection = taskCollectionById.get(collectionId);
                    if (!taskCollection) throw new NotFoundError("Task collection not found");

                    if (oldCollectionIds.has(collectionId)) continue;

                    taskCollection = {
                        ...taskCollection,
                        taskIdByOrderKey: taskCollection.taskIdByOrderKey.set(
                            generateOrderKeyBetween(
                                null,
                                taskCollection.taskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                            ),
                            task.id,
                        ),
                    };

                    taskCollectionById = taskCollectionById.set(taskCollection.id, taskCollection);
                }
            }

            // TODO(calebmer): Finish filter auto-fills in a production implementation...
        }

        return [
            new LocalTasksDatabase({
                taskById,
                taskCollectionById,
                taskIdByOrderKeyByNotepadPageId,
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
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
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
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
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
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
    }

    public updateTaskPriority(taskId: LocalTaskId, priority: TaskPriority | null) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {...task, priority};
            }),
            taskCollectionById: this._taskCollectionById,
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
    }

    public updateTaskDueDate(taskId: LocalTaskId, dueDate: CalendarDate | null) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");
                return {...task, dueDate};
            }),
            taskCollectionById: this._taskCollectionById,
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
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
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
    }

    public moveTask(from: LocalTasksMoveTaskFrom, to: LocalTasksMoveTaskTo, taskId: LocalTaskId) {
        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPageId = this._taskIdByOrderKeyByNotepadPageId;
        let taskCollectionById = this._taskCollectionById;

        const oldTask = taskById.get(taskId);
        if (!oldTask) throw new NotFoundError("Task not found");
        let task = oldTask;

        switch (from.type) {
            case "ParentTask": {
                if (!task.parentTaskId)
                    throw new FailedPreconditionError("Task does not have a parent task");

                // Noop. Task is moving within the same parent task.
                if (to.type === "ParentTask" && task.parentTaskId === to.parentTaskId) break;

                taskById = deleteTaskInParentTask(taskById, task);

                task = {
                    ...task,
                    parentTaskId: null,
                };
                break;
            }
            case "Notepad": {
                // Noop. Task is moving within the same notepad page.
                if (to.type === "Notepad" && from.notepadPageId === to.notepadPageId) break;

                taskIdByOrderKeyByNotepadPageId = deleteTaskInTaskIdByOrderKeyByNotepadPageId(
                    taskIdByOrderKeyByNotepadPageId,
                    taskId,
                    from.notepadPageId,
                );
                break;
            }
            case "Collection": {
                let taskCollection = taskCollectionById.get(from.collectionId);
                if (!taskCollection) throw new NotFoundError("Task collection not found");

                if (!task.collectionIds.has(from.collectionId))
                    throw new FailedPreconditionError("Task does not have collection");

                // Noop. Task is moving within the same collection.
                if (to.type === "Collection" && to.collectionId === from.collectionId) break;

                taskCollection = {
                    ...taskCollection,
                    // TODO(calebmer): In a production implementation we should have a reverse
                    // index since a scan could be expensive.
                    taskIdByOrderKey: reduceIterable(
                        taskCollection.taskIdByOrderKey.entries(),
                        (taskIdByOrderKey, [orderKey, otherTaskId]) =>
                            otherTaskId === task.id
                                ? taskIdByOrderKey.delete(orderKey)
                                : taskIdByOrderKey,
                        taskCollection.taskIdByOrderKey,
                    ),
                };

                taskCollectionById = taskCollectionById.set(taskCollection.id, taskCollection);

                const newCollectionIds = new Set(task.collectionIds);
                newCollectionIds.delete(from.collectionId);

                task = {
                    ...task,
                    collectionIds: newCollectionIds,
                };
                break;
            }
            default:
                throw exhaustive(from);
        }

        switch (to.type) {
            case "ParentTask": {
                let parentTask = taskById.get(to.parentTaskId);
                if (!parentTask) throw new NotFoundError("Parent task not found");

                parentTask = {
                    ...parentTask,
                    childTaskIdByOrderKey:
                        // TODO(calebmer): In a production implementation we should have a reverse
                        // index since a scan could be expensive.
                        reduceIterable(
                            parentTask.childTaskIdByOrderKey.entries(),
                            (childTaskIdByOrderKey, [orderKey, otherTaskId]) =>
                                otherTaskId === task.id
                                    ? childTaskIdByOrderKey.delete(orderKey)
                                    : childTaskIdByOrderKey,
                            parentTask.childTaskIdByOrderKey,
                        ).set(
                            to.belowOrderKey
                                ? generateOrderKeyBetween(
                                      to.belowOrderKey,
                                      parentTask.childTaskIdByOrderKey.getEntryAfter(
                                          to.belowOrderKey,
                                      )?.[0] ?? null,
                                  )
                                : generateOrderKeyBetween(
                                      null,
                                      parentTask.childTaskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                                  ),
                            task.id,
                        ),
                };

                taskById = taskById.set(parentTask.id, parentTask);

                if (task.parentTaskId !== to.parentTaskId) {
                    task = {
                        ...task,
                        parentTaskId: to.parentTaskId,
                    };
                }
                break;
            }
            case "Notepad": {
                taskIdByOrderKeyByNotepadPageId = deleteTaskInTaskIdByOrderKeyByNotepadPageId(
                    taskIdByOrderKeyByNotepadPageId,
                    taskId,
                    to.notepadPageId,
                );

                let taskIdByOrderKey = taskIdByOrderKeyByNotepadPageId.get(to.notepadPageId);
                if (!taskIdByOrderKey) throw new NotFoundError("Notepad page not found");

                taskIdByOrderKey = taskIdByOrderKey.set(
                    to.belowOrderKey
                        ? generateOrderKeyBetween(
                              to.belowOrderKey,
                              taskIdByOrderKey.getEntryAfter(to.belowOrderKey)?.[0] ?? null,
                          )
                        : generateOrderKeyBetween(
                              null,
                              taskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                          ),
                    task.id,
                );

                taskIdByOrderKeyByNotepadPageId = taskIdByOrderKeyByNotepadPageId.set(
                    to.notepadPageId,
                    taskIdByOrderKey,
                );
                break;
            }
            case "Collection": {
                let taskCollection = taskCollectionById.get(to.collectionId);
                if (!taskCollection) throw new NotFoundError("Task collection not found");

                taskCollection = {
                    ...taskCollection,
                    taskIdByOrderKey:
                        // TODO(calebmer): In a production implementation we should have a reverse
                        // index since a scan could be expensive.
                        reduceIterable(
                            taskCollection.taskIdByOrderKey.entries(),
                            (taskIdByOrderKey, [orderKey, otherTaskId]) =>
                                otherTaskId === task.id
                                    ? taskIdByOrderKey.delete(orderKey)
                                    : taskIdByOrderKey,
                            taskCollection.taskIdByOrderKey,
                        ).set(
                            to.belowOrderKey
                                ? generateOrderKeyBetween(
                                      to.belowOrderKey,
                                      taskCollection.taskIdByOrderKey.getEntryAfter(
                                          to.belowOrderKey,
                                      )?.[0] ?? null,
                                  )
                                : generateOrderKeyBetween(
                                      null,
                                      taskCollection.taskIdByOrderKey.getFirstEntry()?.[0] ?? null,
                                  ),
                            task.id,
                        ),
                };

                taskCollectionById = taskCollectionById.set(taskCollection.id, taskCollection);

                if (!task.collectionIds.has(to.collectionId)) {
                    const newCollectionIds = new Set(task.collectionIds);
                    newCollectionIds.add(to.collectionId);

                    task = {
                        ...task,
                        collectionIds: newCollectionIds,
                    };
                }
                break;
            }
            default:
                throw exhaustive(to);
        }

        if (task !== oldTask) taskById = taskById.set(task.id, task);

        return new LocalTasksDatabase({
            taskById,
            taskCollectionById,
            taskIdByOrderKeyByNotepadPageId,
        });
    }

    public nestTask(
        from: LocalTasksMoveTaskFrom,
        parentTaskId: LocalTaskId,
        childTaskId: LocalTaskId,
    ) {
        if (parentTaskId === childTaskId)
            throw new InvalidArgumentError("Can't nest task under itself");

        const childTask = this._taskById.get(childTaskId);
        if (!childTask) throw new NotFoundError("Child task not found");

        const parentTask = this._taskById.get(parentTaskId);
        if (!parentTask) throw new NotFoundError("Parent task not found");

        return this.moveTask(
            from,
            {
                type: "ParentTask",
                parentTaskId,
                belowOrderKey: parentTask.childTaskIdByOrderKey.getLastEntry()?.[0] ?? null,
            },
            childTaskId,
        );
    }

    public deleteTaskAndAllChildren(taskId: LocalTaskId) {
        let taskById = this._taskById;
        let taskIdByOrderKeyByNotepadPageId = this._taskIdByOrderKeyByNotepadPageId;
        let taskCollectionById = this._taskCollectionById;

        const deleteTask = (taskId: LocalTaskId, shouldDeleteFromParent: boolean) => {
            const [task, _taskById] = taskById.getAndDelete(taskId);
            taskById = _taskById;

            if (!task) throw new NotFoundError("Task not found");

            if (shouldDeleteFromParent) {
                taskById = deleteTaskInParentTask(taskById, task);
            }

            taskIdByOrderKeyByNotepadPageId = deleteTaskInTaskIdByOrderKeyByNotepadPageId(
                taskIdByOrderKeyByNotepadPageId,
                taskId,
            );

            for (const collectionId of task.collectionIds) {
                let taskCollection = assertExists(taskCollectionById.get(collectionId));

                taskCollection = {
                    ...taskCollection,
                    lastTaskAddedOrRemovedTimeRoundedToDay: roundDateToDay(new Date()),
                    taskCount: taskCollection.taskCount - 1,
                    // TODO(calebmer): In a production implementation we should have a reverse
                    // index since a scan could be expensive.
                    taskIdByOrderKey: reduceIterable(
                        taskCollection.taskIdByOrderKey.entries(),
                        (taskIdByOrderKey, [orderKey, otherTaskId]) =>
                            otherTaskId === task.id
                                ? taskIdByOrderKey.delete(orderKey)
                                : taskIdByOrderKey,
                        taskCollection.taskIdByOrderKey,
                    ),
                };

                taskCollectionById = taskCollectionById.set(taskCollection.id, taskCollection);
            }

            for (const childTaskId of task.childTaskIdByOrderKey.values()) {
                deleteTask(childTaskId, false);
            }
        };

        deleteTask(taskId, true);

        return new LocalTasksDatabase({
            taskById,
            taskCollectionById,
            taskIdByOrderKeyByNotepadPageId,
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

    public createTaskCollection(taskCollection: {
        id: LocalTaskCollectionId;
        name: string;
        color: ThemeColor;
    }) {
        return new LocalTasksDatabase({
            taskById: this._taskById,
            taskCollectionById: this._taskCollectionById.update(
                taskCollection.id,
                oldTaskCollection => {
                    if (oldTaskCollection)
                        throw new FailedPreconditionError("Task collection already exists");

                    const createdTime = new Date();

                    return {
                        ...taskCollection,
                        createdTime,
                        lastTaskAddedOrRemovedTimeRoundedToDay: null,
                        taskCount: 0,
                        taskIdByOrderKey: ImmutableMap.empty(),
                    };
                },
            ),
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
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
                        taskIdByOrderKey: ImmutableMap.from([[initialOrderKey, taskId]]),
                    };
                },
            ),
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
    }

    public addTaskCollectionToTask(taskId: LocalTaskId, taskCollectionId: LocalTaskCollectionId) {
        return new LocalTasksDatabase({
            taskById: this._taskById.update(taskId, task => {
                if (!task) throw new NotFoundError("Task not found");

                if (task.collectionIds.has(taskCollectionId))
                    throw new FailedPreconditionError("Task already has collection");

                const newCollectionIds = new Set(task.collectionIds);
                newCollectionIds.add(taskCollectionId);

                return {...task, collectionIds: newCollectionIds};
            }),
            taskCollectionById: this._taskCollectionById.update(
                taskCollectionId,
                taskCollection => {
                    if (!taskCollection) throw new NotFoundError("Task collection not found");

                    const firstEntry = taskCollection.taskIdByOrderKey.getFirstEntry();

                    return {
                        ...taskCollection,
                        lastTaskAddedOrRemovedTimeRoundedToDay: roundDateToDay(new Date()),
                        taskCount: taskCollection.taskCount + 1,
                        taskIdByOrderKey: taskCollection.taskIdByOrderKey.set(
                            firstEntry
                                ? generateOrderKeyBetween(null, firstEntry[0])
                                : initialOrderKey,
                            taskId,
                        ),
                    };
                },
            ),
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
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

                if (!newCollectionIds.delete(taskCollectionId))
                    throw new FailedPreconditionError("Task does not have collection");

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
                        // TODO(calebmer): In a production implementation we should have a reverse
                        // index since a scan could be expensive.
                        taskIdByOrderKey: reduceIterable(
                            taskCollection.taskIdByOrderKey.entries(),
                            (taskIdByOrderKey, [orderKey, otherTaskId]) =>
                                otherTaskId === taskId
                                    ? taskIdByOrderKey.delete(orderKey)
                                    : taskIdByOrderKey,
                            taskCollection.taskIdByOrderKey,
                        ),
                    };
                },
            ),
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
    }

    public updateTaskCollectionName(taskCollectionId: LocalTaskCollectionId, name: string) {
        return new LocalTasksDatabase({
            taskById: this._taskById,
            taskCollectionById: this._taskCollectionById.update(
                taskCollectionId,
                taskCollection => {
                    if (!taskCollection) throw new NotFoundError("Task collection not found");
                    return {...taskCollection, name};
                },
            ),
            taskIdByOrderKeyByNotepadPageId: this._taskIdByOrderKeyByNotepadPageId,
        });
    }

    public getAllTaskCollections() {
        return Array.from(this._taskCollectionById.values()).sort((collection1, collection2) =>
            collection1.name.localeCompare(collection2.name),
        );
    }

    public queryAllTasks(
        filters: ReadonlyArray<TaskQueryFilter>,
        sorts: ReadonlyArray<TaskQuerySort>,
        context: {currentAccountId: AccountId; currentDate: CalendarDate},
    ) {
        const normalizedFiltersResult = normalizeTaskQueryFilters(filters, context);
        if (normalizedFiltersResult.type === "Impossible") return [];
        const normalizedFilters = normalizedFiltersResult.normalizedFilters;

        const tasks = [];

        for (const task of this._taskById.values()) {
            if (evaluateTaskQueryNormalizedFilters(normalizedFilters, task)) {
                tasks.push(task);
            }
        }

        tasks.sort(createTaskQuerySortsCompareFunction(sorts));

        return tasks;
    }

    public queryCollectionTasksIfExists(
        collectionId: LocalTaskCollectionId,
        filters: ReadonlyArray<TaskQueryFilter>,
        sorts: ReadonlyArray<TaskQuerySort>,
        context: {currentAccountId: AccountId; currentDate: CalendarDate},
    ) {
        const normalizedFiltersResult = normalizeTaskQueryFilters(filters, context);
        if (normalizedFiltersResult.type === "Impossible") return [];
        const normalizedFilters = normalizedFiltersResult.normalizedFilters;

        const tasks: Array<{orderKey: OrderKey; task: LocalTask}> = [];

        const taskCollection = this.getTaskCollectionIfExists(collectionId);

        if (taskCollection) {
            for (const [orderKey, taskId] of taskCollection.taskIdByOrderKey) {
                const task = this.getTask(taskId);

                if (evaluateTaskQueryNormalizedFilters(normalizedFilters, task)) {
                    tasks.push({orderKey, task});
                }
            }
        }

        if (sorts.length > 0) {
            const compare = createTaskQuerySortsCompareFunction(sorts);
            tasks.sort(({task: task1}, {task: task2}) => compare(task1, task2));
        }

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

function deleteTaskInTaskIdByOrderKeyByNotepadPageId(
    taskIdByOrderKeyByNotepadPageId: ImmutableMap<number, ImmutableMap<OrderKey, LocalTaskId>>,
    taskId: LocalTaskId,
    onlyNotepadPage?: number,
) {
    // TODO(calebmer): In a production implementation we should have a reverse
    // index since a scan could be expensive.
    for (const [notepadPageId, oldTaskIdByOrderKey] of taskIdByOrderKeyByNotepadPageId) {
        if (onlyNotepadPage !== undefined && onlyNotepadPage !== notepadPageId) continue;

        let newTaskIdByOrderKey = oldTaskIdByOrderKey;

        for (const [orderKey, otherTaskId] of oldTaskIdByOrderKey) {
            if (otherTaskId === taskId) newTaskIdByOrderKey = newTaskIdByOrderKey.delete(orderKey);
        }

        if (oldTaskIdByOrderKey !== newTaskIdByOrderKey) {
            taskIdByOrderKeyByNotepadPageId = taskIdByOrderKeyByNotepadPageId.set(
                notepadPageId,
                newTaskIdByOrderKey,
            );
        }
    }

    return taskIdByOrderKeyByNotepadPageId;
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
     * Filters on the view where the task is created. We fill in fields on the
     * task to match the view's filters when possible.
     *
     * If null then we will fill no fields on the task according to filters.
     *
     * We require this option so you don't forget to pass it in when creating a
     * task in a filtered context since it's important for good UX of filtered
     * views.
     */
    normalizedFilters: TaskQueryNormalizedFilters | null;

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
     * The initial assignee for this task.
     */
    assignee?: TaskAssignee;

    /**
     * The initial due date for this task.
     */
    dueDate?: CalendarDate;

    /**
     * The initial priority for this task.
     */
    priority?: TaskPriority;

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
    notepad?: {pageId: number; orderKey?: OrderKey; side?: "Above" | "Below"};

    /**
     * Set this to create a task in a collection.
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
    collection?: {id: LocalTaskCollectionId; orderKey?: OrderKey; side?: "Above" | "Below"};

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
    // TODO(calebmer): In a production implementation I'm thinking about storing
    // all notepad IDs for an account in a single DynamoDB item. Given notepad IDs
    // are sorted, unique, timestamps. We can compress them with vtenc which is
    // relatively simple and has great compression benchmarks. Space here is more
    // of an issue for us than speed.
    // https://vteromero.github.io/2019/07/28/vtenc.html
    taskIdByOrderKeyByNotepadPageId: Schema.map(
        Schema.integer,
        LocalTaskIdByOrderKeySchema,
    ).default(new Map()),
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
    | LocalTasksUpdateTaskPriorityAction
    | LocalTasksUpdateTaskDueDateAction
    | LocalTasksUpdateTaskNotesContentAction
    | LocalTasksDeleteTaskAndAllChildrenAction
    | LocalTasksNestTaskAction
    | LocalTasksMoveTaskAction
    | LocalTasksCreateTaskCollectionAction
    | LocalTasksCreateTaskCollectionAndAddToTaskAction
    | LocalTasksAddTaskCollectionToTaskAction
    | LocalTasksRemoveTaskCollectionFromTaskAction
    | LocalTasksUpdateTaskCollectionNameAction;

type LocalTasksRestoreStateAction = {
    readonly type: "RestoreState";
    readonly serializedStateString: string;
};

type LocalTasksResetStateAction = {
    readonly type: "ResetState";
};

type LocalTasksCreateNotepadPageAction = {
    readonly type: "CreateNotepadPage";
    readonly notepadPageId: number;
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

type LocalTasksUpdateTaskPriorityAction = {
    readonly type: "UpdateTaskPriority";
    readonly taskId: LocalTaskId;
    readonly priority: TaskPriority | null;
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
    readonly from: LocalTasksMoveTaskFrom;
    readonly onLayoutEffect?: () => void;
};

type LocalTasksMoveTaskAction = {
    readonly type: "MoveTask";
    readonly taskId: LocalTaskId;
    readonly from: LocalTasksMoveTaskFrom;
    readonly to: LocalTasksMoveTaskTo;
    readonly onLayoutEffect?: () => void;
};

type LocalTasksCreateTaskCollectionAction = {
    readonly type: "CreateTaskCollection";
    readonly id: LocalTaskCollectionId;
    readonly name: string;
    readonly color: ThemeColor;
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

type LocalTasksUpdateTaskCollectionNameAction = {
    readonly type: "UpdateTaskCollectionName";
    readonly taskCollectionId: LocalTaskCollectionId;
    readonly name: string;
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
                database: state.database.createNotepadPage(action.notepadPageId),
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

        case "UpdateTaskPriority": {
            return {
                ...state,
                database: state.database.updateTaskPriority(action.taskId, action.priority),
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
            const {from, parentTaskId, childTaskId, onLayoutEffect} = action;

            return {
                ...state,
                database: state.database.nestTask(from, parentTaskId, childTaskId),
                layoutEffectRef: onLayoutEffect
                    ? {current: () => onLayoutEffect()}
                    : state.layoutEffectRef,
            };
        }

        case "MoveTask": {
            const {taskId, from, to, onLayoutEffect} = action;

            return {
                ...state,
                database: state.database.moveTask(from, to, taskId),
                layoutEffectRef: onLayoutEffect
                    ? {current: () => onLayoutEffect()}
                    : state.layoutEffectRef,
            };
        }

        case "CreateTaskCollection": {
            return {
                ...state,
                database: state.database.createTaskCollection(action),
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

        case "UpdateTaskCollectionName": {
            return {
                ...state,
                database: state.database.updateTaskCollectionName(
                    action.taskCollectionId,
                    action.name,
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
