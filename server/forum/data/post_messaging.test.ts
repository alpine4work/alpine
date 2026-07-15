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
    getPostCommentParentContent,
    getPostCommentPayload,
    getPostCommentPayloadsFromEnd,
    getPostCommentPayloadsFromEndWithParents,
    getPostCommentPayloadsFromStart,
    getPostCommentPayloadsFromStartWithParents,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    pingPostCommentStream,
    putPostCommentMessageApprovalDecisions,
    putPostCommentStreamPart,
    setPostCommentReaction,
    updatePostCommentContent,
} from "~/server/forum/data/post_messaging.js";
import {updateChannelAccessPolicy} from "~/server/forum/data/update_channel_access_policy.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/suite/test_messaging_implementation.js";
import {AccessPolicyAccountGrant, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    forumInjection,
    notificationsInjection: {
        archiveInboxPostCommentsEntryAfterSetPostCommentReaction: async () => {},
    },
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
            createdTimeZone: defaultTimeZone,
        });

        return {
            key: post.id,
            spaceId,
            createdTime: post.createdTime,
            messageCount: 0,
            messageNoun: "comment",
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
                type: "Local",
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
            createdTimeZone: defaultTimeZone,
        });

        return {
            key: post.id,
            spaceId,
            createdTime: post.createdTime,
            messageCount: 0,
            messageNoun: "comment",
            doesInsideViewerSessionHaveRoomAccess: true,
            revokeInsideSession: async (context, session) => {
                const {accessPolicy: accessPolicyModel} = await getChannelPreview(
                    context,
                    channel.id,
                );
                const accessPolicy = accessPolicyModel.intoAccessPolicy();
                assert(accessPolicy.type === "Local", "Expected local access policy");

                const newAccessPolicy: LocalAccessPolicy = {
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
            messageNoun: "comment",
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
    async pingMessageStream(context, {roomKey: postId, messageIndex}) {
        return await pingPostCommentStream(context, {postId, commentIndex: messageIndex});
    },
    async putMessageStreamPart(
        context,
        {roomKey: postId, messageIndex: commentIndex, partIndex, payload, isTimeoutErrorCompletion},
    ) {
        return await putPostCommentStreamPart(context, {
            postId,
            commentIndex,
            partIndex,
            payload,
            isTimeoutErrorCompletion,
        });
    },
    async putMessageApprovalDecisions(
        context,
        {roomKey: postId, messageIndex: commentIndex, payload},
    ) {
        const {approvals} = await putPostCommentMessageApprovalDecisions(context, {
            postId,
            commentIndex,
            payload,
            consistency: "StrongWithinCache",
        });

        return {approvals};
    },
    async completeMessageStream(context, {roomKey: postId, messageIndex: commentIndex}) {
        return await completePostCommentStream(context, {
            postId,
            commentIndex,
        });
    },
    async getMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return await getPostComment(context, {postId, commentIndex});
    },
    async getMessagePayload(context, {roomKey: postId, messageIndex: commentIndex}) {
        return await getPostCommentPayload(context, {postId, commentIndex});
    },
    async getMessageParentContent(context, {roomKey: postId, parent}) {
        const parentContent = await getPostCommentParentContent(context, postId, {
            parent,
        });

        assert(parentContent.type !== "PostRange");

        return {
            content: parentContent.content,
            authorId: parentContent.authorId,
        };
    },
    async updateMessageContent(
        context,
        {roomKey: postId, messageIndex: commentIndex, contentVersion, steps},
    ) {
        return await updatePostCommentContent(context, {
            postId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return await deletePostComment(context, {postId, commentIndex});
    },
    async setMessageReaction(
        context,
        {roomKey: postId, messageIndex: commentIndex, contentVersion, pos, reaction},
    ) {
        return await setPostCommentReaction(context, {
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
        return await deletePostCommentReaction(context, {
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
    async getMessagePayloadsFromStartWithParents(
        context,
        {roomKey: postId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const {commentCount, comments, parentComments} =
            await getPostCommentPayloadsFromStartWithParents(
                context,
                {
                    postId,
                    limit,
                    afterCommentIndex: afterMessageIndex,
                    beforeCommentIndex: beforeMessageIndex,
                },
                message => Promise.resolve(message),
            );

        return {
            messageCount: commentCount,
            messages: comments,
            parentMessages: parentComments,
        };
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
    async getMessagePayloadsFromEndWithParents(
        context,
        {roomKey: postId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const {commentCount, comments, parentComments} =
            await getPostCommentPayloadsFromEndWithParents(
                context,
                {
                    postId,
                    limit,
                    afterCommentIndex: afterMessageIndex,
                    beforeCommentIndex: beforeMessageIndex,
                },
                message => Promise.resolve(message),
            );

        return {
            messageCount: commentCount,
            messages: comments,
            parentMessages: parentComments,
        };
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
