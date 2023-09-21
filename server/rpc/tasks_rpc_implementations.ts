import {getContentReferences} from "~/server/content/get_content_references.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/server/tasks/data/task_realtime_protocol_helpers.js";
import {
    authorizeTaskAccess,
    commitTaskActionTransaction,
    deleteTaskAndAllChildren,
    getTaskNotesContent,
    updateTaskGridViewExpansionState,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
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

implementRpc(
    definition.getTaskNotesContent,
    {visibility: ["TaskNotesCollaborationService"]},
    async (context, input) => {
        return getTaskNotesContent(context.actor.authorizeSession(), input.taskId);
    },
);

implementRpc(
    definition.updateTaskNotesContent,
    {visibility: ["TaskNotesCollaborationService"]},
    async (context, input) => {
        await updateTaskNotesContent(context.actor.authorizeSession(), input);
        return {};
    },
);

implementRpc(
    definition.getTaskNotesContentReferences,
    {visibility: ["TaskNotesCollaborationService"]},
    async (context, input) => {
        const references = await getContentReferences(context, input.spaceId, input.referenceIds);
        return {references};
    },
);

implementRpc(
    definition.authorizeTaskAccess,
    {visibility: ["TaskNotesCollaborationService"]},
    async (_context, input) => {
        const context = _context.actor.authorizeSession();

        const [{spaceId}, editResult] = await runAllPromises([
            authorizeTaskAccess(context, input.taskId, "View", null),
            captureResultPromise(() => authorizeTaskAccess(context, input.taskId, "Edit", null)),
        ]);

        return {
            spaceId,
            editResult,
        };
    },
);
