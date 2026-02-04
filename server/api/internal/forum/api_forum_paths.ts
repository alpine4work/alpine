import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {createIntoApiPostCommentContentPayloadParent} from "~/server/api/internal/forum/internal/create_into_api_post_comment_content_payload_parent.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {
    intoApiContentWithReferencesAndReturnReferences,
    intoApiMessageContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {getContentReferencesForServerPrintSingleLineTextSnippet} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelNameAndDescriptionContent} from "~/server/forum/data/get_channel_name_and_description_content.js";
import {getPostContentWithCustomReferencesAndChannelPreview} from "~/server/forum/data/get_post_content_with_custom_references_and_channel_preview.js";
import {
    completePostCommentStream,
    createPostComment,
    getPostCommentPayload,
    getPostCommentPayloadsFromEnd,
    getPostCommentPayloadsFromStart,
    pingPostCommentStream,
    putPostCommentStreamPart,
} from "~/server/forum/data/post_messaging.js";
import {getSearchEntityMentionWithStrongConsistency} from "~/server/search/data/index/search_entity_index.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {createPostSearchEntityTitle} from "~/shared/forum/create_post_search_entity_title.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export const apiForumPaths: Pick<
    ApiPaths,
    keyof ApiPaths & (`/channels/${string}` | `/posts${string}`)
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
                        description: await intoApiMessageContentWithReferences(
                            context,
                            channel.spaceId,
                            channel.description,
                        ),
                    },
                },
            };
        },
    },

    "/channels/{id}/mention": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();
            const searchEntity = await getSearchEntityMentionWithStrongConsistency(
                context,
                spaceId,
                `Channel:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    mention: {
                        target: {
                            type: "Channel",
                            id: pathParameters.id,
                        },
                        title: searchEntity.title,
                    },
                },
            };
        },
    },

    "/posts": {
        post: async (context, {requestBody}) => {
            const channelId = requestBody.channelId;

            const content = assertPostContent(
                fromApiContent(PostContentProsemirrorSchema, requestBody.content),
            );

            const referencesContext = context.dynamo.unexpectStrongReadConsistency();

            const [post, author, {content: contentWithReferences, references}] =
                await runAllPromises([
                    createPost(context, {
                        channelId,
                        createdTimeZone: requestBody.createdTimeZone ?? defaultTimeZone,
                        content,
                        consistency: "Strong",
                    }),
                    getApiAccount(
                        referencesContext,
                        referencesContext.actor.getSpaceId(),
                        referencesContext.actor.getBotAccountId(),
                    ),
                    intoApiContentWithReferencesAndReturnReferences(
                        referencesContext,
                        referencesContext.actor.getSpaceId(),
                        "AssertHasNoFiles",
                        content,
                    ),
                ]);

            return {
                content: {
                    spaceId: post.spaceId,
                    post: {
                        id: post.id,
                        createdTime: serializeDateString(post.createdTime),
                        createdTimeZone: post.createdTimeZone,
                        channel: {
                            id: channelId,
                            name: post.channelName,
                        },
                        author,
                        content: contentWithReferences,
                        contentPreview: createPostSearchEntityTitle(
                            post.channelName,
                            content,
                            getContentReferencesForServerPrintSingleLineTextSnippet(references),
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
                    const [author, {content, references}] = await runAllPromises([
                        getApiAccount(context, spaceId, post.authorId, {
                            consistency: "StrongWithinCache",
                        }),
                        intoApiContentWithReferencesAndReturnReferences(
                            context,
                            spaceId,
                            FilePostAuthorizer.bind({type: "Post", postId: pathParameters.id}),
                            post.content,
                        ),
                    ]);

                    return {
                        author,
                        originalContent: post.content,
                        content,
                        references,
                    };
                },
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    spaceId: post.spaceId,
                    post: {
                        id: pathParameters.id,
                        author: post.content.author,
                        createdTime: serializeDateString(post.createdTime),
                        createdTimeZone: post.createdTimeZone,
                        channel: {
                            id: post.channel.id,
                            name: post.channel.name,
                        },
                        content: post.content.content,
                        contentPreview: createPostSearchEntityTitle(
                            post.channel.name,
                            post.content.originalContent,
                            getContentReferencesForServerPrintSingleLineTextSnippet(
                                post.content.references,
                            ),
                        ),
                    },
                },
            };
        },
    },

    "/posts/{id}/mention": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();
            const searchEntity = await getSearchEntityMentionWithStrongConsistency(
                context,
                spaceId,
                `Post:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    mention: {
                        target: {
                            type: "Post",
                            id: pathParameters.id,
                        },
                        title: searchEntity.title,
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
                    message: await intoApiMessage(
                        context,
                        message.spaceId,
                        message,
                        createIntoApiPostCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                        ),
                    ),
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
                        comments.map(message =>
                            intoApiMessage(
                                context,
                                spaceId,
                                message,
                                createIntoApiPostCommentContentPayloadParent(
                                    context,
                                    spaceId,
                                    pathParameters.id,
                                ),
                            ),
                        ),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const parent = fromApiMessageContentPayloadParent(requestBody.parent);

            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const createdTimeZone = requestBody.createdTimeZone ?? defaultTimeZone;

            const {spaceId, index, createdTime} = await createPostComment(context, {
                postId: pathParameters.id,
                parent,
                content,
                createdTimeZone,
                fileIds: [],
                isStream: requestBody.isStream,
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parent,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
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
                            createdTimeZone,
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: []}
                                : null,
                        }),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(
                        context,
                        spaceId,
                        {
                            index,
                            version: 0,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            createdTimeZone,
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: [], lastPingTime: null}
                                : null,
                        },
                        createIntoApiPostCommentContentPayloadParent(
                            context,
                            spaceId,
                            pathParameters.id,
                        ),
                    ),
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

            return {
                content: {
                    spaceId,
                    completion: {completedTime: serializeDateString(completedTime)},
                },
            };
        },
    },

    "/posts/{id}/messages/{index}/stream/ping": {
        put: async (context, {pathParameters}) => {
            const {spaceId, lastPingTime} = await pingPostCommentStream(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    ping: {
                        lastUpdatedTime: serializeDateString(lastPingTime),
                    },
                },
            };
        },
    },

    "/posts/{id}/messages/{index}/stream/parts": {
        post: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putPostCommentStreamPart(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex: "Create",
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },

    "/posts/{id}/messages/{index}/stream/parts/{partIndex}": {
        put: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putPostCommentStreamPart(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex: pathParameters.partIndex,
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },
};
