import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {intoApiTaskStatus} from "~/server/api/internal/shared/into_api_task_status.js";
import {serializeTaskQuerySortCursorForApi} from "~/server/api/internal/tasks/internal/serialize_task_query_sort_cursor_for_api.js";
import {
    ApiAccount,
    ApiTaskWithoutContent,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {compareTaskQuerySortCursors} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * Returns a strongly consistent list of tasks without content that match the provided filters
 * ordered by the provided sorts.
 */
export async function getApiTasksWithoutContent(
    context: ApiServiceBotActionContext,
    {
        collectionId,
        // TODO(ifitzsimmons, #ai): Enable pagination for tasks in task collections.
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/07nhzz04yh67q225ytjm01fwjr
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        cursor,
        limit,
        filters,
        sorts,
    }: {
        collectionId: TaskCollectionId;
        cursor: string | null;
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
): Promise<{tasks: Array<ApiTaskWithoutContent>; nextCursor: string | null}> {
    // NOTE(ifitzsimmons, 2025-11-07): We want to return strongly consistent data from
    // the API so loadQueries should make strongly consistent reads.
    //
    // …but in practice expecting strong consistency when going into loadQueries
    // doesn’t matter since that flag only has an effect for DynamoDB queries for the
    // current process. We don’t send it across the network boundary
    //
    // We `unexpectStrongReadConsistency` here so that our unit tests can pass, but
    // in production, this doesn't really matter (since, again, we don't send context
    // across the network boundary).
    const loadTaskContext = context.dynamo.unexpectStrongReadConsistency();
    const {queries, updateEvent} = await loadTaskContext.tasks.loadQueries(
        context.actor.getSpaceId(),
        {
            queries: [{limit, filters, sorts}],
            taskIds: [],
            collectionIds: [collectionId],
        },
    );

    const referencedAccountsById = new Map(
        updateEvent.referencedAccounts.map(account => [account.id, account]),
    );

    const getApiAccountForTaskAssignee = (task: TaskModel): ApiAccount | undefined => {
        const assignee = task.getAssignee();
        if (!assignee) return undefined;

        const assignedAccountId = assignee.assignee.accountId;
        const assignedAccountModel = referencedAccountsById.get(assignedAccountId);
        if (!assignedAccountModel) return undefined;
        return intoApiAccount(assignedAccountModel.initialData);
    };

    const tasks = filterMapArray(updateEvent.backfillTasks, task => {
        if (task.type !== "Authorized") return undefined;

        const matchesFilters = evaluateTaskQueryNormalizedFiltersForModel(filters, task.task);
        if (!matchesFilters) return undefined;

        return task.task;
    })
        .sort((taskA, taskB) =>
            compareTaskQuerySortCursors(
                sorts,
                getTaskQueryNormalizedSortCursorForModel(sorts, taskA),
                getTaskQueryNormalizedSortCursorForModel(sorts, taskB),
            ),
        )
        .map((task): ApiTaskWithoutContent => {
            const dueDate = task.getDueDate();

            return {
                id: task.id,
                status: intoApiTaskStatus(task.getDisplayStatus()),
                title: task.getTitle().getText(),
                assignee: getApiAccountForTaskAssignee(task),
                due: dueDate ? {date: dueDate.toString()} : undefined,
                priority: task.getPriority() ?? undefined,
            };
        });

    const nextCursor =
        queries[0]!.loadedState.type === "Partial" ? queries[0]!.loadedState.endCursor : null;

    return {
        tasks,
        nextCursor: nextCursor ? serializeTaskQuerySortCursorForApi(nextCursor) : null,
    };
}
