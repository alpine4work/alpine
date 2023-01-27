import {createPost, createPostComment} from "~/server/dynamo/posts_table";
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
