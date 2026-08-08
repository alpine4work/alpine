import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {ErrorCodeSchema, ErrorSchema} from "~/shared/error/error_schema.js";
import {
    BrowserId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
    TaskRealtimeCollectionSubscriptionId,
    TaskRealtimeQuerySubscriptionId,
    TaskRealtimeTaskSubscriptionId,
} from "~/shared/id/types/id_types.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type TaskRealtimeEvent = WebSocketProtocolEventType<typeof TaskRealtimeProtocol>;

export type TaskAuthorizationState = SchemaType<typeof TaskAuthorizationStateSchema>;

const TaskAuthorizationStateSchema = Schema.union({
    Authorized: Schema.object({
        type: Schema.value("Authorized"),
    }),
    Unauthorized: Schema.object({
        type: Schema.value("Unauthorized"),
        errorCode: ErrorCodeSchema,
    }),
});

export type TaskAuthorizationStateRegister = CrdtRegister<TaskAuthorizationState>;
export const TaskAuthorizationStateRegister = createCrdtRegister(TaskAuthorizationStateSchema);

/**
 * Authorized `TaskAuthorizationState` object. If you use this instead of
 * `{type: "Authorized"}` then your code is marginally more performant since we're
 * not allocating a bunch of tiny objects we have to garbage collect later.
 */
export const taskAuthorizedState: {readonly type: "Authorized"} = {type: "Authorized"};

export type TaskRealtimeUpdateEventBackfillTask = SchemaType<
    typeof TaskRealtimeUpdateEventBackfillTaskSchema
>;

const TaskRealtimeUpdateEventBackfillTaskSchema = Schema.union({
    Authorized: Schema.object({
        type: Schema.value("Authorized"),
        task: TaskModel.schema,
        authorizationStateVersion: HybridLogicalTimeSchema.optional(),
    }),
    Unauthorized: Schema.object({
        type: Schema.value("Unauthorized"),
        taskId: Schema.id<TaskId>(),
        errorCode: ErrorCodeSchema,
        authorizationStateVersion: HybridLogicalTimeSchema.optional(),
    }),
});

export type TaskRealtimeUpdateEventBackfillCollection = SchemaType<
    typeof TaskRealtimeUpdateEventBackfillCollectionSchema
>;

const TaskRealtimeUpdateEventBackfillCollectionSchema = Schema.union({
    Authorized: Schema.object({
        type: Schema.value("Authorized"),
        collection: TaskCollectionModel.schema,
        authorizationStateVersion: HybridLogicalTimeSchema.optional(),
    }),
    Unauthorized: Schema.object({
        type: Schema.value("Unauthorized"),
        collectionId: Schema.id<TaskCollectionId>(),
        errorCode: ErrorCodeSchema,
        authorizationStateVersion: HybridLogicalTimeSchema.optional(),
    }),
});

export type TaskRealtimeUpdateEvent = SchemaType<typeof TaskRealtimeUpdateEventSchema>;

export const TaskRealtimeUpdateEventSchema = Schema.object({
    type: Schema.value("Update"),
    actions: Schema.array(TaskActionSchema),
    backfillTasks: Schema.array(TaskRealtimeUpdateEventBackfillTaskSchema),
    backfillCollections: Schema.array(TaskRealtimeUpdateEventBackfillCollectionSchema),
    defaultAuthorizationStateVersion: HybridLogicalTimeSchema,
    referencedAccounts: Schema.array(AccountModel.schema),
    referencedSites: Schema.array(
        Schema.booleanUnion(
            "isPrivate",
            Schema.object({isPrivate: Schema.value(true)}),
            Schema.object({isPrivate: Schema.value(false), site: SitePreviewModel.schema}),
        ),
    ),
    originClientId: Schema.id<TaskRealtimeClientId>().nullable(),
});

export const TaskQuerySortCursorSchema = Schema.array(
    Schema.unknown(),
) as any as Schema<TaskQuerySortCursor>;

/**
 * Tells you how much of the query is loaded.
 *
 * - If `Partial` then that means only some of the query's tasks are loaded.
 * - If `Full` that means all of the query's tasks are loaded.
 * - `Partial` with an `endCursor` of null means no tasks are loaded yet.
 * - `Partial` with an `endCursor` means all tasks before `endCursor` (inclusive)
 *   are loaded.
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
                clientTime: HybridLogicalTimeSchema,
                filters: TaskQueryNormalizedFiltersSchema,
                sorts: Schema.array(TaskQueryNormalizedSortSchema),
                limit: Schema.integer,
                shouldLoadGridViewExpandedChildTasksForBrowserId: Schema.id<BrowserId>().optional(),
            },
            output: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
                loadedState: TaskRealtimeQueryLoadedStateSchema,
                previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
                gridViewExpansionState: TaskGridViewExpansionStateSchema.nullable(),
                extraQueries: Schema.array(
                    Schema.object({
                        querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
                        filters: TaskQueryNormalizedFiltersSchema,
                        sorts: Schema.array(TaskQueryNormalizedSortSchema),
                        limit: Schema.integer,
                        loadedState: TaskRealtimeQueryLoadedStateSchema,
                        previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
                    }),
                ),
                updateEvent: TaskRealtimeUpdateEventSchema.nullable(),
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
                clientTime: HybridLogicalTimeSchema,
                taskId: Schema.id<TaskId>(),
            },
            output: {
                taskSubscriptionId: Schema.id<TaskRealtimeTaskSubscriptionId>(),
                updateEvent: TaskRealtimeUpdateEventSchema.nullable(),
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
                clientTime: HybridLogicalTimeSchema,
                collectionId: Schema.id<TaskCollectionId>(),
            },
            output: {
                collectionSubscriptionId: Schema.id<TaskRealtimeCollectionSubscriptionId>(),
                updateEvent: TaskRealtimeUpdateEventSchema.nullable(),
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
                clientTime: HybridLogicalTimeSchema,
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
                limit: Schema.integer,
            },
            output: {
                loadedState: TaskRealtimeQueryLoadedStateSchema,
                previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
                updateEvent: TaskRealtimeUpdateEventSchema.nullable(),
            },
        },
        subscribe: {
            input: {
                clientTime: HybridLogicalTimeSchema,
                queries: Schema.array(
                    Schema.object({
                        filters: TaskQueryNormalizedFiltersSchema,
                        sorts: Schema.array(TaskQueryNormalizedSortSchema),
                        limit: Schema.integer,
                        shouldLoadGridViewExpandedChildTasksForBrowserId:
                            Schema.id<BrowserId>().optional(),
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
                            gridViewExpansionState: TaskGridViewExpansionStateSchema.nullable(),
                            extraQueries: Schema.array(
                                Schema.object({
                                    querySubscriptionId:
                                        Schema.id<TaskRealtimeQuerySubscriptionId>(),
                                    filters: TaskQueryNormalizedFiltersSchema,
                                    sorts: Schema.array(TaskQueryNormalizedSortSchema),
                                    limit: Schema.integer,
                                    loadedState: TaskRealtimeQueryLoadedStateSchema,
                                    previouslyBackfilledTaskIds: Schema.array(Schema.id<TaskId>()),
                                }),
                            ),
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
                updateEvent: TaskRealtimeUpdateEventSchema.nullable(),
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
        QuerySubscriptionError: Schema.object({
            type: Schema.value("QuerySubscriptionError"),
            id: Schema.id<TaskRealtimeQuerySubscriptionId>(),
            error: ErrorSchema,
        }),
        TaskSubscriptionError: Schema.object({
            type: Schema.value("TaskSubscriptionError"),
            id: Schema.id<TaskRealtimeTaskSubscriptionId>(),
            error: ErrorSchema,
        }),
        CollectionSubscriptionError: Schema.object({
            type: Schema.value("CollectionSubscriptionError"),
            id: Schema.id<TaskRealtimeCollectionSubscriptionId>(),
            error: ErrorSchema,
        }),
    },
});
