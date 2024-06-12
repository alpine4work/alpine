import {
    getContentReferences,
    getContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {searchTaskCollections} from "~/server/tasks/data/task_index.js";
import {
    authorizeTaskAccess,
    backfillTaskComments,
    commitTaskActionTransaction,
    createTaskComment,
    deleteTaskAndAllChildren,
    deleteTaskComment,
    getTaskNotesContentWithoutReferences,
    updateTaskCommentContent,
    updateTaskGridViewExpansionState,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import * as definition from "~/shared/rpc/tasks_rpc_definitions.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_account_ids_from_task_action.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";

implementRpc(
    definition.commitTaskActionTransaction,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const {extraActions} = await commitTaskActionTransaction(
            context.actor.authorizeSession(),
            input.spaceId,
            input.actions,
            {
                clientId: input.clientId,
                leaseId: input.leaseId,
                createLeaseIfLostAccess: input.createLeaseIfLostAccess,
            },
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
            {clientId: input.clientId},
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
        return getTaskNotesContentWithoutReferences(context.actor.authorizeSession(), input.taskId);
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

implementRpc(
    definition.searchTaskCollections,
    {visibility: ["AppClient"]},
    async (_context, input) => {
        const context = _context.actor.authorizeSession();

        const collectionResults = await searchTaskCollections(context, input);

        return {collectionResults};
    },
);

implementRpc(
    definition.createTaskComment,
    {visibility: ["TaskNotesCollaborationService"]},
    async (unknownContext, input) => {
        const context = unknownContext.actor.authorizeSession();

        const {spaceId, index, createdTime} = await createTaskComment(
            context.actor.authorizeSession(),
            input,
        );

        const [author, contentReferences] = await runAllPromises([
            getAccount(context, spaceId, context.actor.getAccountId()),
            getContentReferencesForNode(context, spaceId, input.content),
        ]);

        const comment = new TaskCommentModel({
            taskId: input.taskId,
            index,
            author,
            createdTime,
            payload: {
                type: "Content",
                parentMessageIndex: input.parentCommentIndex,
                content: {
                    doc: input.content,
                    references: contentReferences,
                },
                contentUpdatedTime: null,
            },
        });

        return {comment};
    },
);
implementRpc(
    definition.updateTaskCommentContent,
    {visibility: ["TaskNotesCollaborationService"]},
    async (context, input) => {
        const {spaceId, contentUpdatedTime} = await updateTaskCommentContent(
            context.actor.authorizeSession(),
            input,
        );

        const contentReferences = await getContentReferencesForNode(
            context,
            spaceId,
            input.content,
        );

        return {contentUpdatedTime, contentReferences};
    },
);
implementRpc(
    definition.deleteTaskComment,
    {visibility: ["TaskNotesCollaborationService"]},
    (context, input) => {
        return deleteTaskComment(context.actor.authorizeSession(), input);
    },
);
implementRpc(
    definition.backfillTaskComments,
    {visibility: ["TaskNotesCollaborationService"]},
    (context, input) => {
        return backfillTaskComments(context.actor.authorizeSession(), input);
    },
);
