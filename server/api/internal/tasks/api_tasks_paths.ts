import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {intoApiMessagePayload} from "~/server/api/internal/shared/into_api_message_payload.js";
import {createTaskComment, getTaskCommentPayload} from "~/server/tasks/data/task_table.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_model.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";

export const apiTasksPaths: Pick<ApiPaths, keyof ApiPaths & `/tasks/${string}`> = {
    "/tasks/{id}/messages/{index}": {
        get: async (context, {pathParams}) => {
            const message = await getTaskCommentPayload(context, {
                taskId: pathParams.id,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/tasks/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },

    "/tasks/{id}/messages": {
        post: async (context, {pathParams, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const {index, createdTime} = await createTaskComment(context, {
                taskId: pathParams.id,
                parentCommentIndex: null,
                content,
                fileIds: [],
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parentMessageIndex: null,
                content,
                contentUpdatedTime: null,
                fileIds: [],
            };

            // If this broadcast fails (or it's never sent, say if the process dies) then
            // users connected to this messaging room won't see this message appear in
            // realtime. The realtime connection will be "stuck". Any future messages will
            // be placed in a queue (since the connection is waiting on a previous message)
            // and will never be flushed to the client.
            //
            // To get out of this state, the user can reload the page. Or navigate to
            // another page then navigate back. We hope this won't be too big of an issue
            // since the user should still receive a realtime inbox update telling them
            // they have a new message.
            //
            // NOTE(calebmer): The best fix for this is probably to send the broadcast
            // event in a DynamoDB Streams listener that reacts to the update. We plan to
            // move `NotificationEvent`, `IndexSearchEntity`, and other processing that
            // needs to reliably run after an updates to DynamoDB Stream.
            context.process.waitUntil(
                context.edge.broadcastToDurableObject(
                    `/api/durable-objects/task-notes/${pathParams.id}/broadcast-new-message`,
                    {
                        serviceName: "TaskNotesCollaborationService",
                        route: "/api/durable-objects/task-notes/:taskId/broadcast-new-message",
                        body: MessagingRealtimeBroadcastNewMessageRequestSchema.serialize({
                            index,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            payload,
                        }),
                    },
                ),
            );

            return {
                content: {
                    roomPath: `/tasks/${pathParams.id}`,
                    index,
                    createdTime: serializeDateString(createdTime),
                    payload: intoApiMessagePayload(payload),
                },
            };
        },
    },
};
