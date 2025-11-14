import {
    createDynamoGeneralRealtimeBackfillResultSchema,
    createDynamoGeneralRealtimeIndexQuerySchema,
    createDynamoGeneralRealtimeItemSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    AccountId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {
    InboxEntryKeySchema,
    InboxEntryModelSchema,
    InboxModel,
} from "~/shared/notifications/inbox_model.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const getInboxWithStrongReadConsistency = defineRpc({
    name: "getInboxWithStrongReadConsistency",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
    },
});

export const getInboxEntries = defineRpc({
    name: "getInboxEntries",
    input: {
        spaceId: Schema.id<SpaceId>(),
        filter: Schema.enum(["New", "Archive"]),
        limit: Schema.integer,
        afterCursor: DynamoIndexCursorSchema.nullable(),
    },
    output: {
        entriesResult: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
    },
});

export const getInboxEntryWithStrongReadConsistency = defineRpc({
    name: "getInboxEntryWithStrongReadConsistency",
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {
        entry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema),
    },
});

export const backfillInboxEntries = defineRpc({
    name: "backfillInboxEntries",
    input: {
        spaceId: Schema.id<SpaceId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        backfillEntriesResult:
            createDynamoGeneralRealtimeBackfillResultSchema(InboxEntryModelSchema),
    },
});

export const archiveInboxEntry = defineRpc({
    name: "archiveInboxEntry",
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {},
});

export const unarchiveInboxEntry = defineRpc({
    name: "unarchiveInboxEntry",
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {},
});

export const archiveInboxChannelPostsEntryPost = defineRpc({
    name: "archiveInboxChannelPostsEntryPost",
    input: {
        spaceId: Schema.id<SpaceId>(),
        channelId: Schema.id<ChannelId>(),
        bucketGeneration: Schema.integer,
        postId: Schema.id<PostId>(),
    },
    output: {},
});

export const unarchiveInboxChannelPostsEntryPost = defineRpc({
    name: "unarchiveInboxChannelPostsEntryPost",
    input: {
        spaceId: Schema.id<SpaceId>(),
        channelId: Schema.id<ChannelId>(),
        bucketGeneration: Schema.integer,
        postId: Schema.id<PostId>(),
    },
    output: {},
});

export const archiveInboxDocumentNewCommentThreadsEntryCommentThread = defineRpc({
    name: "archiveInboxDocumentNewCommentThreadsEntryCommentThread",
    input: {
        spaceId: Schema.id<SpaceId>(),
        documentId: Schema.id<DocumentId>(),
        bucketGeneration: Schema.integer,
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
    },
    output: {},
});

export const unarchiveInboxDocumentNewCommentThreadsEntryCommentThread = defineRpc({
    name: "unarchiveInboxDocumentNewCommentThreadsEntryCommentThread",
    input: {
        spaceId: Schema.id<SpaceId>(),
        documentId: Schema.id<DocumentId>(),
        bucketGeneration: Schema.integer,
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
    },
    output: {},
});

export const observeInbox = defineRpc({
    name: "observeInbox",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const unsubscribeFromEmailNotificationWithUrl = defineRpc({
    name: "unsubscribeFromEmailNotificationWithUrl",
    input: {
        signedUrl: Schema.string,
    },
    output: {},
});

export const unsubscribeFromDigestNotificationsEmail = defineRpc({
    name: "unsubscribeFromDigestNotificationsEmail",
    input: {
        accountId: Schema.id<AccountId>(),
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const subscribeToDigestNotificationsEmail = defineRpc({
    name: "subscribeToDigestNotificationsEmail",
    input: {
        accountId: Schema.id<AccountId>(),
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});
