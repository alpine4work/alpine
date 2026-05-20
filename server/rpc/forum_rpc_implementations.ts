import {addAccountGrantsToChannelAccessPolicy} from "~/server/forum/data/add_account_grants_to_channel_access_policy.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {authorizePostAccess} from "~/server/forum/data/authorize_post_access.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createOrReplacePostDraft} from "~/server/forum/data/create_or_replace_post_draft.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {deletePostReaction} from "~/server/forum/data/delete_post_reaction.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannel} from "~/server/forum/data/get_channel.js";
import {
    backfillChannelAndMetadata,
    getChannelAndMetadata,
} from "~/server/forum/data/get_channel_and_metadata.js";
import {backfillChannelPosts, getChannelPosts} from "~/server/forum/data/get_channel_posts.js";
import {getChannelRealtimeEvent} from "~/server/forum/data/get_channel_realtime_event.js";
import {getPost} from "~/server/forum/data/get_post.js";
import {getPostCommentAuthors} from "~/server/forum/data/get_post_comment_authors.js";
import {getPostRealtimeEvent} from "~/server/forum/data/get_post_realtime_event.js";
import {
    backfillPostComments,
    createPostComment,
    deletePostComment,
    deletePostCommentReaction,
    getPostCommentAtVersion,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    setPostCommentReaction,
    updatePostCommentContent,
} from "~/server/forum/data/post_messaging.js";
import {sendChannelShareNotification} from "~/server/forum/data/send_channel_share_notification.js";
import {setPostReaction} from "~/server/forum/data/set_post_reaction.js";
import {
    subscribeToChannel,
    unsubscribeFromChannel,
} from "~/server/forum/data/subscribe_to_channel.js";
import {updateChannelAccessPolicy} from "~/server/forum/data/update_channel_access_policy.js";
import {updateChannelDescription} from "~/server/forum/data/update_channel_description.js";
import {updateChannelName} from "~/server/forum/data/update_channel_name.js";
import {updateChannelNameAndDescription} from "~/server/forum/data/update_channel_name_and_description.js";
import {updatePostContent} from "~/server/forum/data/update_post_content.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/forum_rpc_definitions.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export default implementRpcs(definitions, {
    createChannel: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, createdTime, getRynamoEventTransactionForSite} = await createChannel(
                context.actor.authorizeSession(),
                input,
            );
            return {
                channelId: id,
                createdTime,
                eventTransactionForSite: await getRynamoEventTransactionForSite(context),
            };
        },
    },

    updateChannelName: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEventTransaction} = await updateChannelName(context, input);
            return {eventTransaction: await getRynamoEventTransaction(context)};
        },
    },

    updateChannelDescription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEventTransaction} = await updateChannelDescription(context, input);
            return {eventTransaction: await getRynamoEventTransaction(context)};
        },
    },

    updateChannelNameAndDescription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEventTransaction} = await updateChannelNameAndDescription(
                context,
                input,
            );
            return {eventTransaction: await getRynamoEventTransaction(context)};
        },
    },

    updateChannelAccessPolicy: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEventTransaction} = await updateChannelAccessPolicy(
                context.actor.authorizeSession(),
                input,
            );
            return {
                eventTransaction: await getRynamoEventTransaction(context),
            };
        },
    },

    addAccountGrantsToChannelAccessPolicy: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEventTransaction} = await addAccountGrantsToChannelAccessPolicy(
                context.actor.authorizeSession(),
                input,
            );
            return {
                eventTransaction: await getRynamoEventTransaction(context),
            };
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
            const post = await getPost(context.actor.authorizeSession(), input.postId, {
                consistency: "Strong",
            });

            return {post};
        },
    },

    createPost: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, spaceId, createdTime, getRynamoEventTransaction} = await createPost(
                context.actor.authorizeSession(),
                input,
            );
            return {
                post: {
                    id,
                    spaceId,
                    createdTime,
                },
                eventTransaction: await getRynamoEventTransaction(context),
            };
        },
    },

    updatePostContent: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {contentUpdatedTime, getRynamoEventTransaction} = await updatePostContent(
                context.actor.authorizeSession(),
                input,
            );
            return {
                contentUpdatedTime,
                eventTransaction: await getRynamoEventTransaction(context),
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
            const checkpoint = generateServerSynchronizationCheckpoint();
            const output = await getPostCommentsFromStart(context, input);
            return {checkpoint, ...output};
        },
    },

    getPostCommentsFromEnd: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const checkpoint = generateServerSynchronizationCheckpoint();
            const output = await getPostCommentsFromEnd(context, input);
            return {checkpoint, ...output};
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
        execute: (context, input) => {
            return updatePostCommentContent(context.actor.authorizeSession(), input);
        },
    },

    deletePostComment: {
        visibility: ["PostRealtimeService"],
        execute: (context, input) => {
            return deletePostComment(context.actor.authorizeSession(), input);
        },
    },

    setPostCommentReaction: {
        visibility: ["PostRealtimeService"],
        execute: (context, input) => {
            return setPostCommentReaction(context.actor.authorizeSession(), input);
        },
    },

    deletePostCommentReaction: {
        visibility: ["PostRealtimeService"],
        execute: (context, input) => {
            return deletePostCommentReaction(context.actor.authorizeSession(), input);
        },
    },

    backfillPostComments: {
        visibility: ["PostRealtimeService"],
        execute: (context, input) => {
            return backfillPostComments(context.actor.authorizeSession(), input);
        },
    },

    getPostCommentAtVersion: {
        visibility: ["PostRealtimeService"],
        execute: async (context, input) => {
            const comment = await getPostCommentAtVersion(context.actor.authorizeSession(), input);
            return {comment};
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
            const eventTransaction = await getPostRealtimeEvent(
                context.actor.authorizeSession(),
                input.postId,
                input.eventTransaction,
            );

            return {eventTransaction};
        },
    },

    getChannelRealtimeEvent: {
        visibility: ["ChannelRealtimeService"],
        execute: async (context, input) => {
            const eventTransaction = await getChannelRealtimeEvent(
                context.actor.authorizeSession(),
                input.channelId,
                input.eventTransaction,
            );

            return {eventTransaction};
        },
    },

    setPostReaction: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEvent} = await setPostReaction(
                context.actor.authorizeSession(),
                input.postId,
                input.reaction,
            );

            return {eventTransaction: [await getRynamoEvent(context)]};
        },
    },

    deletePostReaction: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEvent} = await deletePostReaction(
                context.actor.authorizeSession(),
                input.postId,
            );

            return {eventTransaction: [await getRynamoEvent(context)]};
        },
    },
});
