import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {getChannelNameAndDescriptionContent} from "~/server/forum/data/get_channel_name_and_description_content.js";
import {getPostContentWithCustomReferencesAndChannelPreview} from "~/server/forum/data/get_post_content_with_custom_references_and_channel_preview.js";
import {
    completePostCommentStream,
    createPostComment,
    getPostCommentPayload,
    getPostCommentPayloadsFromEnd,
    getPostCommentPayloadsFromStart,
    putPostCommentStreamPart,
} from "~/server/forum/data/post_messaging.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";

export const apiForumPaths: Pick<
    ApiPaths,
    keyof ApiPaths & (`/channels/${string}` | `/posts/${string}`)
> = {
    "/channels/{id}": {
        get: async (context, {pathParameters}) => {
            const channel = await getChannelNameAndDescriptionContent(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId: channel.spaceId,
                    channel: {
                        id: pathParameters.id,
                        name: channel.name,
                        description: await intoApiContentWithReferences(
                            context,
                            channel.spaceId,
                            channel.description,
                        ),
                    },
                },
            };
        },
    },

    "/posts/{id}": {
        get: async (context, {pathParameters}) => {
            const post = await getPostContentWithCustomReferencesAndChannelPreview(
                context,
                pathParameters.id,
                async (context, spaceId, post) => {
                    const [author, content] = await runAllPromises([
                        getApiAccount(context, spaceId, post.authorId, {
                            consistency: "StrongWithinCache",
                        }),
                        intoApiContentWithReferences(context, spaceId, post.content),
                    ]);
                    return {author, content};
                },
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    spaceId: post.spaceId,
                    post: {
                        id: pathParameters.id,
                        author: post.content.author,
                        channel: {
                            id: post.channel.id,
                            name: post.channel.name,
                        },
                        content: post.content.content,
                    },
                },
            };
        },
    },

    "/posts/{id}/messages/{index}": {
        get: async (context, {pathParameters}) => {
            const message = await getPostCommentPayload(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId: message.spaceId,
                    message: await intoApiMessage(context, message.spaceId, message),
                },
            };
        },
    },

    "/posts/{id}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, commentCount, comments} =
                queryParameters.from === "end"
                    ? await getPostCommentPayloadsFromEnd(context, {
                          postId: pathParameters.id,
                          limit: queryParameters.limit ?? 10,
                          afterCommentIndex: null,
                          beforeCommentIndex: queryParameters.cursor ?? null,
                          consistency: "StrongWithinCache",
                      })
                    : await getPostCommentPayloadsFromStart(context, {
                          postId: pathParameters.id,
                          limit: queryParameters.limit ?? 10,
                          afterCommentIndex: queryParameters.cursor ?? null,
                          beforeCommentIndex: null,
                          consistency: "StrongWithinCache",
                      });

            let nextCursor: number | null;

            if (comments.length === 0) {
                nextCursor = null;
            } else {
                if (queryParameters.from === "end") {
                    const firstComment = comments[0]!;
                    if (firstComment.index > 0) {
                        nextCursor = firstComment.index;
                    } else {
                        nextCursor = null;
                    }
                } else {
                    const lastComment = comments[comments.length - 1]!;
                    if (lastComment.index < commentCount - 1) {
                        nextCursor = lastComment.index;
                    } else {
                        nextCursor = null;
                    }
                }
            }

            return {
                content: {
                    spaceId,
                    totalMessageCount: commentCount,
                    nextCursor,
                    messages: await runAllPromises(
                        comments.map(message => intoApiMessage(context, spaceId, message)),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const {spaceId, index, createdTime} = await createPostComment(context, {
                postId: pathParameters.id,
                parent: null,
                content,
                fileIds: [],
                isStream: requestBody.isStream,
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
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
                    `/api/durable-objects/posts/${pathParameters.id}/broadcast-new-message`,
                    {
                        serviceName: "PostRealtimeService",
                        route: "/api/durable-objects/posts/:postId/broadcast-new-message",
                        body: MessagingRealtimeBroadcastNewMessageRequestSchema.serialize({
                            index,
                            version: 0,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            payload,
                            stream: requestBody.isStream ? {completedTime: null, parts: []} : null,
                        }),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(context, spaceId, {
                        index,
                        version: 0,
                        authorId: context.actor.getBotAccountId(),
                        createdTime,
                        payload,
                        stream: requestBody.isStream ? {completedTime: null, parts: []} : null,
                    }),
                },
            };
        },
    },

    "/posts/{id}/messages/{index}/stream/completion": {
        put: async (context, {pathParameters}) => {
            const {spaceId, completedTime} = await completePostCommentStream(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            // NOTE(calebmer): If the process dies after committing to DynamoDB but before
            // sending this realtime event the user might not see an update to their
            // message in realtime.
            //
            // Should we send this broadcast event in a DynamoDB Streams listener that
            // reacts to the update? We plan to move `NotificationEvent`,
            // `IndexSearchEntity`, and other processing that needs to reliably run after
            // an updates to DynamoDB Streams.
            context.process.waitUntil(
                context.edge.broadcastToDurableObject(
                    `/api/durable-objects/posts/${pathParameters.id}/broadcast-complete-message-stream`,
                    {
                        serviceName: "PostRealtimeService",
                        route: "/api/durable-objects/posts/:postId/broadcast-complete-message-stream",
                        body: MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.serialize(
                            {
                                index: pathParameters.index,
                                completedTime,
                            },
                        ),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    completion: {completedTime: serializeDateString(completedTime)},
                },
            };
        },
    },

    "/posts/{id}/messages/{index}/stream/parts/{partIndex}": {
        put: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId, version} = await putPostCommentStreamPart(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex: pathParameters.partIndex,
                payload,
                consistency: "StrongWithinCache",
            });

            // NOTE(calebmer): If the process dies after committing to DynamoDB but before
            // sending this realtime event the user might not see an update to their
            // message in realtime.
            //
            // Should we send this broadcast event in a DynamoDB Streams listener that
            // reacts to the update? We plan to move `NotificationEvent`,
            // `IndexSearchEntity`, and other processing that needs to reliably run after
            // an updates to DynamoDB Streams.
            context.process.waitUntil(
                context.edge.broadcastToDurableObject(
                    `/api/durable-objects/posts/${pathParameters.id}/broadcast-put-message-stream-part`,
                    {
                        serviceName: "PostRealtimeService",
                        route: "/api/durable-objects/posts/:postId/broadcast-put-message-stream-part",
                        body: MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.serialize(
                            {
                                index: pathParameters.index,
                                partIndex: pathParameters.partIndex,
                                part: {version, payload},
                            },
                        ),
                    },
                ),
            );

            return {content: {spaceId}};
        },
    },
};
