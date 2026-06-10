import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {
    TaskCommentItemContextCache,
    getTaskCommentItem,
} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {getTruncatedParentMessagesRangeContentWithoutReferences} from "~/shared/messaging/get_truncated_parent_message_range_content_with_references.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

export async function getTaskCommentParentContent(
    context: ServerActionContext,
    taskId: TaskId,
    {
        parent,
        consistency,
    }: {parent: MessageContentPayloadParent; consistency?: DynamoCacheReadConsistency},
): Promise<{content: MessageContent; authorId: AccountId}> {
    await authorizeTaskAccess(context, taskId, "View", null, {consistency});

    const messageNoun = "comment";

    switch (parent.type) {
        case "Message": {
            const commentItem = await getTaskCommentItem(context, taskId, parent.index, {
                consistency,
            });

            return {
                authorId: commentItem.authorId,
                content:
                    commentItem.payload.type === "Content"
                        ? cutMessageContentPayload({
                              payload: commentItem.payload,
                              stream: commentItem.stream,
                          })
                        : createSimpleMessageContent(`Deleted ${messageNoun}`),
            };
        }
        case "MessagesRange": {
            const messageItems = await arrayFromAsyncIterable(
                runCommentsQuery(context, {
                    cache: TaskCommentItemContextCache,
                    cacheKeyPrefix: taskId,
                    consistency,
                    startIndex: parent.startIndex,
                    endIndex: parent.endIndex,
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

            validateMessageContentPayloadMessagesRangeParent(parent, messageItems, {
                allowDeletedMessagesForStartAndEndMessages: true,
            });

            return {
                // `validateMessageContentPayloadMessagesRangeParent()` guarantees that all
                // messages have the same author and the list is not empty.
                authorId: messageItems[0]!.authorId,
                content: getTruncatedParentMessagesRangeContentWithoutReferences({
                    messages: messageItems,
                    messageNoun,
                    startContentVersion: parent.startContentVersion,
                    startPos: parent.startPos,
                    endContentVersion: parent.endContentVersion,
                    endPos: parent.endPos,
                }),
            };
        }
        case "PostRange": {
            throw new InvalidArgumentError("Post range parent can only be used with post comments");
        }
        default:
            throw exhaustive(parent);
    }
}
