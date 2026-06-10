import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {getTaskCommentItemIfExists} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {createTaskCommentNotFoundError} from "~/shared/tasks/task_error_messages.js";

export async function getTaskCommentPayload(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        consistency = "Eventual",
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<MessageItem & {spaceId: SpaceId}> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),
        getTaskCommentItemIfExists(context, taskId, commentIndex, {consistency}),
    ]);

    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);

    return {spaceId, ...item};
}
