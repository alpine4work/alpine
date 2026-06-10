import {addDays} from "date-fns";
import {Step} from "prosemirror-transform";
import {applyMentionCountByAccountIdDifferenceFromContentUpdate} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {computeUpdateMessageContent} from "~/server/messaging/helpers/compute_update_message_content.js";
import {messagingEventExpirationDays} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadContentUpdate} from "~/shared/messaging/message_schema.js";

export function updateTaskCommentContent(
    context: ServerAccountActionContext,
    {
        taskId,
        commentIndex,
        contentVersion,
        steps,
    }: {
        taskId: TaskId;
        commentIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: MessageContent;
    contentUpdate: MessageContentPayloadContentUpdate;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{item, commentsSummaryItem}, taskCommentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Comments",
                taskId,
                commentIndex,
            }),
        ]);
        if (!commentsSummaryItem) throw new NotFoundError("Task comments summary item not found");
        if (!taskCommentItem) throw new NotFoundError("Task comment not found");

        if (taskCommentItem.authorId !== context.actor.getPossiblyBotAccountId()) {
            throw new PermissionDeniedError("Can only update Task comments you authored");
        }

        const {oldPayload, newPayload} = computeUpdateMessageContent(
            taskCommentItem,
            contentVersion,
            steps,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem.mentionCountByAccountId,
            oldPayload.content,
            newPayload.content,
        );

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...taskCommentItem,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            TaskTable.transactionDirectlyUpdateItem({
                ...commentsSummaryItem,
                taskId,
                nextCommentIndex: commentsSummaryItem.nextCommentIndex,
                commentCountByAuthorId: commentsSummaryItem.commentCountByAuthorId,
                mentionCountByAccountId: newMentionCountByAccountId,
                updateLockVersion: commentsSummaryItem.updateLockVersion,
            }),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "MessageUpdates",
                taskId,
                eventTime: newPayload.contentUpdate.time,
                messageIndex: taskCommentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(
                    newPayload.contentUpdate.time,
                    messagingEventExpirationDays,
                ),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: item.spaceId,
            update: {
                type: "TaskComment",
                taskId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            spaceId: item.spaceId,
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            content: newPayload.content,
            contentUpdate: newPayload.contentUpdate,
        };
    });
}
