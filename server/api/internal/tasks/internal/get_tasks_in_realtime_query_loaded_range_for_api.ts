import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskRealtimeLoadQueriesOutputQuery} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

/**
 * Collects the tasks a `loadQueries()` query actually loaded, in query order.
 *
 * The update event returned by `loadQueries()` backfills tasks from all requested
 * queries plus their referenced tasks (like parent tasks) so we can't use
 * `updateEvent.backfillTasks` directly as the query's result. Instead we re-run
 * the query's filters over the backfilled tasks and only keep tasks inside the
 * loaded range: after `afterCursor` (exclusive) and up to the query's loaded
 * `endCursor` (inclusive).
 */
export function getTasksInRealtimeQueryLoadedRangeForApi({
    query,
    updateEvent,
    afterCursor,
}: {
    query: TaskRealtimeLoadQueriesOutputQuery;
    updateEvent: TaskRealtimeUpdateEvent;
    afterCursor: TaskQuerySortCursor | null;
}): Array<{cursor: TaskQuerySortCursor; task: TaskModel}> {
    const {loadedState, sorts, filtersResult} = query;

    const tasks: Array<{cursor: TaskQuerySortCursor; task: TaskModel}> = [];

    if (filtersResult.type === "Possible") {
        const filters = filtersResult.normalizedFilters;

        for (const backfillTask of updateEvent.backfillTasks) {
            if (backfillTask.type !== "Authorized") continue;
            const {task} = backfillTask;

            if (!evaluateTaskQueryNormalizedFiltersForModel(filters, task)) continue;

            const cursor = getTaskQueryNormalizedSortCursorForModel(sorts, task);

            // If the task is before or equal to `afterCursor` then it's outside the loaded
            // range for this request.
            if (
                afterCursor !== null &&
                compareTaskQuerySortCursors(sorts, afterCursor, cursor) >= 0
            ) {
                continue;
            }

            // If the task is after (though not equal to) `endCursor` then it's outside the
            // loaded range for this request.
            if (
                loadedState.type === "Partial" &&
                loadedState.endCursor !== null &&
                compareTaskQuerySortCursors(sorts, loadedState.endCursor, cursor) < 0
            ) {
                continue;
            }

            tasks.push({cursor, task});
        }
    }

    tasks.sort((task1, task2) => compareTaskQuerySortCursors(sorts, task1.cursor, task2.cursor));

    return tasks;
}
