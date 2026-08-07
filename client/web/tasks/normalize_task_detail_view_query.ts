import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

const taskDetailViewDefaultQueryNormalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> = [
    {
        type: "ParentPosition",
        direction: "Ascending",
        missing: "Last",
    },
    {
        type: "CreatedTime",
        direction: "Ascending",
        missing: "Last",
    },
];

export function normalizeTaskDetailViewQuery(
    taskId: TaskId,
    filters: ReadonlyArray<TaskQueryFilter>,
    sorts: ReadonlyArray<TaskQuerySort>,
    evaluationContext: TaskQueryEvaluationContext,
) {
    // If no filters or sorts have been explicitly set then the user can manually sort
    // by parent position.
    //
    // If the detail view is filtered we automatically apply a sort since there can be
    // some weirdness creating a task and expecting it to be in one place when there's
    // no filter but instead it goes to another place.
    const normalizedSorts =
        filters.length === 0 && sorts.length === 0
            ? taskDetailViewDefaultQueryNormalizedSorts
            : normalizeTaskQuerySorts(sorts);

    filters = [
        // Show all display statuses by default.
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
            },
        },
        ...filters,
    ];

    const normalizedFiltersResult = normalizeTaskQueryFilters(filters, evaluationContext);

    if (normalizedFiltersResult.type !== "Possible")
        return {normalizedFiltersResult, normalizedSorts};

    return {
        normalizedFiltersResult: {
            type: "Possible",
            normalizedFilters: {
                ...normalizedFiltersResult.normalizedFilters,
                // Always filter to tasks that are children of the current task.
                parentFilter: {parentTaskId: taskId},
            },
        },
        normalizedSorts,
    };
}
