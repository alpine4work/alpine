import {getMentionedAccountIdsInContent} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createCantCompleteStaleMessageStreamError} from "~/server/messaging/helpers/create_message_stream_errors.js";
import {hasMessageStreamDefinitelyTimedOut} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";

export function completeTaskCommentStream(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        consistency,
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    completedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),

            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "Comments#Stream",
                    taskId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        // Already completed!
        if (item.completedTime !== null) {
            return {spaceId, completedTime: item.completedTime};
        }

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantCompleteStaleMessageStreamError();
        }

        let notificationEvent: NotificationEvent | null = null;

        // If we haven't sent a notification event for this message stream yet then send
        // one now!
        if (item.pendingNotificationEvent) {
            const previousPartItem =
                item.partCount > 0
                    ? await TaskTable.getItem(
                          context,
                          {
                              partitionType: "Task",
                              sortRangeType: "Comments#StreamPart",
                              taskId,
                              commentIndex,
                              partIndex: item.partCount - 1,
                          },
                          // Part's will be added in rapid succession. Make sure we there's no eventual
                          // consistency lag.
                          {consistency: "Strong"},
                      )
                    : null;

            const content =
                previousPartItem?.payload.type === "Content"
                    ? previousPartItem.payload.content
                    : createSimpleMessageContent();
            const contentSnippet = getNotificationMessageContentSnippet(content);

            notificationEvent = {
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

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const completedTime = new Date(Date.now());

        await TaskTable.directlyUpdateItem(context, {
            ...item,
            completedTime,
            pendingNotificationEvent: notificationEvent ? null : item.pendingNotificationEvent,
        });

        if (notificationEvent) {
            context.jobs.send({
                type: "NotificationEvent",
                event: notificationEvent,
            });
        }

        // NOTE(calebmer): If the process dies after committing to DynamoDB but before
        // sending this realtime event the user might not see an update to their message in
        // realtime.
        //
        // Should we send this broadcast event in a DynamoDB Streams listener that reacts
        // to the update? We plan to move `NotificationEvent`, `IndexSearchEntity`, and
        // other processing that needs to reliably run after an updates to DynamoDB
        // Streams.
        context.process.waitUntil(
            context.edge.broadcastToDurableObject(
                `/api/durable-objects/task-notes/${taskId}/broadcast-complete-message-stream`,
                {
                    serviceName: "TaskNotesCollaborationService",
                    route: "/api/durable-objects/task-notes/:taskId/broadcast-complete-message-stream",
                    body: MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.serialize({
                        index: commentIndex,
                        completedTime,
                    }),
                },
            ),
        );

        return {spaceId, completedTime};
    });
}
