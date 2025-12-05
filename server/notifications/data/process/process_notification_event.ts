import {PushContextModules} from "~/server/context/push_context_modules.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {processNotificationCreateChatMessageEvent} from "~/server/notifications/data/process/internal/process_notification_create_chat_message_event.js";
import {processNotificationCreateDocumentCommentEvent} from "~/server/notifications/data/process/internal/process_notification_create_document_comment_event.js";
import {processNotificationCreatePostCommentEvent} from "~/server/notifications/data/process/internal/process_notification_create_post_comment_event.js";
import {processNotificationCreatePostEvent} from "~/server/notifications/data/process/internal/process_notification_create_post_event.js";
import {processNotificationCreateTaskCommentEvent} from "~/server/notifications/data/process/internal/process_notification_create_task_comment_event.js";
import {Context} from "~/shared/context/context.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const notificationEventProcessingTestCounter = new TestCounter<AccountId>();
export const notificationEventBeforeProcessingTestCheckpoint = new TestCheckpoint<AccountId>();
export const notificationEventAfterProcessingTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Processes a notification generating event by fanning out to subscriber
 * inboxes and notification destinations (like email or mobile push
 * notifications).
 *
 * This function is idempotent.
 */
export async function processNotificationEvent(
    context: Context<ServerSystemActionContextModules & PushContextModules>,
    event: NotificationEvent,
    span: TracerSpan,
): Promise<void> {
    notificationEventProcessingTestCounter.incrementForTest(event.authorId);
    await notificationEventBeforeProcessingTestCheckpoint.waitForTest(event.authorId);
    try {
        await actuallyProcessNotificationEvent(context, event, span);
    } finally {
        await notificationEventAfterProcessingTestCheckpoint.waitForTest(event.authorId);
    }
}

function actuallyProcessNotificationEvent(
    context: Context<ServerSystemActionContextModules & PushContextModules>,
    event: NotificationEvent,
    span: TracerSpan,
): Promise<void> {
    switch (event.type) {
        case "CreateChatMessage":
            return processNotificationCreateChatMessageEvent(context, event, span);
        case "CreatePostComment":
            return processNotificationCreatePostCommentEvent(context, event, span);
        case "CreatePost":
            return processNotificationCreatePostEvent(context, event, span);
        case "CreateDocumentComment":
            return processNotificationCreateDocumentCommentEvent(context, event, span);
        case "CreateTaskComment":
            return processNotificationCreateTaskCommentEvent(context, event, span);
        default:
            throw exhaustive(event);
    }
}
