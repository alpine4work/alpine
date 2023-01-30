import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {PostContentSchema} from "~/shared/content/post_content_schema";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {PostCommentModel} from "~/shared/models/post_model";
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

export const createPostComment = defineRpc({
    name: "createPostComment",
    input: {
        postId: Schema.id<PostId>(),
        parentCommentId: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {},
});

export const getPostCommentAuthors = defineRpc({
    name: "getPostCommentAuthors",
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
    },
    output: {
        authors: Schema.array(AccountModel.schema()),
    },
});

export const getPostCommentsFromStart = defineRpc({
    name: "getPostCommentsFromStart",
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
        afterCommentId: Schema.integer.nullable(),
        beforeCommentId: Schema.integer.nullable(),
    },
    output: {
        hasMoreCommentsAfter: Schema.boolean,
        comments: Schema.array(PostCommentModel.schema()),
    },
});

export const getPostCommentsFromEnd = defineRpc({
    name: "getPostCommentsFromEnd",
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
        afterCommentId: Schema.integer.nullable(),
        beforeCommentId: Schema.integer.nullable(),
    },
    output: {
        hasMoreCommentsBefore: Schema.boolean,
        comments: Schema.array(PostCommentModel.schema()),
    },
});
