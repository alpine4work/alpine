import {BrowserId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedStateSchema,
    TaskRealtimeUpdateEventSchema,
} from "~/shared/tasks/task_realtime_protocol.js";

export const TaskRealtimeApplyActionTransactionInputSchema = Schema.object({
    committedTime: Schema.date,
    actions: Schema.array(TaskActionSchema),
});

export const TaskRealtimeLoadQueriesInputSchema = Schema.object({
    queries: Schema.array(
        Schema.object({
            filters: TaskQueryNormalizedFiltersSchema,
            sorts: Schema.array(TaskQueryNormalizedSortSchema),
            limit: Schema.integer,
            shouldLoadGridViewExpandedChildTasksForBrowserId: Schema.id<BrowserId>().optional(),
        }),
    ),
});

export const TaskRealtimeLoadQueriesOutputSchema = Schema.object({
    ok: Schema.value(true),
    loadedStates: Schema.array(TaskRealtimeQueryLoadedStateSchema),
    gridViewExpansionStates: Schema.array(TaskGridViewExpansionStateSchema),
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
