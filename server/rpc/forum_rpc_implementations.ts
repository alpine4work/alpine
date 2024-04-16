import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    authorizeChannelAccess,
    authorizePostAccess,
    backfillChannelPosts,
    backfillPostComments,
    createPost,
    createPostComment,
    deletePostComment,
    getChannel,
    getChannelPosts,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updateChannelDescription,
    updateChannelName,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definition from "~/shared/rpc/forum_rpc_definitions.js";

implementRpc(definition.updateChannelName, {visibility: ["AppClient"]}, async (context, input) => {
    const {getDynamoGeneralRealtimeEventTransaction} = await updateChannelName(context, input);
    return getDynamoGeneralRealtimeEventTransaction();
});

implementRpc(
    definition.updateChannelDescription,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await updateChannelDescription(context, input);
        return {};
    },
);

implementRpc(
    definition.getChannelWithStrongReadConsistency,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const channel = await getChannel(context, input.channelId, {consistency: "Strong"});
        return {channel};
    },
);

implementRpc(definition.getChannelPosts, {visibility: ["AppClient"]}, async (context, input) => {
    const postsResult = await getChannelPosts(context, input);
    return {postsResult};
});

implementRpc(
    definition.backfillChannelPosts,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const backfillPostsResult = await backfillChannelPosts(
            context.actor.authorizeSession(),
            input,
        );
        return {backfillPostsResult};
    },
);

implementRpc(definition.createPost, {visibility: ["AppClient"]}, async (context, input) => {
    const {id, spaceId, createdTime, getDynamoGeneralRealtimeEventTransaction} = await createPost(
        context.actor.authorizeSession(),
        input,
    );
    return {
        post: {id, spaceId, createdTime},
        ...(await getDynamoGeneralRealtimeEventTransaction()),
    };
});

implementRpc(definition.updatePostContent, {visibility: ["AppClient"]}, async (context, input) => {
    const {contentUpdatedTime, getDynamoGeneralRealtimeEventTransaction} = await updatePostContent(
        context.actor.authorizeSession(),
        input,
    );
    return {
        contentUpdatedTime,
        ...(await getDynamoGeneralRealtimeEventTransaction()),
    };
});

implementRpc(
    definition.getPostCommentAuthors,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const authors = await getPostCommentAuthors(context, input);
        return {authors};
    },
);

implementRpc(
    definition.getPostCommentsFromStart,
    {visibility: ["AppClient"]},
    async (context, input) => {
        return getPostCommentsFromStart(context, input);
    },
);

implementRpc(
    definition.getPostCommentsFromEnd,
    {visibility: ["AppClient"]},
    async (context, input) => {
        return getPostCommentsFromEnd(context, input);
    },
);

implementRpc(
    definition.authorizePostAccess,
    {visibility: ["PostRealtimeService"]},
    async (context, input) => {
        return authorizePostAccess(context, input.postId);
    },
);

implementRpc(
    definition.authorizeChannelAccess,
    {visibility: ["ChannelRealtimeService"]},
    async (context, input) => {
        return authorizeChannelAccess(context, input.channelId);
    },
);

implementRpc(
    definition.createPostComment,
    {visibility: ["PostRealtimeService"]},
    async (unknownContext, input) => {
        const context = unknownContext.actor.authorizeSession();

        const [{index, createdTime}, author, contentReferences] = await runAllPromises([
            createPostComment(context.actor.authorizeSession(), input),
            context.actor.getAccount(),
            authorizePostAccess(context, input.postId).then(({spaceId}) =>
                getContentReferencesForNode(context, spaceId, input.content),
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
);

implementRpc(
    definition.updatePostCommentContent,
    {visibility: ["PostRealtimeService"]},
    async (context, input) => {
        const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
            updatePostCommentContent(context.actor.authorizeSession(), input),
            authorizePostAccess(context.actor.authorizeSession(), input.postId).then(({spaceId}) =>
                getContentReferencesForNode(context, spaceId, input.content),
            ),
        ]);

        return {contentUpdatedTime, contentReferences};
    },
);

implementRpc(
    definition.deletePostComment,
    {visibility: ["PostRealtimeService"]},
    (context, input) => {
        return deletePostComment(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.backfillPostComments,
    {visibility: ["PostRealtimeService"]},
    (context, input) => {
        return backfillPostComments(context.actor.authorizeSession(), input);
    },
);
