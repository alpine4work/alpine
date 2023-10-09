import {AccountModel} from "~/shared/accounts/account_model.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
    TaskRealtimeCollectionSubscriptionId,
    TaskRealtimeQuerySubscriptionId,
    TaskRealtimeTaskSubscriptionId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type TaskRealtimeEvent = WebSocketProtocolEventType<typeof TaskRealtimeProtocol>;

export type TaskRealtimeUpdateEvent = SchemaType<typeof TaskRealtimeUpdateEventSchema>;

export const TaskRealtimeUpdateEventSchema = Schema.object({
    type: Schema.value("Update"),
    number: Schema.integer,
    actions: Schema.array(TaskActionSchema),
    backfillAuthorizedTasks: Schema.array(TaskModel.schema),
    backfillUnauthorizedTaskIds: Schema.array(Schema.id<TaskId>()),
    backfillAuthorizedCollections: Schema.array(TaskCollectionModel.schema),
    backfillUnauthorizedCollectionIds: Schema.array(Schema.id<TaskCollectionId>()),
    referencedAccounts: Schema.array(AccountModel.schema),
    originClientId: Schema.id<TaskRealtimeClientId>().nullable(),
});

const TaskQuerySortCursorSchema = Schema.array(
    Schema.unknown,
) as any as Schema<TaskQuerySortCursor>;

/**
 * Tells you how much of the query is loaded.
 *
 * - If `Partial` then that means only some of the query's tasks are loaded.
 * - If `Full` that means all of the query's tasks are loaded.
 * - `Partial` with an `endCursor` of null means no tasks are loaded yet.
 * - `Partial` with an `endCursor` means all tasks before `endCursor`
 *   (inclusive) are loaded.
 */
export type TaskRealtimeQueryLoadedState = SchemaType<typeof TaskRealtimeQueryLoadedStateSchema>;

export const TaskRealtimeQueryLoadedStateSchema = Schema.union({
    Partial: Schema.object({
        type: Schema.value("Partial"),
        endCursor: TaskQuerySortCursorSchema.nullable(),
    }),
    Full: Schema.object({
        type: Schema.value("Full"),
    }),
});

export const TaskRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        subscribeToQuery: {
            input: {
                filters: TaskQueryNormalizedFiltersSchema,
                sorts: Schema.array(TaskQueryNormalizedSortSchema),
                limit: Schema.integer,
            },
            output: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
                loadedState: TaskRealtimeQueryLoadedStateSchema,
                previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
            },
        },
        unsubscribeFromQuery: {
            input: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
            },
            output: {},
        },
        subscribeToTask: {
            input: {
                taskId: Schema.id<TaskId>(),
            },
            output: {
                taskSubscriptionId: Schema.id<TaskRealtimeTaskSubscriptionId>(),
            },
        },
        unsubscribeFromTask: {
            input: {
                taskSubscriptionId: Schema.id<TaskRealtimeTaskSubscriptionId>(),
            },
            output: {},
        },
        subscribeToCollection: {
            input: {
                collectionId: Schema.id<TaskCollectionId>(),
            },
            output: {
                collectionSubscriptionId: Schema.id<TaskRealtimeCollectionSubscriptionId>(),
            },
        },
        unsubscribeFromCollection: {
            input: {
                collectionSubscriptionId: Schema.id<TaskRealtimeCollectionSubscriptionId>(),
            },
            output: {},
        },
        loadMoreQueryTasks: {
            input: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
                limit: Schema.integer,
            },
            output: {
                loadedState: TaskRealtimeQueryLoadedStateSchema,
                previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
            },
        },
        subscribe: {
            input: {
                queries: Schema.array(
                    Schema.object({
                        filters: TaskQueryNormalizedFiltersSchema,
                        sorts: Schema.array(TaskQueryNormalizedSortSchema),
                        limit: Schema.integer,
                    }),
                ),
                taskIds: Schema.array(Schema.id<TaskId>()),
                collectionIds: Schema.array(Schema.id<TaskCollectionId>()),
            },
            output: {
                querySubscriptionResults: Schema.array(
                    Schema.result(
                        Schema.object({
                            ok: Schema.value(true),
                            querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
                            loadedState: TaskRealtimeQueryLoadedStateSchema,
                            previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
                        }),
                        Schema.object({
                            ok: Schema.value(false),
                            error: ErrorSchema,
                        }),
                    ),
                ),
                taskSubscriptionResults: Schema.array(
                    Schema.result(
                        Schema.object({
                            ok: Schema.value(true),
                            taskSubscriptionId: Schema.id<TaskRealtimeTaskSubscriptionId>(),
                        }),
                        Schema.object({
                            ok: Schema.value(false),
                            error: ErrorSchema,
                        }),
                    ),
                ),
                collectionSubscriptionResults: Schema.array(
                    Schema.result(
                        Schema.object({
                            ok: Schema.value(true),
                            collectionSubscriptionId:
                                Schema.id<TaskRealtimeCollectionSubscriptionId>(),
                        }),
                        Schema.object({
                            ok: Schema.value(false),
                            error: ErrorSchema,
                        }),
                    ),
                ),
            },
        },
        unsubscribe: {
            input: {
                querySubscriptionIds: Schema.array(Schema.id<TaskRealtimeQuerySubscriptionId>()),
                taskSubscriptionIds: Schema.array(Schema.id<TaskRealtimeTaskSubscriptionId>()),
                collectionSubscriptionIds: Schema.array(
                    Schema.id<TaskRealtimeCollectionSubscriptionId>(),
                ),
            },
            output: {},
        },
    },
    events: {
        Update: TaskRealtimeUpdateEventSchema,
    },
});
