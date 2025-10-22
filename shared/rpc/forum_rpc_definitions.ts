import {AccessLevelSchema, AccessPolicySchema} from "~/shared/access/access_policy.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {
    DynamoGeneralRealtimeEventStubSchema,
    createDynamoGeneralRealtimeBackfillResultSchema,
    createDynamoGeneralRealtimeEventSchema,
    createDynamoGeneralRealtimeIndexQuerySchema,
    createDynamoGeneralRealtimeItemSchema,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    DynamoIndexCursorSchema,
    DynamoItemKeySchema,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {ChannelModel, ChannelOrMetadataModelSchema} from "~/shared/forum/channel_model.js";
import {DynamoGeneralRealtimeChannelOrPostEventSchema} from "~/shared/forum/channel_realtime_protocol.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {DynamoGeneralRealtimePostEventSchema} from "~/shared/forum/post_realtime_protocol.js";
import {AccountId, ChannelId, PostDraftId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/messaging/message_content_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {MessageContentPayloadContentUpdateSchema} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSchema} from "~/shared/reactions/reaction_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export const createChannel = defineRpc({
    name: "createChannel",
    input: {
        spaceId: Schema.id<SpaceId>(),
        channelId: Schema.id<ChannelId>().optional(),
        name: Schema.string,
        description: MessageContentSchema.optional(),
        accessPolicy: AccessPolicySchema.optional(),
    },
    output: {
        channelId: Schema.id<ChannelId>(),
        createdTime: Schema.date,
    },
});

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

export const updateChannelNameAndDescription = defineRpc({
    name: "updateChannelNameAndDescription",
    input: {
        channelId: Schema.id<ChannelId>(),
        name: Schema.string,
        description: MessageContentSchema,
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelModel.schema()),
        ),
    },
});

export const updateChannelAccessPolicy = defineRpc({
    name: "updateChannelAccessPolicy",
    input: {
        channelId: Schema.id<ChannelId>(),
        accessPolicy: AccessPolicySchema,
        notification: ShareNotificationSchema.nullable(),
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelOrMetadataModelSchema),
        ),
    },
});

export const addAccountGrantsToChannelAccessPolicy = defineRpc({
    name: "addAccountGrantsToChannelAccessPolicy",
    input: {
        channelId: Schema.id<ChannelId>(),
        accountGrantById: Schema.map(
            Schema.id<AccountId>(),
            Schema.object({level: AccessLevelSchema}),
        ),
        notification: ShareNotificationSchema.nullable(),
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelOrMetadataModelSchema),
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

export const getChannelAndMetadata = defineRpc({
    name: "getChannelAndMetadata",
    input: {
        channelId: Schema.id<ChannelId>(),
        postFilesLimit: Schema.integer,
        afterItemKey: DynamoItemKeySchema.optional(),
    },
    output: {
        channelResult: createDynamoGeneralRealtimeQuerySchema(ChannelOrMetadataModelSchema),
    },
});

export const backfillChannelAndMetadata = defineRpc({
    name: "backfillChannelAndMetadata",
    input: {
        channelId: Schema.id<ChannelId>(),
        readTime: Schema.date,
    },
    output: {
        backfillChannelResult: createDynamoGeneralRealtimeBackfillResultSchema(
            ChannelOrMetadataModelSchema,
        ),
    },
});

export const subscribeToChannel = defineRpc({
    name: "subscribeToChannel",
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {},
});

export const unsubscribeFromChannel = defineRpc({
    name: "unsubscribeFromChannel",
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {},
});

export const sendChannelShareNotification = defineRpc({
    name: "sendChannelShareNotification",
    input: {
        channelId: Schema.id<ChannelId>(),
        notification: ShareNotificationSchema,
    },
    output: {},
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

export const getPostWithStrongReadConsistency = defineRpc({
    name: "getPostWithStrongReadConsistency",
    input: {
        postId: Schema.id<PostId>(),
    },
    output: {
        readTime: Schema.date,
        post: createDynamoGeneralRealtimeItemSchema(PostModel.schema()),
    },
});

export const createPost = defineRpc({
    name: "createPost",
    input: {
        channelId: Schema.id<ChannelId>(),
        draftId: Schema.id<PostDraftId>().optional(),
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
        expectedAccessLevel: AccessLevelSchema,
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
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
    },
    output: {
        index: Schema.integer,
        createdTime: Schema.date,
    },
});

export const updatePostCommentContent = defineRpc({
    name: "updatePostCommentContent",
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
        version: Schema.integer,
        steps: Schema.array(MessageContentStepSchema),
    },
    output: {
        content: MessageContentSchema,
        contentUpdate: MessageContentPayloadContentUpdateSchema,
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

export const getPostCommentReferences = defineRpc({
    name: "getPostCommentReferences",
    input: {
        spaceId: Schema.id<SpaceId>(),
        postId: Schema.id<PostId>(),
        referencedIds: MessageReferencedIdsSchema,
    },
    output: {
        references: MessageReferencesSchema,
    },
});

export const createOrReplacePostDraft = defineRpc({
    name: "createOrReplacePostDraft",
    input: {
        spaceId: Schema.id<SpaceId>(),
        draftId: Schema.id<PostDraftId>(),
        channelId: Schema.id<ChannelId>().nullable(),
        content: PostContentSchema,
    },
    output: {},
});

export const getPostRealtimeEvent = defineRpc({
    name: "getPostRealtimeEvent",
    input: {
        postId: Schema.id<PostId>(),
        eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
    },
});

export const getChannelRealtimeEvent = defineRpc({
    name: "getChannelRealtimeEvent",
    input: {
        channelId: Schema.id<ChannelId>(),
        eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(DynamoGeneralRealtimeChannelOrPostEventSchema),
    },
});

export const setPostReaction = defineRpc({
    name: "setPostReaction",
    input: {
        postId: Schema.id<PostId>(),
        reaction: ReactionSchema.nullable().transform<Reaction | "GenericLike">({
            serialize: value => (value === "GenericLike" ? null : value),
            deserialize: value => (value === null ? "GenericLike" : value),
        }),
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
    },
});

export const deletePostReaction = defineRpc({
    name: "deletePostReaction",
    input: {
        postId: Schema.id<PostId>(),
    },
    output: {
        readTime: Schema.date,
        eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
    },
});
