import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createCantWriteToStaleMessageStreamError} from "~/server/messaging/helpers/create_message_stream_errors.js";
import {
    messageStreamIndexSearchEntityDelaySeconds,
    shouldScheduleMessageStreamIndexSearchEntityJob,
} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {hasMessageStreamDefinitelyTimedOut} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {getNotificationEventForPutTaskCommentStreamPart} from "~/server/tasks/data/internal/get_notification_event_for_put_task_comment_stream_part.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {
    FailedPreconditionError,
    InternalError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";

export function putTaskCommentStreamPart(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        partIndex,
        payload,
        consistency,
        isTimeoutErrorCompletion = false,
    }: {
        taskId: TaskId;
        commentIndex: number;
        partIndex: number | "Create";
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
        isTimeoutErrorCompletion?: boolean;
    },
): Promise<{spaceId: SpaceId; createdTime: Date}> {
    if (isTimeoutErrorCompletion && context.actor.type !== "System") {
        throw new PermissionDeniedError(
            "Only system actors can complete a message stream after timeout",
        );
    }

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

        if (item.completedTime !== null) {
            // If the stream is already completed then noop.
            if (isTimeoutErrorCompletion) return {spaceId, createdTime: new Date()};

            throw new FailedPreconditionError("The stream has already been completed", {
                displayMessage: errorDisplayMessage`The stream has already been completed.`,
            });
        }

        if (!isTimeoutErrorCompletion && hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantWriteToStaleMessageStreamError();
        }

        if (partIndex === "Create") {
            partIndex = item.partCount;
        }

        // Use `Date.now()` so tests can mock the `Date.now()` function.
        const currentTime = new Date(Date.now());

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        let version: number;

        let createdTime: Date;
        if (partIndex === item.partCount) {
            const notificationEvent = await getNotificationEventForPutTaskCommentStreamPart(
                context,
                {
                    spaceId,
                    taskId,
                    commentIndex,
                    item,
                    payload,
                    partIndex,
                    isTimeoutErrorCompletion,
                },
            );

            createdTime = currentTime;

            const createPartTransactionEntry = TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                TaskTable.transactionDirectlyUpdateItem({
                    ...item,
                    completedTime: isTimeoutErrorCompletion ? currentTime : null,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastPartCreatedTime: createdTime,
                    lastPingTime,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                    pendingNotificationEvent: notificationEvent
                        ? null
                        : item.pendingNotificationEvent,
                }),
                createPartTransactionEntry,
            ]);

            if (notificationEvent) {
                context.jobs.send({
                    type: "NotificationEvent",
                    event: notificationEvent,
                });
            }
        } else {
            if (isTimeoutErrorCompletion) {
                throw new InternalError(
                    "Must create a new part when setting `isTimeoutErrorCompletion` to true",
                );
            }

            if (partIndex !== item.partCount - 1) {
                throw new FailedPreconditionError(
                    "Only the last part of the stream or the next part can be updated",
                    {
                        displayMessage: errorDisplayMessage`Only the last part of the stream (index ${
                            item.partCount - 1
                        }) or the next part (index ${item.partCount}) can be updated.`,
                    },
                );
            }

            assert(item.lastPartUpdateLockVersion !== null);
            assert(item.lastPartCreatedTime !== null);
            createdTime = item.lastPartCreatedTime;

            const updatePartTransactionEntry = TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                updateLockVersion: item.lastPartUpdateLockVersion + 1,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                TaskTable.transactionDirectlyUpdateItem({
                    ...item,
                    lastPartUpdateLockVersion: item.lastPartUpdateLockVersion + 1,
                    lastPingTime,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                updatePartTransactionEntry,
            ]);
        }

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "TaskComment",
                        taskId,
                        commentIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
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
                `/api/durable-objects/task-notes/${taskId}/broadcast-put-message-stream-part`,
                {
                    serviceName: "TaskNotesCollaborationService",
                    route: "/api/durable-objects/task-notes/:taskId/broadcast-put-message-stream-part",
                    body: MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.serialize({
                        index: commentIndex,
                        partIndex,
                        part: {version, payload, createdTime},
                    }),
                },
            ),
        );

        return {spaceId, createdTime};
    });
}
