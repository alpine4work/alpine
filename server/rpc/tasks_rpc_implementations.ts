import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/server/tasks/data/task_realtime_protocol_helpers.js";
import {
    commitTaskActionTransaction,
    deleteTaskAndAllChildren,
    updateTaskGridViewExpansionState,
} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";
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

        const accountIds = new Set<AccountId>();

        for (const action of extraActions) {
            collectReferencedAccountIdsFromTaskAction(accountIds, action);
        }

        const referencedAccounts = await runAllPromises(
            Array.from(accountIds, accountId => getAccount(context, input.spaceId, accountId)),
        );

        return {
            extraActions,
            referencedAccounts,
        };
    },
);

implementRpc(
    definition.deleteTaskAndAllChildren,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const {spaceId, actions} = await deleteTaskAndAllChildren(
            context.actor.authorizeSession(),
            input.taskId,
            input.actionTime,
        );

        const accountIds = new Set<AccountId>();

        for (const action of actions) {
            collectReferencedAccountIdsFromTaskAction(accountIds, action);
        }

        const referencedAccounts = await runAllPromises(
            Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
        );

        return {
            actions,
            referencedAccounts,
        };
    },
);

implementRpc(
    definition.updateTaskGridViewExpansionState,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await updateTaskGridViewExpansionState(context.actor.authorizeSession(), input);
        return {};
    },
);
