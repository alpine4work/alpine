import {addDays} from "date-fns";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {messagingEventExpirationDays} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {getTaskCommentItemIfExists} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";

export function deleteTaskCommentReaction(
    context: ServerAccountActionContext,
    {
        taskId,
        commentIndex,
        contentVersion,
        pos,
    }: {
        taskId: TaskId;
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [, commentItem] = await runAllPromises([
            authorizeTaskAccess(context, taskId, "Comment"),
            getTaskCommentItemIfExists(context, taskId, commentIndex),
        ]);
        if (!commentItem) throw new NotFoundError("Task comment not found");

        const currentTime = new Date();

        const newPayload = computeDeleteMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
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

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}
