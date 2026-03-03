import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoTableItemKeyType,
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {PendingSubtleNotificationStubSchema} from "~/server/notifications/data/internal/push/pending_subtle_notification_stub.js";
import {
    AccountId,
    BrowserId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {WebPushSubscriptionSchema} from "~/shared/notifications/web_push_subscription.js";
import {Schema} from "~/shared/schema/schema.js";

// Regular DynamoDB table for any data regarding notifications that does not need
// to be updated on the client in realtime. `InboxTable` is where all the data for
// an account's inbox is stored because that data needs to update on the client in
// realtime.
export const NotificationsTable = DynamoTableSchema.new({
    name: "Notifications",
    partitions: [
        {
            name: "Inbox",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                // This is a reverse index from `PostId` to `ChannelPostsEntry` in `InboxTable`. So
                // we can easily check whether a given `PostId` is present in a channel posts inbox
                // entry.
                //
                // Once a `PostInChannelPostsEntry` item has been created, it will never be
                // deleted. Since we never delete `postIds` from a `ChannelPostsEntry`.
                {
                    name: "PostInChannelPostsEntry",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        channelPostsEntry: Schema.object({
                            channelId: Schema.id<ChannelId>(),
                            bucketGeneration: Schema.integer,
                        }).nullable(),
                    }),
                },

                // This is a reverse index from `DocumentId` + `DocumentCommentThreadId` to
                // `DocumentNewCommentThreadsEntry` in `InboxTable`. So we can easily check whether
                // a given comment thread is present in a new comment threads inbox entry.
                //
                // Once a `DocumentCommentThreadInNewCommentThreadsEntry` item has been created, it
                // will never be deleted. Since we never delete `commentThreadIds` from a
                // `DocumentNewCommentThreadsEntry`.
                {
                    name: "DocumentCommentThreadInNewCommentThreadsEntry",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: Schema.object({
                        newCommentThreadsEntry: Schema.object({
                            bucketGeneration: Schema.integer,
                        }).nullable(),
                    }),
                },

                // This tracks subtle notifications whose sending has been delayed until they can
                // be sent as a batch in a single notification. This is used for web push
                // notifications specifically as otherwise these notifications can be very noisy.
                {
                    name: "PendingSubtleNotifications",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        lastUpdatedTime: Schema.date.nullable().default(null),
                        hasPendingSubtleNotifications: Schema.boolean.default(false),
                        pendingSubtleNotifications: Schema.map(
                            // This string should be a unique identifier for the associated inbox entry item
                            // for a subtle notification. It is used to ensure that updating the pending subtle
                            // notification list is idempotent.
                            Schema.string,
                            PendingSubtleNotificationStubSchema,
                        ).default(new Map()),
                    }),
                },
            ],
        },
        {
            name: "PushTargets",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                /**
                 * Slack integrations are used to send Slack notifications to the a user's linked
                 * Slack workspace. There must be an associated `SlackWorkspaceIntegration` and
                 * `SlackUser` items for the account ID and workspace ID in the `IntegrationsTable`
                 * for us to send notifications to the user's Slack workspace.
                 *
                 * Slack workspaces are per-space, and currently we only support one Slack
                 * workspace per space. If a Slack workspace or user is removed, this item should
                 * be deleted.
                 */
                {
                    name: "SlackIntegration",
                    sortKeyAttributes: {
                        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                        workspaceId: DynamoKeyAttributeSchema.labelString<string>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                        lastUpdatedTime: Schema.date,
                        slackUserId: Schema.string,
                    }),
                },

                /**
                 * Web push subscriptions are used to send web push notifications to the user's
                 * browser.
                 *
                 * By default, all of an account's spaces will receive push notifications for a
                 * given browser. Opting out of receiving web push notifications for a space
                 * applies only to a particular browser, meaning they will still receive web push
                 * notifications for that space on a different device unless they have also opted
                 * out on that device.
                 *
                 * Each `browserId` and `subscription.endpoint` pair should be unique (excl. null),
                 * as each browser instance can only be subscribed to one endpoint at a time.
                 *
                 * The `subscription` object will be null if the user had previously subscribed to
                 * web push, but is no longer subscribed and should not receive notifications for
                 * that browser. This may be because they've removed notification permissions in
                 * their browser, they've signed out of the account on that device, or the
                 * subscription has expired. We keep this record in case the user re-subscribes on
                 * the same device to preserve their previously opted out spaces.
                 */
                {
                    name: "WebPushSubscription",
                    sortKeyAttributes: {
                        browserId: DynamoKeyAttributeSchema.id<BrowserId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                        lastUpdatedTime: Schema.date,
                        subscription: WebPushSubscriptionSchema.nullable(),
                        optedOutSpaceIds: Schema.set(Schema.id<SpaceId>()).default(new Set()),
                    }),
                },

                /**
                 * Apple device tokens are an anonymous identifier for a device + app pair. It is
                 * the address to which we send push notifications. Only one user is signed in on a
                 * device at a time but a user may sign out of the account on their device then
                 * sign in to another.
                 *
                 * When the user signs out of an account we invalidate the device token with
                 * Apple's Push Notification service (APNs) but don't remove it from the database.
                 * Invalidating the device token means even if we send notifications the device
                 * won't show them. When a new user signs in we update the device token in the
                 * database with the new `AccountId`.
                 */
                {
                    name: "AppleDeviceToken",
                    sortKeyAttributes: {
                        deviceToken: DynamoKeyAttributeSchema.bytes(32),
                    },
                    attributes: Schema.object({}),
                },
            ],
        },
    ],
});

// Reverse index to get all space accounts with pending subtle notifications.
// Everything is in a single partition so we can get all at once. This likely won't
// scale past some number of accounts, at which time we'll need to bucket this into
// multiple partitions.
export const PendingSubtleNotificationsIndex = NotificationsTable.addIndex({
    name: "PendingSubtleNotificationsIndex",
    itemTypes: [{partitionType: "Inbox", sortRangeType: "PendingSubtleNotifications"}],
    partitionKeyAttributes: {
        hasPendingSubtleNotifications: DynamoKeyAttributeSchema.boolean,
    },
    sortKeyAttributes: {
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
    },
    filter: item => item.hasPendingSubtleNotifications === true,
});

export type PendingSubtleNotificationsItem = DynamoTableItemType<
    typeof NotificationsTable,
    "Inbox",
    "PendingSubtleNotifications"
>;

export type InboxPostInChannelPostsEntryItemKey = DynamoTableItemKeyType<
    typeof NotificationsTable,
    "Inbox",
    "PostInChannelPostsEntry"
>;

export type InboxDocumentCommentThreadInNewCommentThreadsEntryItemKey = DynamoTableItemKeyType<
    typeof NotificationsTable,
    "Inbox",
    "DocumentCommentThreadInNewCommentThreadsEntry"
>;

export type SlackIntegrationItem = DynamoTableItemType<
    typeof NotificationsTable,
    "PushTargets",
    "SlackIntegration"
>;

export type WebPushSubscriptionItem = DynamoTableItemType<
    typeof NotificationsTable,
    "PushTargets",
    "WebPushSubscription"
>;

export type AppleDeviceTokenItem = DynamoTableItemType<
    typeof NotificationsTable,
    "PushTargets",
    "AppleDeviceToken"
>;

export type PushTargetItem = SlackIntegrationItem | WebPushSubscriptionItem | AppleDeviceTokenItem;
