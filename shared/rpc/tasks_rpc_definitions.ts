import {AccountModel} from "~/shared/accounts/account_model.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";

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
