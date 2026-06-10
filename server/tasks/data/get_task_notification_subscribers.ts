import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";

export async function getTaskNotificationSubscribers(
    context: ServerSystemActionContext,
    id: TaskId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    accountIds: ReadonlySet<AccountId>;
}> {
    const {item: taskItem, commentsSummaryItem} =
        await authorizeTaskAccessAndGetCommentsSummaryItem(context, id, "Comment", options);

    const commentCountByAuthorId = commentsSummaryItem
        ? commentsSummaryItem.commentCountByAuthorId.keys()
        : [];
    const mentionCountByAccountId = commentsSummaryItem
        ? commentsSummaryItem.mentionCountByAccountId.keys()
        : [];

    const assigneeId = taskItem.assigneeId?.value;

    // note(maximchen, 2024-07-24): It is an open design question whether a old
    // assignee should stay subscribed to notifications even after they have been
    // unassigned.
    const accountIds = new Set(
        concatIterables(
            [taskItem.creatorId],
            assigneeId ? [assigneeId] : [],
            commentCountByAuthorId,
            mentionCountByAccountId,
        ),
    );

    return {
        accountIds,
    };
}
