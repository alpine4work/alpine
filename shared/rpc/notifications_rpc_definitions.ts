import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    createRynamoBackfillResultSchema,
    createRynamoIndexQuerySchema,
    createRynamoItemSchema,
} from "~/shared/dynamo/rynamo_types.js";
import {
    AccountId,
    BrowserId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {InboxEntryStatusSchema} from "~/shared/notifications/inbox_entry_status.js";
import {
    InboxEntryKeySchema,
    InboxEntryModelSchema,
    InboxModel,
} from "~/shared/notifications/inbox_model.js";
import {WebPushSubscriptionSchema} from "~/shared/notifications/web_push_subscription.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const getInboxWithStrongReadConsistency = defineRpc({
    name: "getInboxWithStrongReadConsistency",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        inbox: createRynamoItemSchema(InboxModel.schema()),
    },
});

export const getInboxEntries = defineRpc({
    name: "getInboxEntries",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        filter: InboxEntryStatusSchema,
        limit: Schema.integer,
        afterCursor: DynamoIndexCursorSchema.nullable(),
    },
    output: {
        entriesResult: createRynamoIndexQuerySchema(InboxEntryModelSchema),
    },
});

export const getInboxEntryWithStrongReadConsistency = defineRpc({
    name: "getInboxEntryWithStrongReadConsistency",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {
        entry: createRynamoItemSchema(InboxEntryModelSchema),
    },
});

export const backfillInboxEntries = defineRpc({
    name: "backfillInboxEntries",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        backfillEntriesResult: createRynamoBackfillResultSchema(InboxEntryModelSchema),
    },
});

export const archiveInboxEntry = defineRpc({
    name: "archiveInboxEntry",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {},
});

export const unarchiveInboxEntry = defineRpc({
    name: "unarchiveInboxEntry",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {},
});

export const archiveInboxChannelPostsEntryPost = defineRpc({
    name: "archiveInboxChannelPostsEntryPost",
    isIdempotent: true,
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
    isIdempotent: true,
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
    isIdempotent: true,
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
    isIdempotent: true,
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
    // Increments the inbox generation twice if called twice. (Arguably this behavior
    // is fine and similar to incrementing an update lock version twice which we
    // consider idempotent.)
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const unsubscribeFromEmailNotificationWithUrl = defineRpc({
    name: "unsubscribeFromEmailNotificationWithUrl",
    isIdempotent: true,
    input: {
        signedUrl: Schema.string,
    },
    output: {},
});

export const unsubscribeFromDigestNotificationsEmail = defineRpc({
    name: "unsubscribeFromDigestNotificationsEmail",
    isIdempotent: true,
    input: {
        accountId: Schema.id<AccountId>(),
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const subscribeToDigestNotificationsEmail = defineRpc({
    name: "subscribeToDigestNotificationsEmail",
    isIdempotent: true,
    input: {
        accountId: Schema.id<AccountId>(),
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const registerOurAccountAppleDeviceToken = defineRpc({
    name: "registerOurAccountAppleDeviceToken",
    isIdempotent: true,
    input: {
        deviceToken: Schema.bytes.fixedLength(32),
    },
    output: {},
});

export const isOptedOutOfWebPushForSpace = defineRpc({
    name: "isOptedOutOfWebPushForSpace",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        browserId: Schema.id<BrowserId>(),
    },
    output: {
        optedOut: Schema.boolean,
    },
});

export const optOutOfWebPushForSpace = defineRpc({
    name: "optOutOfWebPushForSpace",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        browserId: Schema.id<BrowserId>(),
    },
    output: {},
});

export const registerAccountWebPushSubscriptionAndOptInToSpace = defineRpc({
    name: "registerAccountWebPushSubscriptionAndOptInToSpace",
    isIdempotent: true,
    input: {
        subscription: WebPushSubscriptionSchema,
        browserId: Schema.id<BrowserId>(),
        spaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const registerOurAccountWebPushSubscription = defineRpc({
    name: "registerOurAccountWebPushSubscription",
    isIdempotent: true,
    input: {
        subscription: WebPushSubscriptionSchema,
        browserId: Schema.id<BrowserId>(),
    },
    output: {},
});

export const deregisterAccountWebPushSubscription = defineRpc({
    name: "deregisterAccountWebPushSubscription",
    isIdempotent: true,
    input: {
        accountId: Schema.id<AccountId>(),
        browserId: Schema.id<BrowserId>(),
    },
    output: {},
});

export const deregisterOurAccountWebPushSubscription = defineRpc({
    name: "deregisterOurAccountWebPushSubscription",
    isIdempotent: true,
    input: {
        browserId: Schema.id<BrowserId>(),
    },
    output: {},
});

export const areNotificationsToSlackEnabled = defineRpc({
    name: "areNotificationsToSlackEnabled",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        workspaceId: Schema.string,
    },
    output: {
        enabled: Schema.boolean,
    },
});

export const enableNotificationsToSlack = defineRpc({
    name: "enableNotificationsToSlack",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        workspaceId: Schema.string,
    },
    output: {},
});

export const disableNotificationsToSlack = defineRpc({
    name: "disableNotificationsToSlack",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        workspaceId: Schema.string,
    },
    output: {},
});
