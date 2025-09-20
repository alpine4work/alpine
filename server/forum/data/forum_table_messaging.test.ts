import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FilePostAuthorizer,
    backfillPostComments,
    createChannel,
    createPost,
    createPostComment,
    deletePostComment,
    getChannelPreview,
    getPost,
    getPostComment,
    getPostCommentPayload,
    getPostCommentPayloadsFromEnd,
    getPostCommentPayloadsFromStart,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updateChannelAccessPolicy,
    updatePostCommentContent,
} from "~/server/forum/data/forum_actions.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {AccessPolicy, AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

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
                            insideSession.account.id,
                            insideSession.account.id === context.actor.getAccountId()
                                ? {level: "Manage", generation: 0}
                                : {level: (["Comment", "Edit"] as const)[count++ % 2]!},
                        ],
                    ),
                    [insideViewerSession.account.id, {level: "View"}],
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
    async createMessage(
        context,
        {roomKey: postId, parentMessageIndex: parentCommentIndex, content, fileIds},
    ) {
        const comment = await createPostComment(context, {
            postId,
            parentCommentIndex,
            content,
            fileIds,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async getMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return getPostComment(context, {postId, commentIndex});
    },
    async getMessagePayload(context, {roomKey: postId, messageIndex: commentIndex}) {
        return (await getPostCommentPayload(context, {postId, commentIndex})).payload;
    },
    async updateMessageContent(context, {roomKey: postId, messageIndex: commentIndex, content}) {
        return updatePostCommentContent(context, {
            postId,
            commentIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return deletePostComment(context, {postId, commentIndex});
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
        const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
            await getPostCommentsFromStart(context, {
                postId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
            lastMessageChangeTime: lastCommentChangeTime,
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
        const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
            await getPostCommentsFromEnd(context, {
                postId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
            lastMessageChangeTime: lastCommentChangeTime,
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
            clientMessageCount: clientCommentCount,
            clientLastMessageChangeTime: clientLastCommentChangeTime,
            newMessageLimit: newCommentLimit,
        },
    ) {
        const {
            commentCount,
            lastCommentChangeTime,
            newComments,
            newOtherReferencedComments,
            commentChangesResult,
        } = await backfillPostComments(context, {
            postId,
            clientCommentCount,
            clientLastCommentChangeTime,
            newCommentLimit,
        });
        return {
            messageCount: commentCount,
            lastMessageChangeTime: lastCommentChangeTime,
            newMessages: newComments,
            newOtherReferencedMessages: newOtherReferencedComments,
            messageChangesResult: commentChangesResult,
        };
    },
});
