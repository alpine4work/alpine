import {AccountModel} from "~/shared/accounts/account_model";
import {PostContentSchema} from "~/shared/forum/post_content_schema";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const updateChannelName = defineRpc({
    name: "updateChannelName",
    input: {
        channelId: Schema.id<ChannelId>(),
        name: Schema.string,
    },
    output: {},
});

export const updateChannelDescription = defineRpc({
    name: "updateChannelDescription",
    input: {
        channelId: Schema.id<ChannelId>(),
        description: MessageContentSchema,
    },
    output: {},
});

export const getChannelPosts = defineRpc({
    name: "getChannelPosts",
    input: {
        channelId: Schema.id<ChannelId>(),
        limit: Schema.integer,
        afterCursor: Schema.object({
            createdTime: Schema.date,
            postId: Schema.id<PostId>(),
        }).optional(),
    },
    output: {
        hasMorePosts: Schema.boolean,
        posts: Schema.array(PostModel.schema()),
    },
});

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

export const updatePostContent = defineRpc({
    name: "updatePostContent",
    input: {
        postId: Schema.id<PostId>(),
        content: PostContentSchema,
    },
    output: {
        contentUpdatedTime: Schema.date,
    },
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
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        commentCount: Schema.integer,
        comments: Schema.array(PostCommentModel.schema()),
        otherReferencedComments: Schema.array(PostCommentModel.schema()),
        lastCommentChangeTime: Schema.date.nullable(),
    },
});

export const getPostCommentsFromEnd = defineRpc({
    name: "getPostCommentsFromEnd",
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        commentCount: Schema.integer,
        comments: Schema.array(PostCommentModel.schema()),
        otherReferencedComments: Schema.array(PostCommentModel.schema()),
        lastCommentChangeTime: Schema.date.nullable(),
    },
});
