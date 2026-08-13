import {addMonths} from "date-fns";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    getTaskGridViewExpansionStateKey,
    taskGridViewExpansionStateExpirationMonths,
} from "~/server/tasks/data/internal/get_task_grid_view_expansion_state_key.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

export async function updateTaskGridViewExpansionState(
    context: ServerSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
        state,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        state: TaskGridViewExpansionState;
    },
) {
    await authorizeSpaceAccess(context, spaceId);

    if (state === null) {
        await TaskTable.deleteItemWithKeyIfExists(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
        });
    } else {
        await TaskTable.createOrReplaceItem(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
            state,
            expirationTime: addMonths(new Date(), taskGridViewExpansionStateExpirationMonths),
        });
    }
}
