import {
    FilePostAuthorizer,
    addAccountGrantsToChannelAccessPolicy,
    authorizeChannelAccess,
    authorizePostAccess,
    backfillChannelAndMetadata,
    backfillChannelPosts,
    backfillPostComments,
    createChannel,
    createOrReplacePostDraft,
    createPost,
    createPostComment,
    deletePostComment,
    getChannel,
    getChannelAndMetadata,
    getChannelPosts,
    getChannelRealtimeEvent,
    getPost,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    getPostRealtimeEvent,
    sendChannelShareNotification,
    subscribeToChannel,
    unsubscribeFromChannel,
    updateChannelAccessPolicy,
    updateChannelDescription,
    updateChannelName,
    updateChannelNameAndDescription,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_actions.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/forum_rpc_definitions.js";

export default implementRpcs(definitions, {
    createChannel: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, createdTime} = await createChannel(context.actor.authorizeSession(), input);
            return {channelId: id, createdTime};
        },
    },

    updateChannelName: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateChannelName(
                context,
                input,
            );
            return getDynamoGeneralRealtimeEventTransaction(context);
        },
    },

    updateChannelDescription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateChannelDescription(
                context,
                input,
            );
            return getDynamoGeneralRealtimeEventTransaction(context);
        },
    },

    updateChannelNameAndDescription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} =
                await updateChannelNameAndDescription(context, input);
            return getDynamoGeneralRealtimeEventTransaction(context);
        },
    },

    updateChannelAccessPolicy: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateChannelAccessPolicy(
                context.actor.authorizeSession(),
                input,
            );
            return getDynamoGeneralRealtimeEventTransaction(context);
        },
    },

    addAccountGrantsToChannelAccessPolicy: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} =
                await addAccountGrantsToChannelAccessPolicy(
                    context.actor.authorizeSession(),
                    input,
                );
            return getDynamoGeneralRealtimeEventTransaction(context);
        },
    },

    getChannelWithStrongReadConsistency: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const channel = await getChannel(context, input.channelId, {consistency: "Strong"});
            return {channel};
        },
    },

    getChannelAndMetadata: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const channelResult = await getChannelAndMetadata(context, input);
            return {channelResult};
        },
    },

    subscribeToChannel: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await subscribeToChannel(context.actor.authorizeSession(), input.channelId);
            return {};
        },
    },

    unsubscribeFromChannel: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unsubscribeFromChannel(context.actor.authorizeSession(), input.channelId);
            return {};
        },
    },

    sendChannelShareNotification: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await sendChannelShareNotification(
                context.actor.authorizeSession(),
                input.channelId,
                input.notification,
            );
            return {};
        },
    },

    backfillChannelAndMetadata: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const backfillChannelResult = await backfillChannelAndMetadata(context, input);
            return {backfillChannelResult};
        },
    },

    getChannelPosts: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const postsResult = await getChannelPosts(context, input);
            return {postsResult};
        },
    },

    backfillChannelPosts: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const backfillPostsResult = await backfillChannelPosts(
                context.actor.authorizeSession(),
                input,
            );
            return {backfillPostsResult};
        },
    },

    getPostWithStrongReadConsistency: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const readTime = new Date();

            const post = await getPost(context.actor.authorizeSession(), input.postId, {
                consistency: "Strong",
            });

            return {readTime, post};
        },
    },

    createPost: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, spaceId, createdTime, getDynamoGeneralRealtimeEventTransaction} =
                await createPost(context.actor.authorizeSession(), input);
            return {
                post: {
                    id,
                    spaceId,
                    createdTime,
                },
                ...(await getDynamoGeneralRealtimeEventTransaction(context)),
            };
        },
    },

    updatePostContent: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {contentUpdatedTime, getDynamoGeneralRealtimeEventTransaction} =
                await updatePostContent(context.actor.authorizeSession(), input);
            return {
                contentUpdatedTime,
                ...(await getDynamoGeneralRealtimeEventTransaction(context)),
            };
        },
    },

    getPostCommentAuthors: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const authors = await getPostCommentAuthors(context, input);
            return {authors};
        },
    },

    getPostCommentsFromStart: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return getPostCommentsFromStart(context, input);
        },
    },

    getPostCommentsFromEnd: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return getPostCommentsFromEnd(context, input);
        },
    },

    authorizePostAccess: {
        visibility: ["PostRealtimeService"],
        execute: async (context, input) => {
            return authorizePostAccess(context, input.postId, "View");
        },
    },

    authorizeChannelAccess: {
        visibility: ["ChannelRealtimeService"],
        execute: async (context, input) => {
            return authorizeChannelAccess(context, input.channelId, input.expectedAccessLevel, {
                consistency: "Eventual",
            });
        },
    },

    createPostComment: {
        visibility: ["PostRealtimeService"],
        execute: async (unknownContext, input) => {
            const context = unknownContext.actor.authorizeSession();

            const {index, createdTime} = await createPostComment(
                context.actor.authorizeSession(),
                input,
            );

            return {index, createdTime};
        },
    },

    updatePostCommentContent: {
        visibility: ["PostRealtimeService"],
        execute: async (context, input) => {
            const {contentUpdatedTime} = await updatePostCommentContent(
                context.actor.authorizeSession(),
                input,
            );
            return {contentUpdatedTime};
        },
    },

    deletePostComment: {
        visibility: ["PostRealtimeService"],
        execute: (context, input) => {
            return deletePostComment(context.actor.authorizeSession(), input);
        },
    },

    backfillPostComments: {
        visibility: ["PostRealtimeService"],
        execute: (context, input) => {
            return backfillPostComments(context.actor.authorizeSession(), input);
        },
    },

    getPostCommentReferences: {
        visibility: ["PostRealtimeService"],
        execute: async (context, {spaceId, postId, referencedIds}) => {
            const references = await getMessageReferences(
                context.actor.authorizeSession(),
                spaceId,
                FilePostAuthorizer.bind({type: "PostComments", postId}),
                referencedIds,
            );
            return {references};
        },
    },

    createOrReplacePostDraft: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();

            await createOrReplacePostDraft(
                sessionContext,
                input.spaceId,
                sessionContext.actor.getAccountId(),
                input.draftId,
                {
                    channelId: input.channelId,
                    content: input.content,
                },
            );

            return {};
        },
    },

    getPostRealtimeEvent: {
        visibility: ["PostRealtimeService"],
        execute: async (context, input) => {
            const readTime = new Date();

            const eventTransaction = await getPostRealtimeEvent(
                context.actor.authorizeSession(),
                input.postId,
                input.eventTransaction,
            );

            return {readTime, eventTransaction};
        },
    },

    getChannelRealtimeEvent: {
        visibility: ["ChannelRealtimeService"],
        execute: async (context, input) => {
            const readTime = new Date();

            const eventTransaction = await getChannelRealtimeEvent(
                context.actor.authorizeSession(),
                input.channelId,
                input.eventTransaction,
            );

            return {readTime, eventTransaction};
        },
    },
});
