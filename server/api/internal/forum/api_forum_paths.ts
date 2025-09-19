import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {intoApiMessagePayloadWithReferences} from "~/server/api/internal/shared/into_api_message_payload_with_references.js";
import {createPostComment, getPostCommentPayload} from "~/server/forum/data/forum_actions.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_model.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";

export const apiForumPaths: Pick<ApiPaths, keyof ApiPaths & `/posts/${string}`> = {
    "/posts/{id}/messages/{index}": {
        get: async (context, {pathParams}) => {
            const {spaceId, createdTime, payload} = await getPostCommentPayload(context, {
                postId: pathParams.id,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    message: {
                        index: pathParams.index,
                        createdTime: serializeDateString(createdTime),
                        payload: await intoApiMessagePayloadWithReferences(
                            context,
                            spaceId,
                            payload,
                        ),
                    },
                },
            };
        },
    },

    "/posts/{id}/messages": {
        post: async (context, {pathParams, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const {spaceId, index, createdTime} = await createPostComment(context, {
                postId: pathParams.id,
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
                    `/api/durable-objects/posts/${pathParams.id}/broadcast-new-message`,
                    {
                        serviceName: "PostRealtimeService",
                        route: "/api/durable-objects/posts/:postId/broadcast-new-message",
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
                    spaceId,
                    message: {
                        index,
                        createdTime: serializeDateString(createdTime),
                        payload: await intoApiMessagePayloadWithReferences(
                            context,
                            spaceId,
                            payload,
                        ),
                    },
                },
            };
        },
    },
};
