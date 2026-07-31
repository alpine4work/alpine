import {ErrorSchema} from "~/shared/error/error_schema.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {
    BrowserId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryEvaluationContextSchema} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFiltersSchema} from "~/shared/tasks/task_query_filters_schema.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortsSchema} from "~/shared/tasks/task_query_sorts_schema.js";
import {
    TaskQuerySortCursorSchema,
    TaskRealtimeQueryLoadedStateSchema,
    TaskRealtimeUpdateEventSchema,
} from "~/shared/tasks/task_realtime_protocol.js";

export const TaskRealtimeApplyActionTransactionInputSchema = Schema.object({
    committedTime: Schema.date,
    actions: Schema.array(TaskActionSchema),
    clientId: Schema.id<TaskRealtimeClientId>().nullable(),
});

export type TaskRealtimeLoadQueriesInputQuery = SchemaType<
    typeof TaskRealtimeLoadQueriesInputQuerySchema
>;

export const TaskRealtimeLoadQueriesInputQuerySchema = Schema.union({
    Normalized: Schema.object({
        type: Schema.value("Normalized"),
        limit: Schema.integer,
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        shouldLoadGridViewExpandedChildTasksForBrowserId: Schema.id<BrowserId>().optional(),

        // Expensive since we need to load all tasks before the cursor to serve this
        // request. If the tasks are already loaded in `TaskRealtimeService` this is cheap.
        // However, if this is a large query and it isn't loaded in `TaskRealtimeService`
        // then we may need to load thousands of tasks.
        expensivelyAfterCursor: TaskQuerySortCursorSchema.optional(),
    }),
    Collection: Schema.object({
        type: Schema.value("Collection"),
        limit: Schema.integer,
        collectionId: Schema.id<TaskCollectionId>(),
        filters: TaskQueryFiltersSchema.optional(),
        sorts: TaskQuerySortsSchema.optional(),
        evaluationContext: TaskQueryEvaluationContextSchema,

        // Notes:
        //
        // - Expensive since we need to load all tasks before the cursor to serve this
        //   request. If the task is already loaded in `TaskRealtimeService` this is cheap.
        //   However, if this is a large query and it isn't loaded in `TaskRealtimeService`
        //   then we may need to load thousands of tasks.
        //
        // - This is an `ApiTaskQueryCursor` instead of a `TaskQuerySortCursor` because we
        //   need the `TaskQueryNormalizedSort`s to parse an `ApiTaskQueryCursor` but the
        //   API doesn't have the collection's default sorts, that'll be loaded in
        //   `TaskRealtimeService`.
        expensivelyAfterCursorForApi: Schema.stringAs<ApiTaskQueryCursor>().optional(),
    }),
    Children: Schema.object({
        type: Schema.value("Children"),
        limit: Schema.integer,
        taskId: Schema.id<TaskId>(),
        filters: TaskQueryFiltersSchema.optional(),
        sorts: TaskQuerySortsSchema.optional(),
        evaluationContext: TaskQueryEvaluationContextSchema,

        // See the notes for `Collection.expensivelyAfterCursorForApi`.
        expensivelyAfterCursorForApi: Schema.stringAs<ApiTaskQueryCursor>().optional(),
    }),
}).defaultVariant("Normalized");

export type TaskRealtimeLoadQueriesInput = SchemaType<typeof TaskRealtimeLoadQueriesInputSchema>;

export const TaskRealtimeLoadQueriesInputSchema = Schema.object({
    queries: Schema.array(TaskRealtimeLoadQueriesInputQuerySchema),
    taskIds: Schema.array(Schema.id<TaskId>()),
    collectionIds: Schema.array(Schema.id<TaskCollectionId>()),
});

export type TaskRealtimeLoadQueriesOutputQuery = SchemaType<
    typeof TaskRealtimeLoadQueriesOutputQuerySchema
>;

export const TaskRealtimeLoadQueriesOutputQuerySchema = Schema.object({
    // The filters/sorts the query was actually loaded with. These match the input
    // query's `filters`/`sorts` if type was `Normalized`.
    filtersResult: Schema.union({
        Possible: Schema.object({
            type: Schema.value("Possible"),
            normalizedFilters: TaskQueryNormalizedFiltersSchema,
        }),
        Impossible: Schema.object({
            type: Schema.value("Impossible"),
        }),
    }),
    sorts: Schema.array(TaskQueryNormalizedSortSchema),
    loadedState: TaskRealtimeQueryLoadedStateSchema,
    gridViewExpansionState: TaskGridViewExpansionStateSchema,
});

export type TaskRealtimeLoadQueriesOutput = SchemaType<typeof TaskRealtimeLoadQueriesOutputSchema>;

export const TaskRealtimeLoadQueriesOutputSchema = Schema.object({
    ok: Schema.value(true),
    queries: Schema.array(TaskRealtimeLoadQueriesOutputQuerySchema),
    extraQueries: Schema.array(
        Schema.object({
            filters: TaskQueryNormalizedFiltersSchema,
            sorts: Schema.array(TaskQueryNormalizedSortSchema),
            limit: Schema.integer,
            loadedState: TaskRealtimeQueryLoadedStateSchema,
        }),
    ),
    updateEvent: TaskRealtimeUpdateEventSchema,
});

export type TaskRealtimeGetTaskWithoutDependenciesOutput = SchemaType<
    typeof TaskRealtimeGetTaskWithoutDependenciesOutputSchema
>;

export const TaskRealtimeGetTaskWithoutDependenciesOutputSchema = Schema.object({
    ok: Schema.value(true),
    taskResult: Schema.result(
        Schema.object({ok: Schema.value(true), value: TaskModel.schema}),
        Schema.object({ok: Schema.value(false), error: ErrorSchema}),
    ).nullable(),
});

export type TaskRealtimeGetCollectionOutput = SchemaType<
    typeof TaskRealtimeGetCollectionOutputSchema
>;

export const TaskRealtimeGetCollectionOutputSchema = Schema.object({
    ok: Schema.value(true),
    collectionResult: Schema.result(
        Schema.object({ok: Schema.value(true), value: TaskCollectionModel.schema}),
        Schema.object({ok: Schema.value(false), error: ErrorSchema}),
    ).nullable(),
});
