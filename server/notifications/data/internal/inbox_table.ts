import {Node} from "prosemirror-model";
import {authorizeChatAccessForAccountIfPossible} from "~/server/chat/data/authorize_chat_access.js";
import {getChatMessagePayload} from "~/server/chat/data/chat_messaging.js";
import {
    getContentReferencesForNode,
    getMessageContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {printContentSingleLineTextSnippetForServer} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    getDocumentCommentPayload,
    getDocumentPreviewIfPossible,
} from "~/server/documents/data/documents_actions.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoGeneralRealtimeTableItemKeyType,
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
    DynamoGeneralRealtimeTableSchemaGetTypes,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {dangerouslyGetPostAuthorWithoutAuthorization} from "~/server/forum/data/dangerously_get_post_author_without_authorization.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getPostAuthorAndChannelPreviewIfPossible} from "~/server/forum/data/get_post_author_and_channel_preview.js";
import {getPostContentWithCustomReferencesAndChannelPreviewIfPossible} from "~/server/forum/data/get_post_content_with_custom_references_and_channel_preview.js";
import {getPostCommentPayload} from "~/server/forum/data/post_messaging.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {
    getNotificationMessageContentSnippet,
    getNotificationPostContentSnippet,
} from "~/server/notifications/core/get_notification_content_snippet.js";
import {ScheduleDateTimeSchema} from "~/server/notifications/core/schedule_date_time.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {getTaskCommentPayload, getTaskOwnerIfPossible} from "~/server/tasks/data/task_table.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString, isDateString} from "~/shared/helpers/date/date_string.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {
    MessageContentPayloadClericalSchema,
    MessagePayload,
    MessageStream,
} from "~/shared/messaging/message_schema.js";
import {
    InboxChannelPostsEntryModel,
    InboxChatEntryModel,
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
    InboxItemModelSchema,
    InboxModel,
    InboxPostCommentsEntryModel,
    InboxTaskEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {MyAccountBroadcastInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_protocol.js";
import {DigestNotificationsScheduleSchema} from "~/shared/notifications/notifications_schedule_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

type InboxTableTypes = DynamoGeneralRealtimeTableSchemaGetTypes<typeof InboxTable>;

export type InboxAttributesItem = MergeObjectIntersection<
    InboxTableTypes["Item"] & {
        readonly partitionType: "Account";
        readonly sortRangeType: "InboxAttributes";
    }
>;

export type InboxEntryItem = MergeObjectIntersection<
    InboxTableTypes["Item"] & (typeof inboxEntryItemTypes)[number]
>;

export type InboxEntryItemKey = MergeObjectIntersection<
    InboxTableTypes["ItemKey"] & (typeof inboxEntryItemTypes)[number]
>;

export type InboxChannelPostsEntryItem = DynamoGeneralRealtimeTableItemType<
    typeof InboxTable,
    "Inbox",
    "ChannelPostsEntry"
>;

export type InboxChannelPostsEntryItemKey = DynamoGeneralRealtimeTableItemKeyType<
    typeof InboxTable,
    "Inbox",
    "ChannelPostsEntry"
>;

export type InboxPostCommentsEntryItem = DynamoGeneralRealtimeTableItemType<
    typeof InboxTable,
    "Inbox",
    "PostCommentsEntry"
>;

export type InboxPostCommentsEntryItemKey = DynamoGeneralRealtimeTableItemKeyType<
    typeof InboxTable,
    "Inbox",
    "PostCommentsEntry"
>;

export type InboxDocumentNewCommentThreadsEntryItem = DynamoGeneralRealtimeTableItemType<
    typeof InboxTable,
    "Inbox",
    "DocumentNewCommentThreadsEntry"
>;

export type InboxDocumentNewCommentThreadsEntryItemKey = DynamoGeneralRealtimeTableItemKeyType<
    typeof InboxTable,
    "Inbox",
    "DocumentNewCommentThreadsEntry"
>;

export type InboxDocumentCommentThreadEntryItem = DynamoGeneralRealtimeTableItemType<
    typeof InboxTable,
    "Inbox",
    "DocumentCommentThreadEntry"
>;

export type InboxDocumentCommentThreadEntryItemKey = DynamoGeneralRealtimeTableItemKeyType<
    typeof InboxTable,
    "Inbox",
    "DocumentCommentThreadEntry"
>;

/**
 * The initial generation of a new inbox.
 */
export const initialInboxGeneration = 0;

const inboxEntryItemTypes = [
    {partitionType: "Inbox", sortRangeType: "ChatEntry"},
    {partitionType: "Inbox", sortRangeType: "PostCommentsEntry"},
    {partitionType: "Inbox", sortRangeType: "ChannelPostsEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentCommentThreadEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentNewCommentThreadsEntry"},
    {partitionType: "Inbox", sortRangeType: "TaskEntry"},
] as const;

export const InboxTable = DynamoGeneralRealtimeTableSchema.new({
    name: "Inbox",
    features: {
        deleteItem: {
            Inbox: {
                // Allow deleting channel post entries. Since when we remove the last post from the
                // entry we want to delete the entire entry. This increases the cost of creating
                // channel post entries by 2 RCU since we need to make sure a gravestone doesn't
                // exist for the item.
                ChannelPostsEntry: true,

                // Allow deleting document new comment threads entries. Since when we remove the
                // last comment thread from the entry we want to delete the entire entry. This
                // increases the cost of creating document new comment threads entries by 2 RCU
                // since we need to make sure a gravestone doesn't exist for the item.
                DocumentNewCommentThreadsEntry: true,
            },
        },
    },
    partitions: [
        {
            name: "Account",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "InboxAttributes",
                    sortKeyAttributes: {
                        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The current inbox generation. This is incremented whenever the inbox is observed
                         * so new entries are always placed above old entries (including old entries with
                         * loud notifications).
                         *
                         * This should only ever increase! Never decrease.
                         */
                        generation: Schema.integer.min(initialInboxGeneration),

                        /**
                         * The number of loud notifications in this inbox. This should be a simple sum of
                         * `loudNotificationCount` in each individual inbox entry.
                         *
                         * This is the number we display next to the user's notification bell in the
                         * product and as the notification badge on native apps.
                         *
                         * `loudNotificationCount` on individual entries will also be displayed on that
                         * entry so you know where the loud notifications are coming from.
                         *
                         * Individual entries should have `loudNotificationCount` set to zero when they are
                         * archived! Archived entries do not contribute to the overall notification
                         * indicators.
                         */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The number of entries in our inbox. Does not count archived entries (entries
                         * with `isArchived: true`).
                         */
                        entryCount: Schema.integer.min(0).default(0),

                        /**
                         * When `entryCount` is set to 0 from a non-zero value, we set this to the current
                         * time. We use this to tell:
                         *
                         * - If the inbox has never had notifications in it this will be `null`
                         * - If the inbox was recently cleared, we don't want to show a notification
                         *   indicator for a while to give the user some peace
                         */
                        lastZeroEntryCountTime: Schema.date.nullable().default(null),

                        /**
                         * This tracks the time when we last updated an entry in the inbox.
                         *
                         * Any kind of update to this inbox's entries will update this value, and we use it
                         * to determine if the contents of the inbox have changed since we last sent a
                         * digest notification.
                         */
                        lastEntryUpdatedTime: Schema.date.nullable().default(null),

                        // NOTE(rmtobin): The following fields are used to track digest notifications.
                        // Ideally they would be grouped into an object, but we don't currently have a way
                        // to index nested objects. If we ever add support for that, we should revisit
                        // this.
                        /**
                         * Tracks when an account opted out of receiving digest notifications. If the
                         * account has not opted out, it will be null.
                         */
                        digestNotificationsOptedOutTime: Schema.date.nullable().default(null),

                        /**
                         * Tracks the relative times this account has scheduled to receive digest
                         * notifications.
                         */
                        digestNotificationsSchedule: DigestNotificationsScheduleSchema,

                        /**
                         * Tracks when this account should next receive a digest email in UTC. This value
                         * is derived from `digestNotificationsSchedule` and the user's time zone at the
                         * time this was calculated. If they are not scheduled to receive a digest, this
                         * value will be null.
                         *
                         * Dates stored in this field have seconds and milliseconds set to 0, in the format
                         * "YYYY-MM-DDTHH:mm:00.000Z".
                         */
                        digestNotificationsNextScheduledDateTime:
                            ScheduleDateTimeSchema.nullable().default(null),

                        /**
                         * Tracks the time we last sent a digest email for this inbox.
                         */
                        digestNotificationsLastSentTime: Schema.date.nullable().default(null),
                    }),
                },
            ],
        },

        /**
         * Users receive a lot of notifications from our product. Mentions in document
         * comment threads, new posts in channels, chat messages, and more. These
         * notifications can be overwhelming to manage so we provide the inbox. A unified
         * home for all notifications the user may care about.
         *
         * The inbox is designed to be intelligent. It leverages computers, which are good
         * at crunching numbers, to distill and summarize all the information a user needs
         * to process. It doesn't blindly add every notification event to the inbox.
         * Instead the inbox groups and sorts entries for the user.
         *
         * Grouping of notifications should be predictable and allow the user to follow
         * consistent workflows. Ranking of notifications can be more black boxed since
         * users don't typically depend on notification ranking. Right now our notification
         * ranking is based on simple heuristics but in the future we may leverage more
         * intelligent recommender systems if we find they benefit the user experience.
         *
         * Some terminology:
         *
         * - Notification event: A notification generating event. For example, creating a
         *   comment on a post. This event will need to go through a fan-out process where
         *   it's delivered to individually subscribed users over their configured
         *   notification channels.
         *
         * - Inbox entry: An entry in a single user's inbox. The user has a different inbox
         *   for every space they are in. Inbox entries are grouped together and may not be
         *   ordered chronologically if some entries are deemed more important than others.
         *   One notification event may update many inbox entries, once for each subscribed
         *   account.
         *
         * - Loud notifications: Loud notifications demand the user's attention. They are
         *   presented as a count in a red circle (like the notification badge on an app)
         *   and placed near the top of the inbox. Mentioning a user or sending them a chat
         *   message creates a loud notification.
         *
         *     The majority of notifications should not be loud notifications! Loud
         *     notifications can be anxiety inducing. It's red which screams "urgent" and
         *     the count gives you a sense of scope to how much work you will need to
         *     address these notifications. We want zero loud notifications to be a
         *     practical state for the user to achieve daily. The count should be
         *     meaningful to a human (unlike when Slack frequently tells you 143 unreads).
         *     Counting individual messages often is not meaningful to a human since your
         *     conversation partner may be using messages to separate individual thoughts
         *     (instead of sentences, common trend among the youngs these days), or you may
         *     be in a group chat where a conversation is happening you're uninterested in.
         *
         *     We will sometimes get it wrong and mark unimportant notifications as loud.
         *     If the user doesn't address a loud notification we think it should decay
         *     over time (fall in order in the inbox or even remove the loud count
         *     completely).
         *
         * - Inbox observation: When a user opens their inbox and continues to look at it
         *   we say the inbox is "observed". We freeze the order of entries in the inbox
         *   when it is observed. While the inbox is unobserved, entries may move around in
         *   unpredictable ways as we use intelligent heuristics/systems to determine
         *   ranking. Inbox order is unknown when unobserved.
         *
         *     At least, this is how the inbox works in theory. In practice, we only
         *     leverage observation as a way to freeze the position of loud notifications.
         *     Loud notifications are always at the top of your inbox. Until the inbox is
         *     observed, then new notifications are added above previous loud
         *     notifications. This effectively "decays" a loud notification. If the user
         *     doesn't address it immediately the notification falls below more relevant
         *     and timely notifications.
         *
         * - Inbox generation: The inbox generation is an integer counter that we use for
         *   segmenting different "stratas" of the inbox. Inbox entries are ranked first by
         *   generation and then by the time they entered the inbox. We put entries with
         *   loud notifications in a higher generation than entries without loud
         *   notifications. When the inbox is observed, the inbox generation counter
         *   increases and new entries are put above loud notifications. See
         *   `observeInboxGenerationIncrement` and related constants for a deeper
         *   understanding of how we create these inbox stratas.
         *
         * - Inbox archive: The user manually clears entries from their inbox instead of
         *   entries being automatically cleared when they view them. The user may either
         *   manually click a button to mark the entry as done or take an action on the
         *   entry. (Like leaving a comment or adding a reaction.)
         *
         * ## Table layout
         *
         * The table is partitioned by inbox. Each account has an inbox for every space
         * they are in. The inbox contains an attributes item which contains metadata for
         * the entire inbox and inbox entries. The inbox entries are not sorted within this
         * partition. The table is designed to have unique, accessible, keys for each inbox
         * entry. So when a notification event happens it can be added to the appropriate
         * entry.
         *
         * Then we have an index which provides the inbox entries in the correct sort
         * order. The index (called `InboxEntriesIndex`) copies the entire item into the
         * index. While this does double storage requirements for the inbox it's necessary
         * to both be able to uniquely address inbox entries and to fetch the full inbox
         * entry items without multiple partition hops. We have more documentation on this
         * index on the `InboxEntriesIndex` definition.
         */
        {
            name: "Inbox",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "ChatEntry",
                    sortKeyAttributes: {
                        chatId: DynamoKeyAttributeSchema.id<ChatId>(),
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(initialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's
                         * `Attributes` item.
                         */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The last message `createdTime` we sent a loud notification count for. We use
                         * this to only send one loud notification every couple minutes for chat messages.
                         */
                        lastLoudNotificationCountTime: Schema.date.nullable().default(null),

                        /**
                         * The last message in the chat. Will be used to render a preview of the chat on
                         * the entry before the user clicks in.
                         *
                         * `isStickyMention` means the message contains a mention and we want to keep it as
                         * the `latestMessage` until there's either a new mention or this inbox entry is
                         * archived.
                         */
                        latestMessage: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            isStickyMention: Schema.boolean.default(false),
                            clerical: MessageContentPayloadClericalSchema.optional(),
                        }),

                        /**
                         * If the chat was archived by a message or reaction on a message then this will be
                         * set to the message's index. Check this to make sure you don't unarchive when
                         * processing an older message.
                         */
                        latestArchivingMessageIndex: Schema.integer.nullable().default(null),

                        /**
                         * Another account in the chat. May or may not have sent a message to the chat. If
                         * the chat has three members this will always be the member that's not the owner
                         * of the inbox or the `lastMessage` author.
                         *
                         * If the chat has more than three members this will usually be the member who left
                         * a message before `latestMessage` or someone who was picked arbitrarily.
                         */
                        otherAccountId: Schema.id<AccountId>().nullable().default(null),
                    }),
                },
                {
                    name: "PostCommentsEntry",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(initialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's
                         * `Attributes` item.
                         */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The time the post was created.
                         */
                        postCreatedTime: Schema.date
                            // For inbox entries created before we had the `postCreatedTime` property, use a
                            // mock time smaller than future times.
                            .default(new Date("2023-05-08T17:34:17.801Z")),

                        /**
                         * Is this inbox entry for a mention in a post's content? If you're mentioned in a
                         * post's content we create a `PostCommentsEntry` that continues to be updated as
                         * people add comments to the post.
                         *
                         * Will be true when this entry is initially created. Will be set to false once the
                         * user archives the post by responding with a comment. After that point this inbox
                         * entry will be about new comments.
                         */
                        isForPostContentMention: Schema.boolean.default(
                            // NOTE(calebmer, 2025-11-02): We used to inline post content in this inbox entry
                            // when an account was mentioned (in the property `postContentSnippetIfMentioned`).
                            // However, if the post content was updated we didn't update the inbox entry. We're
                            // switching to loading post content on read so we can always show the latest post
                            // content. So migrate from the old format by checking for a
                            // `postContentSnippetIfMentioned` property.
                            item => item.postContentSnippetIfMentioned !== null,
                        ),

                        /**
                         * The last comment on the post. Will be used to render a preview of the post on
                         * the entry before the user clicks in.
                         *
                         * `isStickyMention` means the message contains a mention and we want to keep it as
                         * the `latestMessage` until there's either a new mention or this inbox entry is
                         * archived.
                         *
                         * Should only be null when `isForPostContentMention` is true. In which case this
                         * entry reads something like "Alice mentioned you in their post..." instead of
                         * "Alice commented on your post..."
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            isStickyMention: Schema.boolean.default(false),
                        }).nullable(),

                        /**
                         * If the post was archived by a comment or reaction on a comment then this will be
                         * set to the comment's index. Check this to make sure you don't unarchive when
                         * processing an older message.
                         */
                        latestArchivingCommentIndex: Schema.integer.nullable().default(null),

                        /**
                         * A second commenting account which we'll show on the inbox entry to imply a
                         * conversation between multiple users. We compute this as the account which
                         * commented before `latestComment`. Will never be the same account as the
                         * `latestComment`'s author.
                         */
                        otherCommentAuthorId: Schema.id<AccountId>().nullable().default(null),

                        /**
                         * If true then the next time we update this entry we'll also try archiving the
                         * corresponding `ChannelPostsEntry` again. `unarchiveInboxChannelPostsEntryPost()`
                         * sets this to true.
                         */
                        archiveChannelPostsEntryAgain: Schema.value(true).optional(),
                    }),
                },
                {
                    name: "ChannelPostsEntry",
                    sortKeyAttributes: {
                        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),

                        /**
                         * While we are at this inbox generation, new posts will be bucketed into this
                         * entry. When the generation advances new posts will fall into a new entry.
                         *
                         * When loading the posts from this entry to show to the client we freeze this
                         * entry so no new `postIds` can be added. We do this by observing the inbox as a
                         * side effect which means new posts will fall into a new `bucketGeneration`.
                         *
                         * By doing this, the client doesn't have to subscribe to realtime updates for this
                         * inbox entry's `postIds` list. Since whatever data they read is guaranteed to be
                         * frozen.
                         */
                        bucketGeneration: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(initialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,

                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's
                         * `Attributes` item.
                         *
                         * Should never have loud notifications in a channel post aggregation inbox entry.
                         * If we want a loud notification for a post we'll create a new entry.
                         */
                        loudNotificationCount: Schema.integer.min(0).max(0),

                        /**
                         * The posts in this inbox entry. In reverse chronological order. The newest posts
                         * appear first.
                         *
                         * We archive individual posts by removing them from this map and creating an
                         * archived `PostCommentsEntry`. If you archive the last post in this entry then we
                         * delete the `ChannelPostsEntry` itself.
                         */
                        posts: Schema.map(
                            Schema.id<PostId>(),
                            Schema.object({
                                isArchived: Schema.boolean,
                                authorId: Schema.id<AccountId>(),
                                createdTime: Schema.date,
                            }),
                        ).minSize(1),

                        /**
                         * The `createdTime` of the last post to be added to this inbox entry. We don't
                         * change this property if the last added post is later removed (since the last
                         * added post was archived).
                         *
                         * We use this as the `enteredTime` for the inbox entry which is why it needs to
                         * stay the same even as posts are removed.
                         */
                        lastAddedPostCreatedTime: Schema.date.default(item => {
                            assert(isObject(item.latestPost));
                            assert(typeof item.latestPost.createdTime === "string");
                            assert(isDateString(item.latestPost.createdTime));
                            return deserializeDateString(item.latestPost.createdTime);
                        }),
                    }).validation("At least one post must not be archived", item =>
                        iterableSome(item.posts.values(), post => !post.isArchived),
                    ),
                },
                {
                    name: "DocumentCommentThreadEntry",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(initialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's
                         * `Attributes` item.
                         */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The author of the first comment in the thread.
                         */
                        firstCommentAuthorId: Schema.id<AccountId>(),

                        /**
                         * The last comment on the thread. Will be used to render a preview of the thread
                         * on the entry before the user clicks in.
                         *
                         * `isStickyMention` means the message contains a mention and we want to keep it as
                         * the `latestMessage` until there's either a new mention or this inbox entry is
                         * archived.
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            isStickyMention: Schema.boolean.default(false),
                        }),

                        /**
                         * If the document comment thread was archived by a comment or reaction on a
                         * comment then this will be set to the comment's index. Check this to make sure
                         * you don't unarchive when processing an older message.
                         */
                        latestArchivingCommentIndex: Schema.integer.nullable().default(null),

                        /**
                         * A second commenting account which we'll show on the inbox entry to imply a
                         * conversation between multiple users. We compute this as the account which
                         * commented before `latestComment`. Will never be the same account as the
                         * `latestComment`'s author.
                         */
                        otherCommentAuthorId: Schema.id<AccountId>().nullable(),

                        /**
                         * True when the entry is created after deleting the `DocumentCommentThreadId` from
                         * `DocumentNewCommentThreadsEntry`. Set to false when a new comment revives the
                         * entry from the archive.
                         */
                        isFromNewCommentThread: Schema.boolean.default(false),

                        /**
                         * If true then the next time we update this entry we'll also try archiving the
                         * corresponding `DocumentNewCommentThreadsEntry` again.
                         * `unarchiveInboxDocumentNewCommentThreadsEntryCommentThread()` sets this to true.
                         */
                        archiveNewCommentThreadsEntryAgain: Schema.value(true).optional(),
                    }),
                },
                {
                    name: "DocumentNewCommentThreadsEntry",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),

                        /**
                         * While we are at this inbox generation, new comment threads will be bucketed into
                         * this entry. When the generation advances new threads will fall into a new entry.
                         */
                        bucketGeneration: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(initialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,

                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's
                         * `Attributes` item.
                         *
                         * Should never have loud notifications in a document comment thread aggregation
                         * inbox entry. If we want a loud notification for a document comment we'll create
                         * a new entry.
                         */
                        loudNotificationCount: Schema.integer.min(0).max(0),

                        /**
                         * The comment threads in this inbox entry. In reverse chronological order. The
                         * newest comment threads appear first.
                         *
                         * We archive individual comment threads by removing them from this map and
                         * creating an archived `DocumentCommentThreadEntry`. If you archive the last
                         * comment thread in this entry then we delete the `DocumentNewCommentThreadsEntry`
                         * itself.
                         */
                        commentThreads: Schema.map(
                            Schema.id<DocumentCommentThreadId>(),
                            Schema.object({
                                isArchived: Schema.boolean,
                                authorId: Schema.id<AccountId>(),
                                createdTime: Schema.date,
                            }),
                        ).minSize(1),

                        /**
                         * The time the latest comment thread was added.
                         */
                        lastAddedCommentThreadCreatedTime: Schema.date.originalPropertyKey(
                            "latestCommentThreadCreatedTime",
                        ),
                    }).validation("At least one comment thread must not be archived", item =>
                        iterableSome(
                            item.commentThreads.values(),
                            commentThread => !commentThread.isArchived,
                        ),
                    ),
                },
                {
                    name: "TaskEntry",
                    sortKeyAttributes: {
                        taskId: DynamoKeyAttributeSchema.id<TaskId>(),
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(initialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's
                         * `Attributes` item.
                         */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The last comment on the task. Will be used to render a preview of the task on
                         * the entry before the user clicks in.
                         *
                         * `isStickyMention` means the comment contains a mention and we want to keep it as
                         * the `latestComment` until there's either a new mention or this inbox entry is
                         * archived.
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            isStickyMention: Schema.boolean,
                        }),

                        /**
                         * If the task was archived by a comment or reaction on a comment then this will be
                         * set to the comment's index. Check this to make sure you don't unarchive when
                         * processing an older message.
                         */
                        latestArchivingCommentIndex: Schema.integer.nullable().default(null),

                        /**
                         * A second commenting account which we'll show on the inbox entry to imply a
                         * conversation between multiple users. We compute this as the account which
                         * commented before `latestComment`. Will never be the same account as the
                         * `latestComment`'s author.
                         */
                        otherCommentAuthorId: Schema.id<AccountId>().nullable().default(null),
                    }),
                },
            ],
        },
    ],
    modelSchema: InboxItemModelSchema,
    models: {
        Account: {
            InboxAttributes: {
                async build(context, item) {
                    return new InboxModel({
                        spaceId: item.spaceId,
                        accountId: item.accountId,
                        loudNotificationCount: item.loudNotificationCount,
                        entryCount: item.entryCount,
                        lastZeroEntryCountTime: item.lastZeroEntryCountTime,
                        digestNotificationsOptedOutTime: item.digestNotificationsOptedOutTime,
                        digestNotificationsSchedule: item.digestNotificationsSchedule,
                    });
                },
            },
        },
        Inbox: {
            ChatEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [
                            author,
                            authorizationResult,
                            otherChatAccount,
                            contentTextSnippetResult,
                        ] = await runAllPromises([
                            getAccount(context, item.spaceId, item.latestMessage.authorId),
                            authorizeChatAccessForAccountIfPossible(
                                context,
                                item.chatId,
                                item.accountId,
                                "View",
                            ),
                            item.otherAccountId
                                ? getAccount(context, item.spaceId, item.otherAccountId)
                                : null,

                            // Don't throw if actor lost access to chat (which we check earlier with
                            // `authorizeChatAccessForAccountIfPossible()`).
                            captureResultPromise(
                                getChatMessagePayload(context, {
                                    chatId: item.chatId,
                                    messageIndex: item.latestMessage.index,
                                }).then(message =>
                                    printNotificationMessageContentSnippet(
                                        context,
                                        item.spaceId,
                                        message,
                                        "message",
                                    ),
                                ),
                            ),
                        ]);

                        return new InboxChatEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            chatId: item.chatId,
                            definition: authorizationResult.ok
                                ? authorizationResult.value.definition.type !== "Room"
                                    ? authorizationResult.value.definition
                                    : {
                                          type: "Room",
                                          isPrivate: false,
                                          name: authorizationResult.value.definition.name,
                                      }
                                : // We assume if chat authorization fails then we're dealing with a chat room. Only
                                  // chat rooms can change who has access at the moment.
                                  {type: "Room", isPrivate: true},
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            latestMessage: {
                                author,
                                createdTime: item.latestMessage.createdTime,
                                contentTextSnippet: authorizationResult.ok
                                    ? // If the actor lost access to the chat room then don't show them the latest
                                      // message snippet. They may have already seen this content in a push notification
                                      // so it's not necessarily a permissions violation to show it again but a user
                                      // removing another user's access from a chat room would probably expect the
                                      // content to be hidden.
                                      //
                                      // We continue returning the author, created time, and whether the last comment was
                                      // a mention because the user has already theoretically seen these things (via push
                                      // notification) and otherwise the notification loses all structure.
                                      unwrapResult(contentTextSnippetResult)
                                    : "",
                                isStickyMention: item.latestMessage.isStickyMention,
                                clerical: item.latestMessage.clerical,
                            },
                            otherChatAccount,
                        });
                    });
                },
            },
            PostCommentsEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [
                            {hasPostAccess, channel, postAuthor, postContentTextSnippet},
                            otherCommentAuthor,
                            latestComment,
                        ] = await runAllPromises([
                            (!item.isForPostContentMention && item.latestComment
                                ? getPostAuthorAndChannelPreviewIfPossible(context, item.postId)
                                : getPostContentWithCustomReferencesAndChannelPreviewIfPossible(
                                      context,
                                      item.postId,
                                      async (context, spaceId, post) => {
                                          const [author, contentTextSnippet] = await runAllPromises(
                                              [
                                                  getAccount(context, spaceId, post.authorId),
                                                  printNotificationPostContentSnippet(
                                                      context,
                                                      spaceId,
                                                      item.postId,
                                                      post.content,
                                                  ),
                                              ],
                                          );

                                          return {author, contentTextSnippet};
                                      },
                                  )
                            ).then(async postResult => {
                                // The post should exist if we have an inbox entry for it.
                                assert(postResult);

                                if (postResult.ok) {
                                    return {
                                        hasPostAccess: true,
                                        channel: {
                                            isPrivate: false as const,
                                            channel: postResult.value.channel,
                                        },
                                        postAuthor:
                                            "content" in postResult.value
                                                ? postResult.value.content.author
                                                : postResult.value.author,
                                        postContentTextSnippet:
                                            "content" in postResult.value
                                                ? postResult.value.content.contentTextSnippet
                                                : null,
                                    };
                                } else {
                                    return {
                                        hasPostAccess: false,
                                        channel: {isPrivate: true as const},
                                        // If an account has `PostCommentsEntry` in their inbox then that means at one
                                        // point in time they had access to the post and were subscribed to the post. And
                                        // at one point in time they knew who the post author was. Given the post author
                                        // never changes we're ok showing the actor the post author again even though
                                        // they've lost access to the post.
                                        //
                                        // That way the inbox entry retains some structure even after the account has lost
                                        // access to the channel a post was in.
                                        postAuthor:
                                            await dangerouslyGetPostAuthorWithoutAuthorization(
                                                context,
                                                item.postId,
                                            ),
                                        postContentTextSnippet: null,
                                    };
                                }
                            }),

                            item.otherCommentAuthorId
                                ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                                : null,

                            item.latestComment
                                ? runAllObjectPromises({
                                      comment: item.latestComment,
                                      author: getAccount(
                                          context,
                                          item.spaceId,
                                          item.latestComment.authorId,
                                      ),
                                      // Don't throw if actor lost access to document (which we check earlier with
                                      // `getPostAuthorAndChannelPreviewIfPossible()`).
                                      contentTextSnippetResult: captureResultPromise(
                                          getPostCommentPayload(context, {
                                              postId: item.postId,
                                              commentIndex: item.latestComment.index,
                                          }).then(message =>
                                              printNotificationMessageContentSnippet(
                                                  context,
                                                  item.spaceId,
                                                  message,
                                                  "comment",
                                              ),
                                          ),
                                      ),
                                  })
                                : null,
                        ]);

                        return new InboxPostCommentsEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            postId: item.postId,
                            channel,
                            postAuthor,
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            postCreatedTime: item.postCreatedTime,
                            postContentTextSnippet:
                                // If the actor lost access to the post then don't show them the post content
                                // snippet. They may have already seen this content in a push notification so it's
                                // not necessarily a permissions violation to show it again but a user removing
                                // another user's access from a channel would probably expect the content to be
                                // hidden.
                                hasPostAccess && postContentTextSnippet !== null
                                    ? postContentTextSnippet
                                    : null,
                            isForPostContentMention: item.isForPostContentMention,
                            latestComment: latestComment
                                ? {
                                      author: latestComment.author,
                                      createdTime: latestComment.comment.createdTime,
                                      contentTextSnippet: hasPostAccess
                                          ? // If the actor lost access to the post then don't show them the latest comment
                                            // snippet. They may have already seen this content in a push notification so it's
                                            // not necessarily a permissions violation to show it again but a user removing
                                            // another user's access from a channel would probably expect the content to be
                                            // hidden.
                                            //
                                            // We continue returning the author, created time, and whether the last comment was
                                            // a mention because the user has already theoretically seen these things (via push
                                            // notification) and otherwise the notification loses all structure.
                                            unwrapResult(latestComment.contentTextSnippetResult)
                                          : "",
                                      isStickyMention: latestComment.comment.isStickyMention,
                                  }
                                : null,
                            otherCommentAuthor,
                        });
                    });
                },
            },
            ChannelPostsEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [latestPostId, latestPost] = assertExists(
                            Array.from(item.posts)
                                .reverse()
                                .find(([, post]) => !post.isArchived),
                        );

                        const postAuthorIds = new Set(
                            filterMapIterable(item.posts.values(), post =>
                                !post.isArchived ? post.authorId : undefined,
                            ),
                        );

                        const otherPostAuthorId = iterableFind(
                            postAuthorIds,
                            authorId => authorId !== latestPost.authorId,
                        );

                        const [latestPostAuthor, otherPostAuthor, postResult] =
                            await runAllPromises([
                                getAccount(context, item.spaceId, latestPost.authorId),
                                otherPostAuthorId
                                    ? getAccount(context, item.spaceId, otherPostAuthorId)
                                    : null,
                                getPostContentWithCustomReferencesAndChannelPreviewIfPossible(
                                    context,
                                    latestPostId,
                                    async (context, spaceId, post) => {
                                        const [author, contentTextSnippet] = await runAllPromises([
                                            getAccount(context, spaceId, post.authorId),
                                            printNotificationPostContentSnippet(
                                                context,
                                                spaceId,
                                                latestPostId,
                                                post.content,
                                            ),
                                        ]);
                                        return {author, contentTextSnippet};
                                    },
                                ),
                            ]);

                        return new InboxChannelPostsEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            channel: postResult.value
                                ? {isPrivate: false, channel: postResult.value.channel}
                                : {isPrivate: true, channelId: item.channelId},
                            bucketGeneration: item.bucketGeneration,
                            postAuthorCount: postAuthorIds.size,
                            postIds: new Set(
                                filterMapIterable(item.posts, ([postId, post]) =>
                                    !post.isArchived ? postId : undefined,
                                ),
                            ),
                            latestPost: {
                                author: latestPostAuthor,
                                createdTime: latestPost.createdTime,
                                contentTextSnippet:
                                    postResult.value?.content.contentTextSnippet ?? "",
                            },
                            otherPostAuthor,
                        });
                    });
                },
            },
            DocumentCommentThreadEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [
                            documentResult,
                            firstCommentAuthor,
                            latestCommentAuthor,
                            otherCommentAuthor,
                            contentTextSnippetResult,
                        ] = await runAllPromises([
                            getDocumentPreviewIfPossible(context, item.documentId),
                            getAccount(context, item.spaceId, item.firstCommentAuthorId),
                            getAccount(context, item.spaceId, item.latestComment.authorId),
                            item.otherCommentAuthorId
                                ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                                : null,

                            // Don't throw if actor lost access to document (which we check earlier with
                            // `getDocumentPreviewIfPossible()`).
                            captureResultPromise(
                                getDocumentCommentPayload(context, {
                                    documentId: item.documentId,
                                    commentThreadId: item.commentThreadId,
                                    commentIndex: item.latestComment.index,
                                }).then(message =>
                                    printNotificationMessageContentSnippet(
                                        context,
                                        item.spaceId,
                                        message,
                                        "comment",
                                    ),
                                ),
                            ),
                        ]);

                        // The document referenced by our inbox entry must exist. Even after deleting
                        // documents we leave a stub.
                        assert(documentResult);

                        return new InboxDocumentCommentThreadEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            document: documentResult.ok
                                ? {isPrivate: false, document: documentResult.value}
                                : {isPrivate: true, documentId: item.documentId},
                            commentThreadId: item.commentThreadId,
                            firstCommentAuthor,
                            latestComment: {
                                author: latestCommentAuthor,
                                createdTime: item.latestComment.createdTime,
                                contentTextSnippet: documentResult.ok
                                    ? // If the actor lost access to the document then don't show them the latest comment
                                      // snippet. They may have already seen this content in a push notification so it's
                                      // not necessarily a permissions violation to show it again but a user removing
                                      // another user's access from a document would probably expect the content to be
                                      // hidden.
                                      //
                                      // We continue returning the author, created time, and whether the last comment was
                                      // a mention because the user has already theoretically seen these things (via push
                                      // notification) and otherwise the notification loses all structure.
                                      unwrapResult(contentTextSnippetResult)
                                    : "",
                                isStickyMention: item.latestComment.isStickyMention,
                            },
                            otherCommentAuthor,
                            isFromNewCommentThread: item.isFromNewCommentThread,
                        });
                    });
                },
            },
            DocumentNewCommentThreadsEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [firstCommentThreadId, firstCommentThread] = assertExists(
                            iterableFind(
                                item.commentThreads,
                                ([, commentThread]) => !commentThread.isArchived,
                            ),
                        );

                        const commentThreadAuthorIds = new Set(
                            filterMapIterable(item.commentThreads.values(), commentThread =>
                                !commentThread.isArchived ? commentThread.authorId : undefined,
                            ),
                        );

                        const otherCommentThreadAuthorId = iterableFind(
                            commentThreadAuthorIds,
                            authorId => authorId !== firstCommentThread.authorId,
                        );

                        const [
                            documentResult,
                            firstCommentThreadAuthor,
                            otherCommentThreadAuthor,
                            contentTextSnippetResult,
                        ] = await runAllPromises([
                            getDocumentPreviewIfPossible(context, item.documentId),
                            getAccount(context, item.spaceId, firstCommentThread.authorId),
                            otherCommentThreadAuthorId
                                ? getAccount(context, item.spaceId, otherCommentThreadAuthorId)
                                : null,

                            // Don't throw if actor lost access to document (which we check earlier with
                            // `getDocumentPreviewIfPossible()`).
                            captureResultPromise(
                                getDocumentCommentPayload(context, {
                                    documentId: item.documentId,
                                    commentThreadId: firstCommentThreadId,
                                    commentIndex: 0,
                                }).then(message =>
                                    printNotificationMessageContentSnippet(
                                        context,
                                        item.spaceId,
                                        message,
                                        "comment",
                                    ),
                                ),
                            ),
                        ]);

                        // The document referenced by our inbox entry must exist. Even after deleting
                        // documents we leave a stub.
                        assert(documentResult);

                        return new InboxDocumentNewCommentThreadsEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            document: documentResult.ok
                                ? {isPrivate: false, document: documentResult.value}
                                : {isPrivate: true, documentId: item.documentId},
                            bucketGeneration: item.bucketGeneration,
                            commentThreadAuthorCount: commentThreadAuthorIds.size,
                            commentThreadIds: new Set(
                                filterMapIterable(
                                    item.commentThreads,
                                    ([commentThreadId, commentThread]) =>
                                        !commentThread.isArchived ? commentThreadId : undefined,
                                ),
                            ),
                            firstCommentThread: {
                                author: firstCommentThreadAuthor,
                                createdTime: firstCommentThread.createdTime,
                                contentTextSnippet:
                                    documentResult.ok && contentTextSnippetResult
                                        ? // If the actor lost access to the document then don't show them the latest comment
                                          // snippet. They may have already seen this content in a push notification so it's
                                          // not necessarily a permissions violation to show it again but a user removing
                                          // another user's access from a document would probably expect the content to be
                                          // hidden.
                                          //
                                          // We continue returning the author, created time, and whether the last comment was
                                          // a mention because the user has already theoretically seen these things (via push
                                          // notification) and otherwise the notification loses all structure.
                                          unwrapResult(contentTextSnippetResult)
                                        : "",
                            },
                            otherCommentThreadAuthor,
                        });
                    });
                },
            },

            // The Task owner object is either the assignee or creator of the task. Since tasks
            // can be reassigned the "owner" of the task can constantly change over time.
            TaskEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [
                            taskOwnerResult,
                            latestCommentAuthor,
                            otherCommentAuthor,
                            contentTextSnippetResult,
                        ] = await runAllPromises([
                            getTaskOwnerIfPossible(context, item.taskId),
                            getAccount(context, item.spaceId, item.latestComment.authorId),
                            item.otherCommentAuthorId
                                ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                                : null,

                            // Don't throw if actor lost access to document (which we check earlier with
                            // `getTaskOwnerIfPossible()`).
                            captureResultPromise(
                                getTaskCommentPayload(context, {
                                    taskId: item.taskId,
                                    commentIndex: item.latestComment.index,
                                }).then(message =>
                                    printNotificationMessageContentSnippet(
                                        context,
                                        item.spaceId,
                                        message,
                                        "comment",
                                    ),
                                ),
                            ),
                        ]);

                        return new InboxTaskEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            task: !taskOwnerResult.ok
                                ? {isPrivate: true, taskId: item.taskId}
                                : {
                                      isPrivate: false,
                                      taskId: item.taskId,
                                      taskOwner: taskOwnerResult.value,
                                  },
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            latestComment: {
                                author: latestCommentAuthor,
                                createdTime: item.latestComment.createdTime,
                                contentTextSnippet: taskOwnerResult.ok
                                    ? // If the actor lost access to the task then don't show them the latest comment
                                      // snippet. They may have already seen this content in a push notification so it's
                                      // not necessarily a permissions violation to show it again but a user removing
                                      // another user's access from a task would probably expect the content to be
                                      // hidden.
                                      //
                                      // We continue returning the author, created time, and whether the last comment was
                                      // a mention because the user has already theoretically seen these things (via push
                                      // notification) and otherwise the notification loses all structure.
                                      unwrapResult(contentTextSnippetResult)
                                    : "",
                                isStickyMention: item.latestComment.isStickyMention,
                            },
                            otherCommentAuthor,
                        });
                    });
                },
            },
        },
    },
    broadcastEventTransaction: async (context, eventTransaction) => {
        // Split up event transactions by unique `SpaceId` and `AccountId` combinations. By
        // splitting a transaction it may not be applied atomically. We split by
        // `AccountId` since events need to go to different durable objects.
        //
        // Having a transaction across two accounts or two spaces isn't theoretically
        // impossible but would be weird and doesn't currently happen in practice.
        const eventTransactionBySpaceIdAndAccountId = new Map<
            `${SpaceId}:${AccountId}`,
            Array<DynamoGeneralRealtimeEvent<SchemaType<typeof InboxItemModelSchema>>>
        >();

        await runAllPromises(
            mapIterable(eventTransaction, async ({itemKey, getEvent}) => {
                // It's safe to use `context` to load the event (even if `context` is a system
                // context). Since in the `models` object above we always call
                // `protectInboxEntryModelBuilder()` to make sure we're building an inbox entry
                // with the right actor.
                const event = await getEvent(context);

                getOrSetDefaultMapValue(
                    eventTransactionBySpaceIdAndAccountId,
                    `${itemKey.spaceId}:${itemKey.accountId}`,
                    () => [],
                ).push(event);
            }),
        );

        await runAllPromises(
            Array.from(
                eventTransactionBySpaceIdAndAccountId,
                async ([spaceIdAndAccountId, eventTransaction]) => {
                    const [spaceId, accountId] = spaceIdAndAccountId.split(":");
                    assert(spaceId && isId<SpaceId>(spaceId));
                    assert(accountId && isId<AccountId>(accountId));

                    await context.edge.broadcastToDurableObject(
                        `/api/durable-objects/my-account/${accountId}/broadcast-inbox-realtime-event-transaction`,
                        {
                            serviceName: "MyAccountService",
                            route: "/api/durable-objects/my-account/:accountId/broadcast-inbox-realtime-event-transaction",
                            body: MyAccountBroadcastInboxRealtimeEventTransactionSchema.serialize({
                                eventTransaction,
                            }),
                        },
                    );
                },
            ),
        );
    },
});

/**
 * First, see the documentation on the `Inbox` partition of `NotificationsTable` to
 * help understand the purpose of this index.
 *
 * In short, inbox entries are NOT ordered in `Inbox` partitions of the
 * notifications table. But when the user views their index they should only see
 * unarchived entries and the entries should be in a meaningful order.
 *
 * Inbox entries are not ordered in `Inbox` partitions because inbox entries need
 * to be uniquely addressable so we can add to them when a notification event
 * occurs. So this index provides sorting by copying index entries into the
 * appropriate order.
 *
 * ## DynamoDB implementation notes
 *
 * The index is backed by a [DynamoDB global secondary index][1]. This global
 * secondary index has the same partition key as our `Inbox` partition. That means
 * it could be using a [local secondary index][2]! However, a local secondary index
 * puts a size constraint on the `Inbox` partition which needs to grow unbounded.
 * Constantly moving data out of the `Inbox` partition to keep it within the
 * partition bounds would complicate our implementation.
 *
 * The main advantage of a local secondary index is it allows for strongly
 * consistent reads. This is appealing since we need to maintain the inbox in
 * realtime so strongly consistent reads can be helpful for ensuring we don't miss
 * realtime updates. Instead we're going with a realtime implementation that works
 * with eventually consistent initial reads.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html
 * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html
 */
export const InboxEntriesIndex = InboxTable.addExpensiveFullIndex({
    name: "InboxEntries",
    itemTypes: inboxEntryItemTypes,
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {
        /**
         * Has this entry been manually dismissed by the user? When a user interacts with
         * an entry we remove it from their main inbox (but keep it in their inbox archive
         * so they can refer to it later). When a notification event revives an entry it
         * moves out of the archive and back into the main index. This boolean controls
         * that and separates the two in this inbox.
         */
        isArchived: DynamoKeyAttributeSchema.boolean,

        /**
         * What inbox generation does the entry live in? See the terminology explanation of
         * "inbox generations" in the `Inbox` partition documentation.
         *
         * Generations create "stratas" in the inbox. We put all entries at a higher
         * generation first then sort by time.
         */
        generation: DynamoKeyAttributeSchema.integer.reverse(),

        /**
         * When did this entry enter the inbox? This will determine sort order in the
         * inbox. Entries tend to stay at the position they entered the inbox unless a loud
         * notification occurred which will cause us to move the entry up to the top of the
         * inbox.
         */
        enteredTime: DynamoKeyAttributeSchema.date.reverse(),
    },
});

/**
 * This is a sparse index for tracking space accounts that are eligible to receive
 * a digest notification.
 *
 * The time of their next scheduled digest notification is the partition key, which
 * allows us to query for all of the accounts that need to receive a digest
 * notification at a given time. Note that
 * `digestNotificationsNextScheduledDateTime` is in UTC time.
 */
export const NotificationDigestEntriesIndex = InboxTable.addIndexWithoutRealtime({
    name: "NotificationDigestEntries",
    itemTypes: [{partitionType: "Account", sortRangeType: "InboxAttributes"}],
    partitionKeyAttributes: {
        digestNotificationsNextScheduledDateTime:
            DynamoKeyAttributeSchema.ScheduleDateTime.nullable(),
    },
    sortKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
        digestNotificationsOptedOutTime: DynamoKeyAttributeSchema.date.nullable(),
    },
    filter: item =>
        item.digestNotificationsNextScheduledDateTime !== null &&
        item.digestNotificationsOptedOutTime === null,
});

/**
 * When you're building an `InboxEntryModel` it should be with an actor
 * representing the account the inbox entry is for to make sure we don't include
 * data the account with access to the inbox isn't allowed to see!
 *
 * This function throws an error if the wrong account is trying to access an inbox
 * entry and if we have a system actor (e.g. while processing the notification
 * event job) then we impersonate the account associated with the inbox entry to
 * avoid loading data with a system permission level.
 */
function protectInboxEntryModelBuilder<Value>(
    context: ServerActionContext,
    {accountId}: {accountId: AccountId},
    action: (context: ServerActionContext) => Promise<Value>,
): Promise<Value> {
    switch (context.actor.type) {
        case "Anonymous": {
            throw new PermissionDeniedError("Can\u2019t read inbox as an anonymous actor");
        }
        case "System": {
            return impersonateAccountAsSystemContext(
                context.actor.authorizeSystem(),
                accountId,
                action,
            );
        }
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError("Can only read inbox for our own account");
            }
            return action(context);
        }
        case "Bot": {
            throw new InternalError("Bot actors shouldn\u2019t have an inbox");
        }
        default:
            throw exhaustive(context.actor);
    }
}

function getNotificationMessageContentSnippetFromMessage(
    messageNoun: string,
    message: {
        payload: MessagePayload;
        stream: MessageStream | null;
    },
): MessageContent {
    switch (message.payload.type) {
        case "Deleted": {
            return createSimpleMessageContent(`Deleted ${messageNoun}`);
        }
        case "Content": {
            const content: Array<Node> = [];

            if (!isContentEmpty(message.payload.content)) {
                for (const node of message.payload.content.content.content) {
                    content.push(node);
                }
            }

            if (message.stream) {
                for (const part of message.stream.parts) {
                    if (part.payload.type !== "Content") continue;

                    for (const node of part.payload.content.content.content) {
                        content.push(node);
                    }
                }
            }

            return getNotificationMessageContentSnippet(
                assertMessageContent(
                    assertExists(
                        MessageContentProsemirrorSchema.nodes.doc.createAndFill({}, content),
                    ),
                ),
            );
        }
        default:
            throw exhaustive(message.payload);
    }
}

async function printNotificationMessageContentSnippet(
    context: ServerActionContext,
    spaceId: SpaceId,
    message: MessageItem,
    messageNoun: string,
) {
    const doc = getNotificationMessageContentSnippetFromMessage(messageNoun, message);

    const references = await getMessageContentReferencesForNode(context, spaceId, doc);

    return printContentSingleLineTextSnippetForServer({
        doc,
        references,
    });
}

async function printNotificationPostContentSnippet(
    context: ServerActionContext,
    spaceId: SpaceId,
    postId: PostId,
    content: PostContent,
) {
    const doc = getNotificationPostContentSnippet(content);

    const references = await getContentReferencesForNode(
        context,
        spaceId,
        FilePostAuthorizer.bind({type: "Post", postId: postId}),
        doc,
    );

    return printContentSingleLineTextSnippetForServer({
        doc,
        references,
    });
}
