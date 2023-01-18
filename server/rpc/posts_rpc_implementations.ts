import {createPost, createPostRootComment} from "~/server/dynamo/posts_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/posts_rpc_definitions";

implementRpc(definition.createPost, async (context, input) => {
    const post = await createPost(await context.auth.authenticate(), input);
    return {post};
});

implementRpc(definition.createPostRootComment, async (context, input) => {
    const postRootComment = await createPostRootComment(await context.auth.authenticate(), input);
    return {postRootComment};
});
