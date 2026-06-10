import {addMonths, differenceInMonths} from "date-fns";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    getTaskGridViewExpansionStateKey,
    taskGridViewExpansionStateExpirationMonths,
    taskGridViewExpansionStateExpirationRenewalMonths,
} from "~/server/tasks/data/internal/get_task_grid_view_expansion_state_key.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {TaskRealtimeSessionActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

export async function getTaskGridViewExpansionState(
    context: TaskRealtimeSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
        consistency,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<TaskGridViewExpansionState> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await TaskTable.getItemIfExists(
        context,
        {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
        },
        {consistency},
    );

    // If the grid view's expansion state hasn't been updated in a while but is still
    // being read then we want to extend its expiration time.
    if (
        item &&
        differenceInMonths(item.expirationTime, new Date()) <=
            taskGridViewExpansionStateExpirationRenewalMonths
    ) {
        const newExpirationTime = addMonths(new Date(), taskGridViewExpansionStateExpirationMonths);

        context.process.waitUntil(
            TaskTable.createOrReplaceItem(context, {
                ...item,
                expirationTime: newExpirationTime,
            }),
        );
    }

    return item?.state ?? null;
}
