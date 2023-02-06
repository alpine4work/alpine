import {
    createPost,
    createPostComment,
    deletePostComment,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostCommentContent,
} from "~/server/dynamo/posts_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/posts_rpc_definitions";

implementRpc(definition.createPost, async (context, input) => {
    const post = await createPost(await context.auth.authenticate(), input);
    return {post};
});

implementRpc(definition.createPostComment, async (context, input) => {
    await createPostComment(await context.auth.authenticate(), input);
    return {};
});

implementRpc(definition.updatePostCommentContent, async (context, input) => {
    const {contentUpdatedTime} = await updatePostCommentContent(
        await context.auth.authenticate(),
        input,
    );
    return {contentUpdatedTime};
});

implementRpc(definition.deletePostComment, async (context, input) => {
    await deletePostComment(await context.auth.authenticate(), input);
    return {};
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
