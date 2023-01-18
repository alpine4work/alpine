import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {PostCommentContentSchema} from "~/shared/posts/post_comment_content_schema";
import {PostContentSchema} from "~/shared/posts/post_content_schema";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const createPost = defineRpc({
    name: "createPost",
    input: {
        channelId: Schema.id<ChannelId>(),
        content: PostContentSchema,
    },
    output: {
        post: Schema.object({
            id: Schema.id<PostId>(),
            spaceId: Schema.id<SpaceId>(),
            createdTime: Schema.date,
        }),
    },
});

export const createPostRootComment = defineRpc({
    name: "createPostRootComment",
    input: {
        postId: Schema.id<PostId>(),
        content: PostCommentContentSchema,
    },
    output: {
        postRootComment: Schema.object({
            rootCommentNumber: Schema.integer,
            createdTime: Schema.date,
        }),
    },
});
