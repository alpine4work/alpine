import {createIntoApiPostCommentContentPayloadParent} from "~/server/api/internal/forum/internal/create_into_api_post_comment_content_payload_parent.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {getFileIdOrFileEntityIdFromApiMessageContentPayloadFile} from "~/server/api/internal/shared/get_file_id_or_file_entity_id_from_api_message_content_payload_file.js";
import {
    getApiMentionTitleWithStrongConsistency,
    intoApiContentWithReferencesAndReturnReferences,
    intoApiMessageContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {intoApiMessageExperimentalApproval} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {getContentReferencesForServerPrintSingleLineTextSnippet} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelNameAndDescriptionContent} from "~/server/forum/data/get_channel_name_and_description_content.js";
import {getChannelPostContents} from "~/server/forum/data/get_channel_posts.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {getPostContentWithCustomReferencesAndChannelPreview} from "~/server/forum/data/get_post_content_with_custom_references_and_channel_preview.js";
import {
    broadcastPutPostCommentStreamPart,
    completePostCommentStream,
    createPostComment,
    getPostCommentMessageApprovals,
    getPostCommentPayload,
    getPostCommentPayloadsFromEnd,
    getPostCommentPayloadsFromStart,
    pingPostCommentStream,
    putPostCommentMessageApprovalDecisions,
    putPostCommentStreamPart,
} from "~/server/forum/data/post_messaging.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/closed_source/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {ApiChannelPreview} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {createPostSearchEntityTitle} from "~/shared/forum/create_post_search_entity_title.js";
import {getPostContentSnippet} from "~/shared/forum/get_post_content_snippet.js";
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
                            content: channel.description,
                            contentKeyEncoder: new ApiContentKeyEncoder({
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

            const channel: ApiChannelPreview = {
                id: pathParameters.id,
                name: postsResult.channelName,
            };

            const referencesContext = context.dynamo.unexpectStrongReadConsistency();

            const posts = await runAllPromises(
                postsResult.posts.map(async post => {
                    const [author, {content: contentSnippet, references}] = await runAllPromises([
                        getApiAccount(referencesContext, postsResult.spaceId, post.authorId),
                        intoApiContentWithReferencesAndReturnReferences(referencesContext, {
                            spaceId: postsResult.spaceId,
                            fileAuthorizer: FilePostAuthorizer.bind({
                                type: "Post",
                                postId: post.postId,
                            }),
                            // NOCOMMIT: Test that we snip correctly
                            content: getPostContentSnippet(post.content, {
                                platform: "desktop",
                                routeLayout: "wide",
                            }),
                            // As a content snippet, keys won't line up properly with the source content so
                            // don't generate keys.
                            contentKeyEncoder: null,
                        }),
                    ]);

                    return {
                        id: post.postId,
                        author,
                        createdTime: serializeDateString(post.createdTime),
                        createdTimeZone: post.createdTimeZone,
                        channel,
                        contentSnippet,
                        reference: {
                            // NOCOMMIT: Title should include account name?
                            title: createPostSearchEntityTitle(
                                postsResult.channelName,
                                post.content,
                                getContentReferencesForServerPrintSingleLineTextSnippet(references),
                            ),
                        },
                    };
                }),
            );

            return {
                content: {
                    spaceId: postsResult.spaceId,
                    channel,
                    nextCursor,
                    posts,
                },
            };
        },
    },

    "/channels/{id}-reference": {
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

    "/channels/{id}-preview": {
        get: async (context, {pathParameters}) => {
            const channel = await getChannelPreview(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId: channel.spaceId,
                    channel: {
                        id: channel.id,
                        name: channel.name,
                    },
                },
            };
        },
    },

    "/posts": {
        post: async (context, {requestBody}) => {
            const channelId = requestBody.post.channel.id;
            const postId = generateId<PostId>();

            const content = assertPostContent(
                fromApiContent(PostContentProsemirrorSchema, requestBody.post.content),
            );

            // Attach files referenced in the content to the post before creating the post so
            // there's no race where a reader sees the post before its files are attached.
            const fileIds = extractFileIdsFromApiContent(requestBody.post.content);
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
                    createdTimeZone: requestBody.post.createdTimeZone ?? defaultTimeZone,
                    content,
                    consistency: "StrongWithinCache",
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
                await intoApiContentWithReferencesAndReturnReferences(referencesContext, {
                    spaceId: referencesContext.actor.getSpaceId(),
                    fileAuthorizer: FilePostAuthorizer.bind({type: "Post", postId}),
                    content,
                    contentKeyEncoder: new ApiContentKeyEncoder({
                        entityId: `Post:${postId}`,
                        version: 0,
                    }),
                });

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
                            // NOCOMMIT: Title should include account name?
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
            const referencesContext = context.dynamo.unexpectStrongReadConsistency();

            const post = await getPostContentWithCustomReferencesAndChannelPreview(
                context,
                pathParameters.id,
                async (context, spaceId, post) => {
                    const [author, {content, references}] = await runAllPromises([
                        getApiAccount(referencesContext, spaceId, post.authorId),
                        intoApiContentWithReferencesAndReturnReferences(referencesContext, {
                            spaceId,
                            fileAuthorizer: FilePostAuthorizer.bind({
                                type: "Post",
                                postId: pathParameters.id,
                            }),
                            content: post.content,
                            contentKeyEncoder: new ApiContentKeyEncoder({
                                entityId: `Post:${pathParameters.id}`,
                                version: post.contentVersion,
                            }),
                        }),
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
                            // NOCOMMIT: Title should include account name?
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

    // NOCOMMIT: Test!
    "/posts/{id}-preview": {
        get: async (context, {pathParameters}) => {
            const referencesContext = context.dynamo.unexpectStrongReadConsistency();

            const post = await getPostContentWithCustomReferencesAndChannelPreview(
                context,
                pathParameters.id,
                async (context, spaceId, post) => {
                    const [author, {content: contentSnippet, references}] = await runAllPromises([
                        getApiAccount(referencesContext, spaceId, post.authorId),
                        intoApiContentWithReferencesAndReturnReferences(referencesContext, {
                            spaceId,
                            fileAuthorizer: FilePostAuthorizer.bind({
                                type: "Post",
                                postId: pathParameters.id,
                            }),
                            // NOCOMMIT: Test that we snip correctly
                            content: getPostContentSnippet(post.content, {
                                platform: "desktop",
                                routeLayout: "wide",
                            }),
                            contentKeyEncoder: new ApiContentKeyEncoder({
                                entityId: `Post:${pathParameters.id}`,
                                version: post.contentVersion,
                            }),
                        }),
                    ]);

                    return {
                        author,
                        originalContent: post.content,
                        contentSnippet,
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
                        contentSnippet: post.content.contentSnippet,
                        reference: {
                            // NOCOMMIT: Title should include account name?
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

    "/posts/{id}-reference": {
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
                        entityId: `PostComment:${pathParameters.id}-${pathParameters.index}`,
                        fileAuthorizer: FilePostAuthorizer.bind({
                            type: "PostComments",
                            postId: pathParameters.id,
                        }),
                        message,
                        intoContentPayloadParent: createIntoApiPostCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                        ),
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
                                entityId: `PostComment:${pathParameters.id}-${message.index}`,
                                fileAuthorizer: FilePostAuthorizer.bind({
                                    type: "PostComments",
                                    postId: pathParameters.id,
                                }),
                                message,
                                intoContentPayloadParent:
                                    createIntoApiPostCommentContentPayloadParent(
                                        context,
                                        spaceId,
                                        pathParameters.id,
                                    ),
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
            const fileIds = (requestBody.files ?? []).map(
                getFileIdOrFileEntityIdFromApiMessageContentPayloadFile,
            );
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
                        entityId: `PostComment:${pathParameters.id}-${index}`,
                        fileAuthorizer: FilePostAuthorizer.bind({
                            type: "PostComments",
                            postId: pathParameters.id,
                        }),
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

    "/posts/{id}/messages/{index}/experimental-approvals": {
        get: async (context, {pathParameters}) => {
            const {spaceId, approvals} = await getPostCommentMessageApprovals(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            const referenceContext = context.dynamo.unexpectStrongReadConsistency();
            return {
                content: {
                    spaceId,
                    approvals: await runAllPromises(
                        approvals.map(approval =>
                            intoApiMessageExperimentalApproval(referenceContext, {
                                spaceId,
                                approval,
                            }),
                        ),
                    ),
                },
            };
        },
        patch: async (context, {pathParameters, requestBody}) => {
            const {spaceId, approvals, partIndex, version, createdTime, completedTime} =
                await putPostCommentMessageApprovalDecisions(context, {
                    postId: pathParameters.id,
                    commentIndex: pathParameters.index,
                    payload: {
                        type: "ExperimentalDecisions",
                        decisions: requestBody.patches.map(patch => ({
                            index: patch.index,
                            value: patch.decision.value,
                        })),
                    },
                    consistency: "StrongWithinCache",
                });

            broadcastPutPostCommentStreamPart(context, {
                postId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex,
                version,
                payload: {type: "ExperimentalApprovals", approvals},
                createdTime,
                completedTime,
            });

            const referenceContext = context.dynamo.unexpectStrongReadConsistency();
            return {
                content: {
                    spaceId,
                    approvals: await runAllPromises(
                        approvals.map(approval =>
                            intoApiMessageExperimentalApproval(referenceContext, {
                                spaceId,
                                approval,
                            }),
                        ),
                    ),
                },
            };
        },
    },
};
