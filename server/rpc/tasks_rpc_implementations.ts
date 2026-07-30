import {getContentReferences} from "~/server/content/get_content_references.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getSitePreviewIfPossible} from "~/server/sites/data/get_site_preview.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {deleteTaskAndAllChildren} from "~/server/tasks/data/delete_task_and_all_children.js";
import {duplicateTaskAndAllChildren} from "~/server/tasks/data/duplicate_task_and_all_children.js";
import {getTaskNotesContentSteps} from "~/server/tasks/data/get_task_notes_content_steps.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/get_task_notes_content_without_references.js";
import {
    backfillTaskComments,
    createTaskComment,
    deleteTaskComment,
    deleteTaskCommentReaction,
    getTaskCommentAtVersion,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    setTaskCommentReaction,
    updateTaskCommentContent,
} from "~/server/tasks/data/task_messaging.js";
import {updateTaskGridViewExpansionState} from "~/server/tasks/data/update_task_grid_view_expansion_state.js";
import {updateTaskNotesContentIdempotently} from "~/server/tasks/data/update_task_notes_content.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {AccountId, SiteId} from "~/shared/id/types/id_types.js";
import * as definitions from "~/shared/rpc/tasks_rpc_definitions.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export default implementRpcs(definitions, {
    commitTaskActionTransaction: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {extraActions, getRynamoEventsForSite} = await commitTaskActionTransaction(
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
            const siteIds = new Set<SiteId>();

            for (const action of extraActions) {
                collectReferencedIdsFromTaskAction(accountIds, siteIds, action);
            }

            const [referencedAccounts, referencedSites] = await runAllPromises([
                runAllPromises(
                    Array.from(accountIds, accountId =>
                        getAccount(context, input.spaceId, accountId),
                    ),
                ),
                runAllPromises(
                    Array.from(siteIds, async siteId => {
                        const result = await getSitePreviewIfPossible(context, siteId);
                        return result?.ok
                            ? ({isPrivate: false, site: result.value} as const)
                            : ({isPrivate: true} as const);
                    }),
                ),
            ]);

            return {
                extraActions,
                referencedAccounts,
                referencedSites: referencedSites.filter(isNonNullable),
                eventsForSite: await getRynamoEventsForSite(context),
            };
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
            const siteIds = new Set<SiteId>();

            for (const action of actions) {
                collectReferencedIdsFromTaskAction(accountIds, siteIds, action);
            }

            const [referencedAccounts, referencedSites] = await runAllPromises([
                runAllPromises(
                    Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
                ),
                runAllPromises(
                    Array.from(siteIds, async siteId => {
                        const result = await getSitePreviewIfPossible(context, siteId);
                        return result?.ok
                            ? ({isPrivate: false, site: result.value} as const)
                            : ({isPrivate: true} as const);
                    }),
                ),
            ]);

            return {
                actions,
                referencedAccounts,
                referencedSites: referencedSites.filter(isNonNullable),
            };
        },
    },

    duplicateTaskAndAllChildren: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {spaceId, actions, taskId} = await duplicateTaskAndAllChildren(
                context.actor.authorizeSession(),
                input,
            );

            const accountIds = new Set<AccountId>();
            const siteIds = new Set<SiteId>();

            for (const action of actions) {
                collectReferencedIdsFromTaskAction(accountIds, siteIds, action);
            }

            const [referencedAccounts, referencedSites] = await runAllPromises([
                runAllPromises(
                    Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
                ),
                runAllPromises(
                    Array.from(siteIds, async siteId => {
                        const result = await getSitePreviewIfPossible(context, siteId);
                        return result?.ok
                            ? ({isPrivate: false, site: result.value} as const)
                            : ({isPrivate: true} as const);
                    }),
                ),
            ]);

            return {
                actions,
                referencedAccounts,
                referencedSites: referencedSites.filter(isNonNullable),
                taskId,
            };
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
            return await getTaskNotesContentWithoutReferences(
                context.actor.authorizeAccount(),
                input.taskId,
            );
        },
    },

    updateTaskNotesContent: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, {spaceId, taskId, version, steps, clientId}, {callId}) => {
            const {newVersion} = await updateTaskNotesContentIdempotently(
                context.actor.authorizeAccount(),
                {
                    spaceId,
                    taskId,
                    clientId,
                    clientVersion: version,
                    clientSteps: steps,
                    clientRequestToken: callId,
                },
            );
            return {newVersion};
        },
    },

    getTaskNotesContentSteps: {
        visibility: ["TaskNotesCollaborationService"],
        execute: async (context, input) => {
            const steps = await getTaskNotesContentSteps(context.actor.authorizeAccount(), input);
            return {steps};
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
            const context = _context.actor.authorizeAccount();

            const {spaceId} = await authorizeTaskAccess(
                context,
                input.taskId,
                input.expectedAccessLevel,
            );

            return {spaceId};
        },
    },

    getTaskCommentsFromStart: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const checkpoint = generateServerSynchronizationCheckpoint();
            const output = await getTaskCommentsFromStart(context.actor.authorizeSession(), input);
            return {...output, checkpoint};
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
