import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getTaskCommentCount} from "~/server/tasks/data/get_task_comment_count.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {getTaskCommentsFromEndAssumingAuthorizedTask} from "~/server/tasks/data/internal/get_task_comments_from_end_assuming_authorized_task.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";

export async function getTaskCommentsFromEnd(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );

    const [{commentsSummaryItem}, {comments, otherReferencedComments}] = await runAllPromises([
        authorizationPromise,
        getTaskCommentsFromEndAssumingAuthorizedTask(context, {
            taskId,
            authorizationPromise,
            limit,
            afterCommentIndex,
            beforeCommentIndex,
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
        comments,
        otherReferencedComments,
    };
}
