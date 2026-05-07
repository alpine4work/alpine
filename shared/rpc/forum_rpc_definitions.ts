import {AccessLevelSchema, LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicySchema} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/content/message_content_schema.js";
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
import {PostContentSchema, PostContentStepSchema} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {DynamoGeneralRealtimePostEventSchema} from "~/shared/forum/post_realtime_protocol.js";
import {AccountId, ChannelId, PostDraftId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessagePosOrFilesSchema} from "~/shared/messaging/message_pos_or_files_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {createMessageUpdatesBackfillResultSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {DynamoGeneralRealtimeSiteEventSchema} from "~/shared/sites/site_realtime_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const createChannel = defineRpc({
    name: "createChannel",
    // Fails if the channel already exists (when `channelId` is provided). Generates a
    // new `channelId` otherwise.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        channelId: Schema.id<ChannelId>().optional(),
        name: Schema.string,
        description: MessageContentSchema.optional(),
        accessPolicy: CreateOrUpdateAccessPolicySchema.optional(),
    },
    output: {
        channelId: Schema.id<ChannelId>(),
        createdTime: Schema.date,
        eventTransactionForSite: Schema.array(DynamoGeneralRealtimeSiteEventSchema).default([]),
    },
});

export const updateChannelName = defineRpc({
    name: "updateChannelName",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
        name: Schema.string,
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelModel.schema()),
        ),
    },
});

export const updateChannelDescription = defineRpc({
    name: "updateChannelDescription",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
        description: MessageContentSchema,
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelModel.schema()),
        ),
    },
});

export const updateChannelNameAndDescription = defineRpc({
    name: "updateChannelNameAndDescription",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
        name: Schema.string,
        description: MessageContentSchema,
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelModel.schema()),
        ),
    },
});

export const updateChannelAccessPolicy = defineRpc({
    name: "updateChannelAccessPolicy",
    // Sends `notification` twice if called twice.
    isIdempotent: false,
    input: {
        channelId: Schema.id<ChannelId>(),
        accessPolicy: LocalAccessPolicySchema,
        notification: ShareNotificationSchema.nullable(),
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelOrMetadataModelSchema),
        ),
    },
});

export const addAccountGrantsToChannelAccessPolicy = defineRpc({
    name: "addAccountGrantsToChannelAccessPolicy",
    // Sends `notification` twice if called twice.
    isIdempotent: false,
    input: {
        channelId: Schema.id<ChannelId>(),
        accountGrantById: Schema.map(
            Schema.id<AccountId>(),
            Schema.object({level: AccessLevelSchema}),
        ),
        notification: ShareNotificationSchema.nullable(),
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(ChannelOrMetadataModelSchema),
        ),
    },
});

export const getChannelWithStrongReadConsistency = defineRpc({
    name: "getChannelWithStrongReadConsistency",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {
        channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
    },
});

export const getChannelAndMetadata = defineRpc({
    name: "getChannelAndMetadata",
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        backfillChannelResult: createDynamoGeneralRealtimeBackfillResultSchema(
            ChannelOrMetadataModelSchema,
        ),
    },
});

export const subscribeToChannel = defineRpc({
    name: "subscribeToChannel",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {},
});

export const unsubscribeFromChannel = defineRpc({
    name: "unsubscribeFromChannel",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
    },
    output: {},
});

export const sendChannelShareNotification = defineRpc({
    name: "sendChannelShareNotification",
    // Sends `notification` twice if called twice.
    isIdempotent: false,
    input: {
        channelId: Schema.id<ChannelId>(),
        notification: ShareNotificationSchema,
    },
    output: {},
});

export const getChannelPosts = defineRpc({
    name: "getChannelPosts",
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        backfillPostsResult: createDynamoGeneralRealtimeBackfillResultSchema(PostModel.schema()),
    },
});

export const getPostWithStrongReadConsistency = defineRpc({
    name: "getPostWithStrongReadConsistency",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
    },
    output: {
        post: createDynamoGeneralRealtimeItemSchema(PostModel.schema()),
    },
});

export const createPost = defineRpc({
    name: "createPost",
    // Creates two posts if called twice.
    isIdempotent: false,
    input: {
        channelId: Schema.id<ChannelId>(),
        draftId: Schema.id<PostDraftId>().optional(),
        content: PostContentSchema,
        createdTimeZone: TimeZoneSchema,
    },
    output: {
        post: Schema.object({
            id: Schema.id<PostId>(),
            spaceId: Schema.id<SpaceId>(),
            createdTime: Schema.date,
        }),
        eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(PostModel.schema())),
    },
});

export const updatePostContent = defineRpc({
    name: "updatePostContent",
    // Fails if `contentVersion` isn't the current version.
    isIdempotent: false,
    input: {
        postId: Schema.id<PostId>(),
        contentVersion: Schema.integer,
        steps: Schema.array(PostContentStepSchema),
    },
    output: {
        contentUpdatedTime: Schema.date,
        eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(PostModel.schema())),
    },
});

export const getPostCommentAuthors = defineRpc({
    name: "getPostCommentAuthors",
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        checkpoint: ServerSynchronizationCheckpointSchema,
        commentCount: Schema.integer,
        comments: Schema.array(PostCommentModel.schema()),
        otherReferencedComments: Schema.array(PostCommentModel.schema()),
    },
});

export const getPostCommentsFromEnd = defineRpc({
    name: "getPostCommentsFromEnd",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        checkpoint: ServerSynchronizationCheckpointSchema,
        commentCount: Schema.integer,
        comments: Schema.array(PostCommentModel.schema()),
        otherReferencedComments: Schema.array(PostCommentModel.schema()),
    },
});

export const authorizePostAccess = defineRpc({
    name: "authorizePostAccess",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

export const authorizeChannelAccess = defineRpc({
    name: "authorizeChannelAccess",
    isIdempotent: true,
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
    // Creates two comments if called twice.
    isIdempotent: false,
    input: {
        postId: Schema.id<PostId>(),
        parent: MessageContentPayloadParentSchema.nullable(),
        content: MessageContentSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
        createdTimeZone: TimeZoneSchema,
    },
    output: {
        index: Schema.integer,
        createdTime: Schema.date,
    },
});

export const updatePostCommentContent = defineRpc({
    name: "updatePostCommentContent",
    // Fails if `contentVersion` isn't the current version.
    isIdempotent: false,
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        steps: Schema.array(MessageContentStepSchema),
    },
    output: {
        version: Schema.integer,
    },
});

export const deletePostComment = defineRpc({
    name: "deletePostComment",
    // Fails if the comment is already deleted.
    isIdempotent: false,
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
    },
    output: {
        version: Schema.integer,
    },
});

export const setPostCommentReaction = defineRpc({
    name: "setPostCommentReaction",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
        reaction: ReactionOrGenericLikeSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const deletePostCommentReaction = defineRpc({
    name: "deletePostCommentReaction",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const backfillPostComments = defineRpc({
    name: "backfillPostComments",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
        clientCommentCount: Schema.integer,
        newCommentLimit: Schema.integer,
    },
    output: {
        commentCount: Schema.integer,
        newComments: Schema.array(PostCommentModel.schema()),
        newOtherReferencedComments: Schema.array(PostCommentModel.schema()),
        commentUpdatesResult: createMessageUpdatesBackfillResultSchema(PostCommentModel.schema()),
    },
});

export const getPostCommentAtVersion = defineRpc({
    name: "getPostCommentAtVersion",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
        version: Schema.integer,
    },
    output: {
        comment: PostCommentModel.schema(),
    },
});

export const getPostCommentReferences = defineRpc({
    name: "getPostCommentReferences",
    isIdempotent: true,
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
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
    },
    output: {
        eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
    },
});

export const getChannelRealtimeEvent = defineRpc({
    name: "getChannelRealtimeEvent",
    isIdempotent: true,
    input: {
        channelId: Schema.id<ChannelId>(),
        eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
    },
    output: {
        eventTransaction: Schema.array(DynamoGeneralRealtimeChannelOrPostEventSchema),
    },
});

export const setPostReaction = defineRpc({
    name: "setPostReaction",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
        reaction: ReactionOrGenericLikeSchema,
    },
    output: {
        eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
    },
});

export const deletePostReaction = defineRpc({
    name: "deletePostReaction",
    isIdempotent: true,
    input: {
        postId: Schema.id<PostId>(),
    },
    output: {
        eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
    },
});
