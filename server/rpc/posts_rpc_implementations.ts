import {createPost} from "~/server/dynamo/posts_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/posts_rpc_definitions";

implementRpc(definition.createPost, async (context, input) => {
    const post = await createPost(await context.auth.authenticate(), input);
    return {
        post: {
            id: post.id,
            spaceId: post.spaceId,
        },
    };
});
