import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createTaskCommentNotFoundError} from "~/shared/tasks/task_error_messages.js";

export const TaskCommentItemContextCache = new DynamoContextCache<
    `${TaskId}:${number}`,
    MessageItem | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getTaskCommentItemIfExists(
    context: ServerActionContext,
    taskId: TaskId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: TaskCommentItemContextCache,
            cacheKeyPrefix: taskId,
            consistency,
            startIndex: commentIndex,
            endIndex: commentIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                TaskTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Task", taskId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    assert(items.length <= 1);

    return items[0] ?? null;
}

export async function getTaskCommentItem(
    context: ServerActionContext,
    taskId: TaskId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem> {
    const item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {consistency});
    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);
    return item;
}

export async function createTaskCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
    item: MessageItem,
): Promise<TaskCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileTaskAuthorizer.bind({type: "TaskComments", taskId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new TaskCommentModel({
        taskId,
        index: item.index,
        version: item.version,
        author,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        payload,
        stream: item.stream,
    });
}
