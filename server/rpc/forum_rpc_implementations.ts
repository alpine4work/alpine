import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    FilePostAuthorizer,
    authorizeChannelAccess,
    authorizePostAccess,
    backfillChannelPosts,
    backfillPostComments,
    createChannel,
    createPost,
    createPostComment,
    deletePostComment,
    getChannel,
    getChannelPosts,
    getPost,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updateChannelDescription,
    updateChannelName,
    updateChannelNameAndDescription,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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
            return getDynamoGeneralRealtimeEventTransaction();
        },
    },

    updateChannelDescription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateChannelDescription(
                context,
                input,
            );
            return getDynamoGeneralRealtimeEventTransaction();
        },
    },

    updateChannelNameAndDescription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} =
                await updateChannelNameAndDescription(context, input);
            return getDynamoGeneralRealtimeEventTransaction();
        },
    },

    getChannelWithStrongReadConsistency: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const channel = await getChannel(context, input.channelId, {consistency: "Strong"});
            return {channel};
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
                ...(await getDynamoGeneralRealtimeEventTransaction()),
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
                ...(await getDynamoGeneralRealtimeEventTransaction()),
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
            return authorizeChannelAccess(context, input.channelId);
        },
    },

    createPostComment: {
        visibility: ["PostRealtimeService"],
        execute: async (unknownContext, input) => {
            const context = unknownContext.actor.authorizeSession();

            const {spaceId, index, createdTime} = await createPostComment(
                context.actor.authorizeSession(),
                input,
            );

            const [author, contentReferences] = await runAllPromises([
                getAccount(context, spaceId, context.actor.getAccountId()),
                getContentReferencesForNode(
                    context,
                    spaceId,
                    FilePostAuthorizer.bind(input.postId),
                    input.content,
                ),
            ]);

            const comment = new PostCommentModel({
                postId: input.postId,
                index,
                createdTime,
                author,
                payload: {
                    type: "Content",
                    parentMessageIndex: input.parentCommentIndex,
                    content: {
                        doc: input.content,
                        references: contentReferences,
                    },
                    contentUpdatedTime: null,
                },
            });

            return {comment};
        },
    },

    updatePostCommentContent: {
        visibility: ["PostRealtimeService"],
        execute: async (context, input) => {
            const {spaceId, contentUpdatedTime} = await updatePostCommentContent(
                context.actor.authorizeSession(),
                input,
            );

            const contentReferences = await getContentReferencesForNode(
                context,
                spaceId,
                FilePostAuthorizer.bind(input.postId),
                input.content,
            );

            return {
                contentUpdatedTime,
                contentReferences,
            };
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
});
