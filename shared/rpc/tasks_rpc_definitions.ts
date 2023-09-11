import {AccountModel} from "~/shared/accounts/account_model.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewTaskKeySchema} from "~/shared/tasks/task_grid_view_task_key.js";
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
        extraActionsReferencedAccounts: Schema.array(AccountModel.schema()),
    },
});

export const expandChildTasksInGridView = defineRpc({
    name: "expandChildTasksInGridView",
    input: {
        spaceId: Schema.id<SpaceId>(),
        browserId: Schema.id<BrowserId>(),
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        taskKey: TaskGridViewTaskKeySchema,
    },
    output: {},
});

export const collapseChildTasksInGridView = defineRpc({
    name: "collapseChildTasksInGridView",
    input: {
        spaceId: Schema.id<SpaceId>(),
        browserId: Schema.id<BrowserId>(),
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        taskKey: TaskGridViewTaskKeySchema,
    },
    output: {},
});
