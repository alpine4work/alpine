import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {getTaskCommentCount} from "~/server/tasks/data/get_task_comment_count.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskCommentItemContextCache} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";

export async function getTaskCommentPayloadsFromStart(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const [{item: taskItem, commentsSummaryItem}, commentItems] = await runAllPromises([
        authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment", {consistency}),
        arrayFromAsyncIterable(
            runCommentsQuery(context, {
                cache: TaskCommentItemContextCache,
                cacheKeyPrefix: taskId,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    TaskTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Task", taskId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastCommentIndex =
        commentItems.length > 0 ? commentItems[commentItems.length - 1]!.index : -1;

    return {
        spaceId: taskItem.spaceId,
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments: commentItems,
    };
}
