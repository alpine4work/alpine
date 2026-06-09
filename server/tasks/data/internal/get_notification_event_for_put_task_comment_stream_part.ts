import {getMentionedAccountIdsInContent} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {MessageStreamAttributes} from "~/server/messaging/helpers/message_stream_schema.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

export async function getNotificationEventForPutTaskCommentStreamPart(
    context: DynamoContext,
    {
        spaceId,
        taskId,
        commentIndex,
        item,
        payload,
        partIndex,
        isTimeoutErrorCompletion,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        commentIndex: number;
        item: MessageStreamAttributes;
        payload: MessageStreamPartPayload;
        partIndex: number;
        isTimeoutErrorCompletion: boolean;
    },
): Promise<NotificationEvent | null> {
    if (!item.pendingNotificationEvent) return null;

    let content: MessageContent;

    // Always send a notification event for timeout error completions if we haven't
    // sent one already.
    if (isTimeoutErrorCompletion) {
        content = payload.type === "Content" ? payload.content : createSimpleMessageContent();
    } else if (partIndex === 0) {
        return null;
    } else {
        // If we're creating a new part then read the previous part we're finishing. If the
        // previous part is a content part then send a notification using the content from
        // that part.

        const previousPartItem = await TaskTable.getItem(
            context,
            {
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex: partIndex - 1,
            },
            // Part's will be added in rapid succession. Make sure we there's no eventual
            // consistency lag.
            {consistency: "Strong"},
        );

        if (previousPartItem.payload.type !== "Content") return null;

        content = previousPartItem.payload.content;
    }

    const contentSnippet = getNotificationMessageContentSnippet(content);

    return {
        type: "CreateTaskComment",
        id: generateChronologicalId(),
        spaceId,
        taskId,
        commentIndex,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        authorId: item.authorId,
        mentionedAccountIds: getMentionedAccountIdsInContent(content),
        parent: item.pendingNotificationEvent.parent,
        isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
        contentSnippet,
    };
}
