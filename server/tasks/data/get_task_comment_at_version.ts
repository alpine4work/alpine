import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {
    createTaskCommentModelFromItem,
    getTaskCommentItemIfExists,
} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createTaskCommentNotFoundError} from "~/shared/tasks/task_error_messages.js";

export async function getTaskCommentAtVersion(
    context: ServerActionContext,
    {taskId, commentIndex, version}: {taskId: TaskId; commentIndex: number; version: number},
): Promise<TaskCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "View"),
        (async () => {
            let item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                consistency: "Eventual",
            });

            if (!item || item.version < version) {
                item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                    consistency: "Strong",
                });
            }

            if (!item) {
                throw createTaskCommentNotFoundError(taskId, commentIndex);
            }

            if (item.version < version) {
                throw new FailedPreconditionError("Can\u2019t get message at a future version");
            }

            return item;
        })(),
    ]);

    return await createTaskCommentModelFromItem(context, spaceId, taskId, item);
}
