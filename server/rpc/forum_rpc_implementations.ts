import {
    createPost,
    getChannelPosts,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostContent,
} from "~/server/dynamo/forum_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/forum_rpc_definitions";

implementRpc(definition.getChannelPosts, async (context, input) => {
    return getChannelPosts(await context.auth.authenticate(), input);
});

implementRpc(definition.createPost, async (context, input) => {
    const post = await createPost(await context.auth.authenticate(), input);
    return {post};
});

implementRpc(definition.updatePostContent, async (context, input) => {
    return updatePostContent(await context.auth.authenticate(), input);
});

implementRpc(definition.getPostCommentAuthors, async (context, input) => {
    const authors = await getPostCommentAuthors(await context.auth.authenticate(), input);
    return {authors};
});

implementRpc(definition.getPostCommentsFromStart, async (context, input) => {
    return getPostCommentsFromStart(await context.auth.authenticate(), input);
});

implementRpc(definition.getPostCommentsFromEnd, async (context, input) => {
    return getPostCommentsFromEnd(await context.auth.authenticate(), input);
});
