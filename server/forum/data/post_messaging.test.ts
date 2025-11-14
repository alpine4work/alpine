import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {getPost} from "~/server/forum/data/get_post.js";
import {
    backfillPostComments,
    completePostCommentStream,
    createPostComment,
    deletePostComment,
    deletePostCommentReaction,
    getPostComment,
    getPostCommentPayload,
    getPostCommentPayloadsFromEnd,
    getPostCommentPayloadsFromStart,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    putPostCommentStreamPart,
    setPostCommentReaction,
    updatePostCommentContent,
} from "~/server/forum/data/post_messaging.js";
import {updateChannelAccessPolicy} from "~/server/forum/data/update_channel_access_policy.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {AccessPolicy, AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    forumInjection,
});

testMessagingImplementation<PostId>(context, {
    async createRoom(context, spaceId) {
        const channel = await createChannel(context, {
            spaceId,
            name: "Test",
        });

        const post = await createPost(context, {
            channelId: channel.id,
            content: createSimplePostContent("test"),
        });

        return {
            key: post.id,
            spaceId,
            createdTime: post.createdTime,
            messageCount: 0,
        };
    },

    async createPrivateRoom(context, spaceId, {insideSessions, insideViewerSession}) {
        const channel = await createChannel(context, {
            spaceId,
            name: "Test",
        });

        let count = 0;

        await updateChannelAccessPolicy(context, {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    ...insideSessions.map(
                        (insideSession): [AccountId, AccessPolicyAccountGrant] => [
                            insideSession.accountId,
                            insideSession.accountId === context.actor.getAccountId()
                                ? {level: "Manage", generation: 0}
                                : {level: (["Comment", "Edit"] as const)[count++ % 2]!},
                        ],
                    ),
                    ...(insideViewerSession
                        ? [[insideViewerSession.accountId, {level: "View"}] as const]
                        : []),
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            notification: null,
        });

        const post = await createPost(context, {
            channelId: channel.id,
            content: createSimplePostContent("test"),
        });

        return {
            key: post.id,
            spaceId,
            createdTime: post.createdTime,
            messageCount: 0,
            doesInsideViewerSessionHaveRoomAccess: true,
            revokeInsideSession: async (context, session) => {
                const {accessPolicy} = await getChannelPreview(context, channel.id);

                const newAccessPolicy: AccessPolicy = {
                    ...accessPolicy,
                    accountGrantById: new Map(
                        filterIterable(
                            accessPolicy.accountGrantById,
                            ([accountId]) => accountId !== session.account.id,
                        ),
                    ),
                };

                await updateChannelAccessPolicy(context, {
                    channelId: channel.id,
                    accessPolicy: newAccessPolicy,
                    notification: null,
                });
            },
        };
    },

    async getRoom(context, postId) {
        const {model: post} = await getPost(context, postId);
        return {
            key: post.id,
            spaceId: post.spaceId,
            createdTime: post.createdTime,
            messageCount: post.commentCount,
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    getRoomFileAuthorizer(postId) {
        return FilePostAuthorizer.bind({type: "PostComments", postId});
    },
    getRoomBotScope(postId) {
        return {type: "Post", postId};
    },
    async createMessage(
        context,
        {roomKey: postId, parent, content, fileIds, isStream, createdTimeZone},
    ) {
        const comment = await createPostComment(context, {
            postId,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async putMessageStreamPart(
        context,
        {roomKey: postId, messageIndex: commentIndex, partIndex, payload},
    ) {
        return await putPostCommentStreamPart(context, {
            postId,
            commentIndex,
            partIndex,
            payload,
        });
    },
    async completeMessageStream(context, {roomKey: postId, messageIndex: commentIndex}) {
        return completePostCommentStream(context, {
            postId,
            commentIndex,
        });
    },
    async getMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return getPostComment(context, {postId, commentIndex});
    },
    async getMessagePayload(context, {roomKey: postId, messageIndex: commentIndex}) {
        return await getPostCommentPayload(context, {postId, commentIndex});
    },
    async updateMessageContent(
        context,
        {roomKey: postId, messageIndex: commentIndex, contentVersion, steps},
    ) {
        return updatePostCommentContent(context, {
            postId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return deletePostComment(context, {postId, commentIndex});
    },
    async setMessageReaction(
        context,
        {roomKey: postId, messageIndex: commentIndex, contentVersion, pos, reaction},
    ) {
        return setPostCommentReaction(context, {
            postId,
            commentIndex,
            contentVersion,
            pos,
            reaction,
        });
    },
    async deleteMessageReaction(
        context,
        {roomKey: postId, messageIndex: commentIndex, contentVersion, pos},
    ) {
        return deletePostCommentReaction(context, {
            postId,
            commentIndex,
            contentVersion,
            pos,
        });
    },
    async getMessagesFromStart(
        context,
        {
            roomKey: postId,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const {commentCount, comments, otherReferencedComments} = await getPostCommentsFromStart(
            context,
            {
                postId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            },
        );
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
        };
    },
    async getMessagesFromEnd(
        context,
        {
            roomKey: postId,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const {commentCount, comments, otherReferencedComments} = await getPostCommentsFromEnd(
            context,
            {
                postId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            },
        );
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
        };
    },
    async getMessagePayloadsFromStart(
        context,
        {roomKey: postId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const {commentCount, comments} = await getPostCommentPayloadsFromStart(context, {
            postId,
            limit,
            afterCommentIndex: afterMessageIndex,
            beforeCommentIndex: beforeMessageIndex,
        });
        return {messageCount: commentCount, messages: comments};
    },
    async getMessagePayloadsFromEnd(
        context,
        {roomKey: postId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const {commentCount, comments} = await getPostCommentPayloadsFromEnd(context, {
            postId,
            limit,
            afterCommentIndex: afterMessageIndex,
            beforeCommentIndex: beforeMessageIndex,
        });
        return {messageCount: commentCount, messages: comments};
    },
    async backfillMessages(
        context,
        {
            roomKey: postId,
            checkpoint,
            clientMessageCount: clientCommentCount,
            newMessageLimit: newCommentLimit,
        },
    ) {
        const {commentCount, newComments, newOtherReferencedComments, commentUpdatesResult} =
            await backfillPostComments(context, {
                postId,
                checkpoint,
                clientCommentCount,
                newCommentLimit,
            });
        return {
            messageCount: commentCount,
            newMessages: newComments,
            newOtherReferencedMessages: newOtherReferencedComments,
            messageUpdatesResult: commentUpdatesResult,
        };
    },
});
