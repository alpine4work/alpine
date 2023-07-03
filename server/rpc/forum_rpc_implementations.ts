import {
    authorizePostAccess,
    backfillPostComments,
    createPost,
    createPostComment,
    deletePostComment,
    getChannelPosts,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updateChannelDescription,
    updateChannelName,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/dynamo/forum_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/forum_rpc_definitions.js";

implementRpc(definition.updateChannelName, {visibility: ["AppClient"]}, async (context, input) => {
    await updateChannelName(context, input);
    return {};
});

implementRpc(
    definition.updateChannelDescription,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await updateChannelDescription(context, input);
        return {};
    },
);

implementRpc(definition.getChannelPosts, {visibility: ["AppClient"]}, async (context, input) => {
    return getChannelPosts(context, input);
});

implementRpc(definition.createPost, {visibility: ["AppClient"]}, async (context, input) => {
    const post = await createPost(context.actor.authorizeSession(), input);
    return {post};
});

implementRpc(definition.updatePostContent, {visibility: ["AppClient"]}, async (context, input) => {
    return updatePostContent(context.actor.authorizeSession(), input);
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
    definition.createPostComment,
    {visibility: ["PostRealtimeService"]},
    (context, input) => {
        return createPostComment(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.updatePostCommentContent,
    {visibility: ["PostRealtimeService"]},
    (context, input) => {
        return updatePostCommentContent(context.actor.authorizeSession(), input);
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
