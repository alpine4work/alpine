import {AccountModel} from "~/shared/accounts/account_model.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {
    createDynamoGeneralRealtimeBackfillResultSchema,
    createDynamoGeneralRealtimeEventSchema,
    createDynamoGeneralRealtimeIndexQuerySchema,
    createDynamoGeneralRealtimeItemSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const updateChannelName = defineRpc({
    name: "updateChannelName",
    input: {
        channelId: Schema.id<ChannelId>(),
        name: Schema.string,
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelModel.schema()),
        ),
    },
});

export const updateChannelDescription = defineRpc({
    name: "updateChannelDescription",
    input: {
        channelId: Schema.id<ChannelId>(),
        description: MessageContentSchema,
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelModel.schema()),
        ),
    },
});

export const getChannelWithStrongReadConsistency = defineRpc({
    name: "getChannelWithStrongReadConsistency",
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {
        channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
    },
});

export const getChannelPosts = defineRpc({
    name: "getChannelPosts",
    input: {
        channelId: Schema.id<ChannelId>(),
        limit: Schema.integer,
        beforeCursor: DynamoIndexCursorSchema.nullable(),
    },
    output: {
        postsResult: createDynamoGeneralRealtimeIndexQuerySchema(PostModel.schema()),
    },
});

export const backfillChannelPosts = defineRpc({
    name: "backfillChannelPosts",
    input: {
        channelId: Schema.id<ChannelId>(),
        readTime: Schema.date,
    },
    output: {
        backfillPostsResult: createDynamoGeneralRealtimeBackfillResultSchema(PostModel.schema()),
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
        readTime: Schema.date,
        eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(PostModel.schema())),
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
        readTime: Schema.date,
        eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(PostModel.schema())),
    },
});

export const getPostCommentAuthors = defineRpc({
    name: "getPostCommentAuthors",
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
    },
    output: {
        authors: Schema.array(AccountModel.schema),
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

export const authorizePostAccess = defineRpc({
    name: "authorizePostAccess",
    input: {
        postId: Schema.id<PostId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

export const authorizeChannelAccess = defineRpc({
    name: "authorizeChannelAccess",
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

export const createPostComment = defineRpc({
    name: "createPostComment",
    input: {
        postId: Schema.id<PostId>(),
        parentCommentIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {
        comment: PostCommentModel.schema(),
    },
});

export const updatePostCommentContent = defineRpc({
    name: "updatePostCommentContent",
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
        content: MessageContentSchema,
    },
    output: {
        contentUpdatedTime: Schema.date,
        contentReferences: ContentReferencesSchema,
    },
});

export const deletePostComment = defineRpc({
    name: "deletePostComment",
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
    },
    output: {
        deletedTime: Schema.date,
    },
});

export const backfillPostComments = defineRpc({
    name: "backfillPostComments",
    input: {
        postId: Schema.id<PostId>(),
        clientCommentCount: Schema.integer,
        clientLastCommentChangeTime: Schema.date.nullable(),
        newCommentLimit: Schema.integer,
    },
    output: {
        commentCount: Schema.integer,
        lastCommentChangeTime: Schema.date.nullable(),
        newComments: Schema.array(PostCommentModel.schema()),
        newOtherReferencedComments: Schema.array(PostCommentModel.schema()),
        commentChangesResult: Schema.union({
            Available: Schema.object({
                type: Schema.value("Available"),
                changes: Schema.array(MessageChangeSchema),
            }),
            Unavailable: Schema.object({
                type: Schema.value("Unavailable"),
            }),
        }),
    },
});
