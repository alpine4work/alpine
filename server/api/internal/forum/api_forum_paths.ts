import {createIntoApiPostCommentContentPayloadParent} from "~/server/api/internal/forum/internal/create_into_api_post_comment_content_payload_parent.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {
    getApiMentionTitleWithStrongConsistency,
    intoApiContentWithReferencesAndReturnReferences,
    intoApiMessageContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {parseFileIdFromApiFileElement} from "~/server/api/internal/shared/parse_file_id_or_file_entity_id.js";
import {getContentReferencesForServerPrintSingleLineTextSnippet} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelNameAndDescriptionContent} from "~/server/forum/data/get_channel_name_and_description_content.js";
import {getChannelPostContents} from "~/server/forum/data/get_channel_posts.js";
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
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
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
import {deserializeDateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId, isId} from "~/shared/id/id.js";
import {FileId, PostId} from "~/shared/id/types/id_types.js";
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
                        description: await intoApiMessageContentWithReferences(context, {
                            spaceId: channel.spaceId,
                            node: channel.description,
                            encoder: new ApiContentKeyEncoder({
                                entityId: `Channel:${pathParameters.id}`,
                                // We don't track channel versions like we do for messages/posts
                                version: 0,
                            }),
                        }),
                    },
                },
            };
        },
    },

    "/channels/{id}/posts": {
        get: async (context, {pathParameters, queryParameters}) => {
            const postsResult = await getChannelPostContents(context, {
                consistency: "StrongWithinCache",
                channelId: pathParameters.id,
                limit: queryParameters.limit ?? 10,
                beforeCreatedTime:
                    queryParameters.cursor !== undefined
                        ? deserializeDateString(queryParameters.cursor)
                        : null,
            });

            const lastPost = postsResult.posts[postsResult.posts.length - 1];

            const nextCursor =
                postsResult.hasNextPage && lastPost
                    ? serializeDateString(lastPost.createdTime)
                    : null;

            return {
                content: {
                    spaceId: postsResult.spaceId,
                    channel: {
                        name: postsResult.channelName,
                    },
                    nextCursor,
                    posts: await runAllPromises(
                        postsResult.posts.map(async post => ({
                            id: post.postId,
                            author: await getApiAccount(
                                context,
                                postsResult.spaceId,
                                post.authorId,
                                {consistency: "StrongWithinCache"},
                            ),
                            createdTime: serializeDateString(post.createdTime),
                            createdTimeZone: post.createdTimeZone,
                            channel: {
                                id: pathParameters.id,
                                name: postsResult.channelName,
                            },
                        })),
                    ),
                },
            };
        },
    },

    "/channels/{id}/reference": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title} = await getApiMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `Channel:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    reference: {
                        type: "Channel",
                        id: pathParameters.id,
                        title,
                    },
                },
            };
        },
    },

    "/posts": {
        post: async (context, {requestBody}) => {
            const channelId = requestBody.channelId;
            const postId = generateId<PostId>();

            const content = assertPostContent(
                fromApiContent(PostContentProsemirrorSchema, requestBody.content),
            );

            // Attach files referenced in the content to the post before creating the post so
            // there's no race where a reader sees the post before its files are attached.
            const fileIds = extractFileIdsFromApiContent(requestBody.content);
            fileIds.delete(unknownFileId);
            if (fileIds.size > 0) {
                await runAllPromises(
                    [...fileIds].map(fileId =>
                        attachFileToTargetAsBot(
                            context,
                            fileId,
                            FilePostAuthorizer.bind({type: "Post", postId}),
                        ),
                    ),
                );
            }

            const referencesContext = context.dynamo.unexpectStrongReadConsistency();
            const [post, author] = await runAllPromises([
                createPost(context, {
                    id: postId,
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
            ]);

            // Resolve content references after creating the post so the file authorizer can
            // find the post attachment target.
            const {content: contentWithReferences, references} =
                await intoApiContentWithReferencesAndReturnReferences(
                    referencesContext,
                    referencesContext.actor.getSpaceId(),
                    FilePostAuthorizer.bind({type: "Post", postId}),
                    content,
                    {
                        encoder: new ApiContentKeyEncoder({
                            entityId: `Post:${postId}`,
                            version: 0,
                        }),
                    },
                );

            return {
                content: {
                    spaceId: post.spaceId,
                    post: {
                        id: post.id,
                        author,
                        createdTime: serializeDateString(post.createdTime),
                        createdTimeZone: post.createdTimeZone,
                        channel: {
                            id: channelId,
                            name: post.channelName,
                        },
                        content: contentWithReferences,
                        reference: {
                            title: createPostSearchEntityTitle(
                                post.channelName,
                                content,
                                getContentReferencesForServerPrintSingleLineTextSnippet(references),
                            ),
                        },
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
                            {
                                encoder: new ApiContentKeyEncoder({
                                    entityId: `Post:${pathParameters.id}`,
                                    version: post.contentVersion,
                                }),
                            },
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
                        reference: {
                            title: createPostSearchEntityTitle(
                                post.channel.name,
                                post.content.originalContent,
                                getContentReferencesForServerPrintSingleLineTextSnippet(
                                    post.content.references,
                                ),
                            ),
                        },
                    },
                },
            };
        },
    },

    "/posts/{id}/reference": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title} = await getApiMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `Post:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    reference: {
                        type: "Post",
                        id: pathParameters.id,
                        title,
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
                    message: await intoApiMessage(context, {
                        spaceId: message.spaceId,
                        message,
                        intoContentPayloadParent: createIntoApiPostCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                        ),
                        entityId: `PostComment:${pathParameters.id}-${pathParameters.index}`,
                    }),
                },
            };
        },
    },

    "/posts/{id}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, commentCount, comments} =
                queryParameters.from === "End"
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
                if (queryParameters.from === "End") {
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
                            intoApiMessage(context, {
                                spaceId,
                                message,
                                intoContentPayloadParent:
                                    createIntoApiPostCommentContentPayloadParent(
                                        context,
                                        spaceId,
                                        pathParameters.id,
                                    ),
                                entityId: `PostComment:${pathParameters.id}-${message.index}`,
                            }),
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
            const fileIds = (requestBody.files ?? []).map(parseFileIdFromApiFileElement);
            const attachmentFileIds = fileIds.filter((id): id is FileId => isId(id));

            // Attach files before creating the message, matching the app client flow. The
            // service function validates attachments exist.
            await runAllPromises(
                attachmentFileIds.map(fileId =>
                    attachFileToTargetAsBot(
                        context,
                        fileId,
                        FilePostAuthorizer.bind({
                            type: "PostComments",
                            postId: pathParameters.id,
                        }),
                    ),
                ),
            );

            const {spaceId, index, createdTime} = await createPostComment(context, {
                postId: pathParameters.id,
                parent,
                content,
                createdTimeZone,
                fileIds,
                isStream: requestBody.isStream,
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parent,
                content,
                contentUpdate: null,
                fileIds,
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            };

            // If this broadcast fails (or it's never sent, say if the process dies) then users
            // connected to this messaging room won't see this message appear in realtime. The
            // realtime connection will be "stuck". Any future messages will be placed in a
            // queue (since the connection is waiting on a previous message) and will never be
            // flushed to the client.
            //
            // To get out of this state, the user can reload the page. Or navigate to another
            // page then navigate back. We hope this won't be too big of an issue since the
            // user should still receive a realtime inbox update telling them they have a new
            // message.
            //
            // NOTE(calebmer): The best fix for this is probably to send the broadcast event in
            // a DynamoDB Streams listener that reacts to the update. We plan to move
            // `NotificationEvent`, `IndexSearchEntity`, and other processing that needs to
            // reliably run after an updates to DynamoDB Stream.
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
                    message: await intoApiMessage(context, {
                        spaceId,
                        message: {
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
                        intoContentPayloadParent: createIntoApiPostCommentContentPayloadParent(
                            context,
                            spaceId,
                            pathParameters.id,
                        ),
                        entityId: `PostComment:${pathParameters.id}-${index}`,
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
