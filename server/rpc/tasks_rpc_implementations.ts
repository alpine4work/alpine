import {getContentReferences} from "~/server/content/get_content_references.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {
    FileTaskAuthorizer,
    authorizeTaskAccess,
    backfillTaskComments,
    commitTaskActionTransaction,
    createTaskComment,
    deleteTaskAndAllChildren,
    deleteTaskComment,
    deleteTaskCommentReaction,
    duplicateTaskAndAllChildren,
    getTaskCommentAtVersion,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskNotesContentWithoutReferences,
    setTaskCommentReaction,
    updateTaskCommentContent,
    updateTaskGridViewExpansionState,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import * as definitions from "~/shared/rpc/tasks_rpc_definitions.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_account_ids_from_task_action.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export default implementRpcs(definitions, {
    commitTaskActionTransaction: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {extraActions} = await commitTaskActionTransaction(
                context.actor.authorizeSession(),
                input.spaceId,
                input.actions,
                {
                    clientId: input.clientId,
                    leaseId: input.leaseId,
                    createLeaseIfLostAccess: input.createLeaseIfLostAccess,
                    updateAccessPolicyShareNotification: input.updateAccessPolicyShareNotification,
                },
            );

            const accountIds = new Set<AccountId>();

            for (const action of extraActions) {
                collectReferencedAccountIdsFromTaskAction(accountIds, action);
            }

            const referencedAccounts = await runAllPromises(
                Array.from(accountIds, accountId => getAccount(context, input.spaceId, accountId)),
            );

            return {extraActions, referencedAccounts};
        },
    },

    deleteTaskAndAllChildren: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
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

            return {actions, referencedAccounts};
        },
    },

    duplicateTaskAndAllChildren: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {spaceId, actions, taskId} = await duplicateTaskAndAllChildren(
                context.actor.authorizeSession(),
                input.taskId,
                input.actionTime,
                input.timeZone,
            );

            const accountIds = new Set<AccountId>();

            for (const action of actions) {
                collectReferencedAccountIdsFromTaskAction(accountIds, action);
            }

            const referencedAccounts = await runAllPromises(
                Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
            );

            return {actions, referencedAccounts, taskId};
        },
    },

    updateTaskGridViewExpansionState: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateTaskGridViewExpansionState(context.actor.authorizeSession(), input);
            return {};
        },
    },

    getTaskNotesContent: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, input) => {
            return getTaskNotesContentWithoutReferences(
                context.actor.authorizeSession(),
                input.taskId,
            );
        },
    },

    updateTaskNotesContent: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, input) => {
            await updateTaskNotesContent(context.actor.authorizeSession(), input);
            return {};
        },
    },

    getTaskNotesContentReferences: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, {spaceId, taskId, referenceIds}) => {
            const references = await getContentReferences(
                context,
                spaceId,
                FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                referenceIds,
            );
            return {references};
        },
    },

    authorizeTaskAccess: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (_context, input) => {
            const context = _context.actor.authorizeSession();

            const [{spaceId}, editResult] = await runAllPromises([
                authorizeTaskAccess(context, input.taskId, "View"),
                captureResultPromise(() => authorizeTaskAccess(context, input.taskId, "Edit")),
            ]);

            return {spaceId, editResult};
        },
    },

    getTaskCommentsFromStart: {
        visibility: ["AppClient"],
        execute: (context, input) => {
            return getTaskCommentsFromStart(context.actor.authorizeSession(), input);
        },
    },

    getTaskCommentsFromEnd: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const checkpoint = generateServerSynchronizationCheckpoint();
            const output = await getTaskCommentsFromEnd(context.actor.authorizeSession(), input);
            return {...output, checkpoint};
        },
    },

    createTaskComment: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (unknownContext, input) => {
            const context = unknownContext.actor.authorizeSession();

            const {index, createdTime} = await createTaskComment(context.actor.authorizeSession(), {
                taskId: input.taskId,
                parent: input.parent,
                content: input.content,
                fileIds: input.fileIds,
                createdTimeZone: input.createdTimeZone,
            });

            return {index, createdTime};
        },
    },

    updateTaskCommentContent: {
        visibility: ["TaskNotesCollaborationService"],
        execute: (context, input) => {
            return updateTaskCommentContent(context.actor.authorizeSession(), input);
        },
    },

    deleteTaskComment: {
        visibility: ["TaskNotesCollaborationService"],
        execute: (context, input) => {
            return deleteTaskComment(context.actor.authorizeSession(), input);
        },
    },

    setTaskCommentReaction: {
        visibility: ["TaskNotesCollaborationService"],
        execute: (context, input) => {
            return setTaskCommentReaction(context.actor.authorizeSession(), input);
        },
    },

    deleteTaskCommentReaction: {
        visibility: ["TaskNotesCollaborationService"],
        execute: (context, input) => {
            return deleteTaskCommentReaction(context.actor.authorizeSession(), input);
        },
    },

    backfillTaskComments: {
        visibility: ["TaskNotesCollaborationService"],
        execute: (context, input) => {
            return backfillTaskComments(context.actor.authorizeSession(), input);
        },
    },

    getTaskCommentAtVersion: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, input) => {
            const comment = await getTaskCommentAtVersion(context.actor.authorizeSession(), input);
            return {comment};
        },
    },

    getTaskCommentReferences: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, {spaceId, taskId, referencedIds}) => {
            const references = await getMessageReferences(
                context.actor.authorizeSession(),
                spaceId,
                FileTaskAuthorizer.bind({type: "TaskComments", taskId}),
                referencedIds,
            );
            return {references};
        },
    },
});
