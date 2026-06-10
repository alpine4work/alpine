import {addDays} from "date-fns";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {messagingEventExpirationDays} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {getTaskCommentCount} from "~/server/tasks/data/get_task_comment_count.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {getTaskCommentItemIfExists} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {computeSetMessageReaction} from "~/shared/messaging/compute_set_message_reaction.js";
import {Reaction} from "~/shared/reactions/reaction.js";

export function setTaskCommentReaction(
    context: ServerSessionActionContextWithPush,
    {
        taskId,
        commentIndex,
        contentVersion,
        pos,
        reaction,
    }: {
        taskId: TaskId;
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
        reaction: Reaction | "GenericLike";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [{item: taskItem, commentsSummaryItem}, commentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            getTaskCommentItemIfExists(context, taskId, commentIndex),
        ]);
        if (!commentItem) throw new NotFoundError("Task comment not found");

        const currentTime = new Date();

        const newPayload = computeSetMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
            reaction,
        });

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "Task",
            sortRangeType: "Comments",
            taskId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "MessageUpdates",
                taskId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        context.process.waitUntil(
            context.notificationsInjection.archiveInboxTaskEntryAfterSetTaskCommentReaction({
                spaceId: taskItem.spaceId,
                taskId,
                commentCount: getTaskCommentCount(commentsSummaryItem),
                commentIndex,
            }),
        );

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}
