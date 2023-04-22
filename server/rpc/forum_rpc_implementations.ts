import {
    createPost,
    getChannelPosts,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updateChannelDescription,
    updateChannelName,
    updatePostContent,
} from "~/server/dynamo/forum_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/forum_rpc_definitions";

implementRpc(definition.updateChannelName, async (context, input) => {
    await updateChannelName(await context.actor.authenticate(), input);
    return {};
});

implementRpc(definition.updateChannelDescription, async (context, input) => {
    await updateChannelDescription(await context.actor.authenticate(), input);
    return {};
});

implementRpc(definition.getChannelPosts, async (context, input) => {
    return getChannelPosts(await context.actor.authenticate(), input);
});

implementRpc(definition.createPost, async (context, input) => {
    const post = await createPost(await context.actor.authenticate(), input);
    return {post};
});

implementRpc(definition.updatePostContent, async (context, input) => {
    return updatePostContent(await context.actor.authenticate(), input);
});

implementRpc(definition.getPostCommentAuthors, async (context, input) => {
    const authors = await getPostCommentAuthors(await context.actor.authenticate(), input);
    return {authors};
});

implementRpc(definition.getPostCommentsFromStart, async (context, input) => {
    return getPostCommentsFromStart(await context.actor.authenticate(), input);
});

implementRpc(definition.getPostCommentsFromEnd, async (context, input) => {
    return getPostCommentsFromEnd(await context.actor.authenticate(), input);
});
