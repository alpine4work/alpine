import {ServerActionContext} from "~/server/context/server_action_context.js";
import {runBackfillMessageUpdates} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {getTaskCommentCount} from "~/server/tasks/data/get_task_comment_count.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {
    createTaskCommentModelFromItem,
    getTaskCommentItemIfExists,
} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {getTaskCommentsFromStartAssumingAuthorizedTask} from "~/server/tasks/data/internal/get_task_comments_from_start_assuming_authorized_task.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessageUpdatesBackfillResult} from "~/shared/messaging/messaging_realtime_protocol.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export async function backfillTaskComments(
    context: ServerActionContext,
    {
        taskId,
        checkpoint,
        clientCommentCount,
        newCommentLimit,
    }: {
        taskId: TaskId;
        checkpoint: ServerSynchronizationCheckpoint;
        clientCommentCount: number;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    newComments: Array<TaskCommentModel>;
    newOtherReferencedComments: Array<TaskCommentModel>;
    commentUpdatesResult: MessageUpdatesBackfillResult<TaskCommentModel>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );
    const [{commentsSummaryItem}, {comments, otherReferencedComments}, commentUpdatesResult] =
        await runAllPromises([
            authorizationPromise,
            getTaskCommentsFromStartAssumingAuthorizedTask(context, {
                taskId,
                getSpaceId: () => authorizationPromise.then(({item}) => item.spaceId),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller will
                // observe all realtime events before this function call. Realtime events that
                // happen during the function call may be missed. You should be subscribed to new
                // realtime events before starting to backfill.
                consistency: "Strong",
            }),
            runBackfillMessageUpdates(context, {
                checkpoint,
                queryMessageUpdates: (context, options) =>
                    TaskTable.query(context, {
                        partitionKey: {partitionType: "Task", taskId},
                        ...options,
                    }),
                getMessageIfExists: (context, messageIndex, options) =>
                    getTaskCommentItemIfExists(context, taskId, messageIndex, options),
                createMessageModelFromItem: async (context, item) => {
                    const {
                        item: {spaceId},
                    } = await authorizationPromise;
                    return await createTaskCommentModelFromItem(context, spaceId, taskId, item);
                },
            }),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentUpdatesResult,
    };
}
