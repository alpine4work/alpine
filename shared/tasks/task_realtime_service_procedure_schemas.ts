import {ErrorSchema} from "~/shared/error/error_schema.js";
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
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {
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
    }),
    Collection: Schema.object({
        type: Schema.value("Collection"),
        limit: Schema.integer,
        collectionId: Schema.id<TaskCollectionId>(),
        evaluationContext: TaskQueryEvaluationContextSchema,
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
