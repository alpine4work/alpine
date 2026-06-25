import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {getApiTaskCollectionItems} from "~/server/api/internal/tasks/internal/get_api_task_collection_items.js";
import {intoApiTaskLayout} from "~/server/api/internal/tasks/internal/into_api_task_layout.js";
import {serializeTaskQuerySortCursorForApi} from "~/server/api/internal/tasks/internal/serialize_task_query_sort_cursor_for_api.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiAccount,
    ApiTaskWithoutNotes,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {compareTaskQuerySortCursors} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * Returns a strongly consistent list of tasks without notes that match the
 * provided filters ordered by the provided sorts.
 */
export async function getApiTasksWithoutNotes(
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
): Promise<{tasks: Array<ApiTaskWithoutNotes>; nextCursor: string | null}> {
    const {queries, updateEvent} = await context.tasks.loadQueries(
        context.actor.getSpaceId(),
        {
            queries: [{type: "Normalized", limit, filters, sorts}],
            taskIds: [],
            collectionIds: [collectionId],
        },
        {consistency: "StrongWithinCache"},
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

    const tasks = await runAllPromises(
        filterMapArray(updateEvent.backfillTasks, task => {
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
            .map(async (task): Promise<ApiTaskWithoutNotes> => {
                const dueDate = task.getDueDate();
                const parent = task.getParent();
                const collections = await getApiTaskCollectionItems(
                    context,
                    task.getSpaceId(),
                    task
                        .getCollections()
                        .getArray()
                        .map(({collectionId}) => collectionId),
                );

                return {
                    id: task.id,
                    creator: {id: task.getCreator().accountId},
                    status: intoApiTaskStatus(task.getDisplayStatus()),
                    title: task.getTitle().getText(),
                    assignee: getApiAccountForTaskAssignee(task),
                    due: dueDate ? {date: dueDate.toString()} : undefined,
                    priority: task.getPriority() ?? undefined,
                    layout: intoApiTaskLayout(task.getLayout()),
                    // Keep API parent visibility aligned with `prepareTaskForClient()` in
                    // `server/tasks/data/prepare_task_for_client.ts`: AppService also exposes parent
                    // task IDs even when the parent task itself is not authorized. See that file for
                    // the security tradeoff.
                    parent: parent ? {task: {id: parent.taskId}} : undefined,
                    collections,
                };
            }),
    );

    const nextCursor =
        queries[0]!.loadedState.type === "Partial" ? queries[0]!.loadedState.endCursor : null;

    return {
        tasks,
        nextCursor: nextCursor ? serializeTaskQuerySortCursorForApi(nextCursor) : null,
    };
}
