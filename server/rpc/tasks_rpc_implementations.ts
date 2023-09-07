import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/task_table.js";
import * as definition from "~/shared/rpc/tasks_rpc_definitions.js";

implementRpc(
    definition.commitTaskActionTransaction,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const {extraActions} = await commitTaskActionTransaction(
            context.actor.authorizeSession(),
            input.spaceId,
            input.actions,
        );

        return {extraActions};
    },
);
