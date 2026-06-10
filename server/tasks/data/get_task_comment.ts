import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {
    createTaskCommentModelFromItem,
    getTaskCommentItemIfExists,
} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createTaskCommentNotFoundError} from "~/shared/tasks/task_error_messages.js";

export async function getTaskComment(
    context: ServerActionContext,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<TaskCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "Comment"),
        getTaskCommentItemIfExists(context, taskId, commentIndex),
    ]);

    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);

    return await createTaskCommentModelFromItem(context, spaceId, taskId, item);
}
