import {addDays} from "date-fns";
import {applyMentionCountByAccountIdDifferenceFromContentUpdate} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {messagingEventExpirationDays} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export function deleteTaskComment(
    context: ServerAccountActionContext,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<{version: number; deletedTime: Date}> {
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

        if (taskCommentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete task comments you authored");

        if (taskCommentItem.payload.type !== "Content")
            throw new FailedPreconditionError(
                "Can\u2019t delete comments with a non-content payload",
            );

        if (taskCommentItem.payload.clerical)
            throw new FailedPreconditionError("Can\u2019t delete clerical comments");

        const deletedTime = new Date();

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem.mentionCountByAccountId,
            taskCommentItem.payload.content,
            null,
        );

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...taskCommentItem,
            payload: {type: "Deleted", deletedTime},
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
                eventTime: deletedTime,
                messageIndex: taskCommentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(deletedTime, messagingEventExpirationDays),
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
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            deletedTime,
        };
    });
}
