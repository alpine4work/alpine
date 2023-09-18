import {AccountModel} from "~/shared/accounts/account_model.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";

export const commitTaskActionTransaction = defineRpc({
    name: "commitTaskActionTransaction",
    input: {
        spaceId: Schema.id<SpaceId>(),
        actions: Schema.array(TaskActionSchema),
    },
    output: {
        extraActions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema()),
    },
});

export const deleteTaskAndAllChildren = defineRpc({
    name: "deleteTaskAndAllChildren",
    input: {
        taskId: Schema.id<TaskId>(),
        actionTime: HybridLogicalTimeSchema,
    },
    output: {
        actions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema()),
    },
});

export const updateTaskGridViewExpansionState = defineRpc({
    name: "updateTaskGridViewExpansionState",
    input: {
        spaceId: Schema.id<SpaceId>(),
        browserId: Schema.id<BrowserId>(),
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        state: TaskGridViewExpansionStateSchema,
    },
    output: {},
});
