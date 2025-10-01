import {authorizeChatAccessForAccount} from "~/server/chat/data/chat_actions.js";
import {
    getContentReferencesForNode,
    getMessageContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {printContentSingleLineTextSnippetForServer} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_actions.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {
    FilePostAuthorizer,
    dangerouslyGetPostAuthorWithoutAuthorization,
    getChannelPreviewIfPossible,
    getPostAuthorAndChannelPreviewIfPossible,
} from "~/server/forum/data/forum_actions.js";
import {ScheduleDateTimeSchema} from "~/server/notifications/core/schedule_date_time.js";
import {getAccount, impersonateAccountAsSystemContext} from "~/server/spaces/spaces_actions.js";
import {getTaskOwnerIfPossible} from "~/server/tasks/data/task_table.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
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
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadClericalSchema} from "~/shared/messaging/message_schema.js";
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

/**
 * The initial generation of a new inbox.
 */
export const internalInitialInboxGeneration = 0;

export const internalInboxEntryItemTypes = [
    {partitionType: "Inbox", sortRangeType: "ChatEntry"},
    {partitionType: "Inbox", sortRangeType: "PostCommentsEntry"},
    {partitionType: "Inbox", sortRangeType: "ChannelPostsEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentCommentThreadEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentNewCommentThreadsEntry"},
    {partitionType: "Inbox", sortRangeType: "TaskEntry"},
] as const;

export const InboxTable = DynamoGeneralRealtimeTableSchema.new({
    name: "Inbox",
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
                         * The current inbox generation. This is incremented whenever the inbox is
                         * observed so new entries are always placed above old entries (including
                         * old entries with loud notifications).
                         *
                         * This should only ever increase! Never decrease.
                         */
                        generation: Schema.integer.min(internalInitialInboxGeneration),

                        /**
                         * The number of loud notifications in this inbox. This should be a simple sum
                         * of `loudNotificationCount` in each individual inbox entry.
                         *
                         * This is the number we display next to the user's notification bell in the
                         * product and as the notification badge on native apps.
                         *
                         * `loudNotificationCount` on individual entries will also be displayed on that
                         * entry so you know where the loud notifications are coming from.
                         *
                         * Individual entries should have `loudNotificationCount` set to zero when they
                         * are archived! Archived entries do not contribute to the overall notification
                         * indicators.
                         */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The number of entries in our inbox. Does not count archived entries
                         * (entries with `isArchived: true`).
                         */
                        entryCount: Schema.integer.min(0).default(0),

                        /**
                         * When `entryCount` is set to 0 from a non-zero value, we set this to the
                         * current time. We use this to tell:
                         *
                         * - If the inbox has never had notifications in it this will be `null`
                         * - If the inbox was recently cleared, we don't want to show a notification
                         *   indicator for a while to give the user some peace
                         */
                        lastZeroEntryCountTime: Schema.date.nullable().default(null),

                        /**
                         * This tracks the time when we last updated an entry in the inbox.
                         *
                         * Any kind of update to this inbox's entries will update this value, and
                         * we use it to determine if the contents of the inbox have changed since
                         * we last sent a digest notification.
                         */
                        lastEntryUpdatedTime: Schema.date.nullable().default(null),

                        // NOTE(rmtobin): The following fields are used to track digest notifications.
                        // Ideally they would be grouped into an object, but we don't currently
                        // have a way to index nested objects. If we ever add support for that, we
                        // should revisit this.
                        /**
                         * Tracks when an account opted out of receiving digest notifications.
                         * If the account has not opted out, it will be null.
                         */
                        digestNotificationsOptedOutTime: Schema.date.nullable().default(null),

                        /**
                         * Tracks the relative times this account has scheduled to receive digest
                         * notifications.
                         */
                        digestNotificationsSchedule: DigestNotificationsScheduleSchema,

                        /**
                         * Tracks when this account should next receive a digest email in UTC.
                         * This value is derived from `digestNotificationsSchedule` and the user's
                         * time zone at the time this was calculated. If they are not scheduled to
                         * receive a digest, this value will be null.
                         *
                         * Dates stored in this field have seconds and milliseconds set to 0, in
                         * the format "YYYY-MM-DDTHH:mm:00.000Z".
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
         * notifications can be overwhelming to manage so we provide the inbox. A
         * unified home for all notifications the user may care about.
         *
         * The inbox is designed to be intelligent. It leverages computers, which are
         * good at crunching numbers, to distill and summarize all the information a
         * user needs to process. It doesn't blindly add every notification event to
         * the inbox. Instead the inbox groups and sorts entries for the user.
         *
         * Grouping of notifications should be predictable and allow the user to follow
         * consistent workflows. Ranking of notifications can be more black boxed since
         * users don't typically depend on notification ranking. Right now our
         * notification ranking is based on simple heuristics but in the future we may
         * leverage more intelligent recommender systems if we find they benefit the
         * user experience.
         *
         * Some terminology:
         *
         * - Notification event: A notification generating event. For example, creating
         *   a comment on a post. This event will need to go through a fan-out process
         *   where it's delivered to individually subscribed users over their
         *   configured notification channels.
         *
         * - Inbox entry: An entry in a single user's inbox. The user has a different
         *   inbox for every space they are in. Inbox entries are grouped together and
         *   may not be ordered chronologically if some entries are deemed more
         *   important than others. One notification event may update many inbox
         *   entries, once for each subscribed account.
         *
         * - Loud notifications: Loud notifications demand the user's attention. They
         *   are presented as a count in a red circle (like the notification badge on
         *   an app) and placed near the top of the inbox. Mentioning a user or sending
         *   them a chat message creates a loud notification.
         *
         *   The majority of notifications should not be loud notifications! Loud
         *   notifications can be anxiety inducing. It's red which screams "urgent" and
         *   the count gives you a sense of scope to how much work you will need
         *   to address these notifications. We want zero loud notifications to be a
         *   practical state for the user to achieve daily. The count should be
         *   meaningful to a human (unlike when Slack frequently tells you 143
         *   unreads). Counting individual messages often is not meaningful to a human
         *   since your conversation partner may be using messages to separate
         *   individual thoughts (instead of sentences, common trend among the youngs
         *   these days), or you may be in a group chat where a conversation is
         *   happening you're uninterested in.
         *
         *   We will sometimes get it wrong and mark unimportant notifications as loud.
         *   If the user doesn't address a loud notification we think it should decay
         *   over time (fall in order in the inbox or even remove the loud count
         *   completely).
         *
         * - Inbox observation: When a user opens their inbox and continues to look at
         *   it we say the inbox is "observed". We freeze the order of entries in the
         *   inbox when it is observed. While the inbox is unobserved, entries may move
         *   around in unpredictable ways as we use intelligent heuristics/systems to
         *   determine ranking. Inbox order is unknown when unobserved.
         *
         *   At least, this is how the inbox works in theory. In practice, we only
         *   leverage observation as a way to freeze the position of loud
         *   notifications. Loud notifications are always at the top of your inbox.
         *   Until the inbox is observed, then new notifications are added above
         *   previous loud notifications. This effectively "decays" a loud
         *   notification. If the user doesn't address it immediately the notification
         *   falls below more relevant and timely notifications.
         *
         * - Inbox generation: The inbox generation is an integer counter that we use
         *   for segmenting different "stratas" of the inbox. Inbox entries are ranked
         *   first by generation and then by the time they entered the inbox. We put
         *   entries with loud notifications in a higher generation than entries
         *   without loud notifications. When the inbox is observed, the inbox
         *   generation counter increases and new entries are put above loud
         *   notifications. See `observeInboxGenerationIncrement` and related constants
         *   for a deeper understanding of how we create these inbox stratas.
         *
         * - Inbox archive: The user manually clears entries from their inbox instead
         *   of entries being automatically cleared when they view them. The user may
         *   either manually click a button to mark the entry as done or take an action
         *   on the entry. (Like leaving a comment or adding a reaction.)
         *
         * ## Table layout
         *
         * The table is partitioned by inbox. Each account has an inbox for every space
         * they are in. The inbox contains an attributes item which contains metadata
         * for the entire inbox and inbox entries. The inbox entries are not sorted
         * within this partition. The table is designed to have unique, accessible,
         * keys for each inbox entry. So when a notification event happens it can be
         * added to the appropriate entry.
         *
         * Then we have an index which provides the inbox entries in the correct sort
         * order. The index (called `InboxEntriesIndex`) copies the entire item into
         * the index. While this does double storage requirements for the inbox it's
         * necessary to both be able to uniquely address inbox entries and to fetch the
         * full inbox entry items without multiple partition hops. We have more
         * documentation on this index on the `InboxEntriesIndex` definition.
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
                        generation: Schema.integer.min(internalInitialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /** See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item. */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The last message `createdTime` we sent a loud notification count for. We
                         * use this to only send one loud notification every couple minutes for chat
                         * messages.
                         */
                        lastLoudNotificationCountTime: Schema.date.nullable().default(null),

                        /**
                         * The last message in the chat. Will be used to render a preview of the chat
                         * on the entry before the user clicks in.
                         *
                         * `isStickyMention` means the message contains a mention and we want to keep
                         * it as the `latestMessage` until there's either a new mention or this inbox
                         * entry is archived.
                         */
                        latestMessage: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                            isStickyMention: Schema.boolean.default(false),
                            clerical: MessageContentPayloadClericalSchema.optional(),
                        }),

                        /**
                         * If the chat was archived by a message then this will be set to the message's
                         * index. Check this to make sure you don't unarchive when processing an older
                         * message.
                         */
                        latestArchivingMessageIndex: Schema.integer.nullable().default(null),

                        /**
                         * Another account in the chat. May or may not have sent a message to the
                         * chat. If the chat has three members this will always be the member that's
                         * not the owner of the inbox or the `lastMessage` author.
                         *
                         * If the chat has more than three members this will usually be the member who
                         * left a message before `latestMessage` or someone who was picked arbitrarily.
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
                        generation: Schema.integer.min(internalInitialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /** See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item. */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The time the post was created.
                         */
                        postCreatedTime: Schema.date
                            // For inbox entries created before we had the
                            // `postCreatedTime` property, use a mock time smaller than future times.
                            .default(new Date("2023-05-08T17:34:17.801Z")),

                        /**
                         * If the user was mentioned in the post's content this will be set. If this is
                         * set then we override the notification text to say something along the lines
                         * of "You were mentioned in a post".
                         *
                         * We unset this if a new comment revives this entry from the archive. The
                         * entry will now be focused on new comments instead of the mention.
                         */
                        postContentSnippetIfMentioned: PostContentSchema.nullable().default(null),

                        /**
                         * The last comment on the post. Will be used to render a preview of the post
                         * on the entry before the user clicks in.
                         *
                         * `isStickyMention` means the message contains a mention and we want to keep
                         * it as the `latestMessage` until there's either a new mention or this inbox
                         * entry is archived.
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                            isStickyMention: Schema.boolean.default(false),
                        }).nullable(),

                        /**
                         * If the chat was archived by a message then this will be set to the message's
                         * index. Check this to make sure you don't unarchive when processing an older
                         * message.
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
                {
                    name: "ChannelPostsEntry",
                    sortKeyAttributes: {
                        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),

                        /**
                         * While we are at this inbox generation, new posts will be bucketed into this
                         * entry. When the generation advances new posts will fall into a new entry.
                         *
                         * When loading the posts from this entry to show to the client we freeze this
                         * entry so no new `postIds` can be added. We do this by observing the inbox as
                         * a side effect which means new posts will fall into a new `bucketGeneration`.
                         *
                         * By doing this, the client doesn't have to subscribe to realtime updates for
                         * this inbox entry's `postIds` list. Since whatever data they read is
                         * guaranteed to be frozen.
                         */
                        bucketGeneration: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(internalInitialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,

                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item.
                         *
                         * Should never have loud notifications in a channel post aggregation inbox
                         * entry. If we want a loud notification for a post we'll create a new entry.
                         */
                        loudNotificationCount: Schema.integer.min(0).max(0),

                        /**
                         * The posts in this inbox entry. In reverse chronological order. The newest
                         * posts appear first.
                         *
                         * We assume that if you take a slice of this list it will be frozen and
                         * receive no updates. All new posts should be added to the beginning of the
                         * list.
                         */
                        postIds: Schema.set(Schema.id<PostId>()).minSize(1),

                        /**
                         * The authors of posts in this inbox entry. Will have a size less than or
                         * equal to `postIds`. In reverse chronological order. The latest authors to
                         * post will appear first.
                         */
                        postAuthorIds: Schema.set(Schema.id<AccountId>()).minSize(1),

                        /**
                         * A preview of the first post. Will display a preview of the first post's
                         * content in the inbox entry.
                         */
                        latestPost: Schema.object({
                            postId: Schema.id<PostId>().nullable().default(null),
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: PostContentSchema,
                        }),
                    }),
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
                        generation: Schema.integer.min(internalInitialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /** See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item. */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The author of the first comment in the thread.
                         */
                        firstCommentAuthorId: Schema.id<AccountId>(),

                        /**
                         * The last comment on the thread. Will be used to render a preview of the
                         * thread on the entry before the user clicks in.
                         *
                         * `isStickyMention` means the message contains a mention and we want to keep
                         * it as the `latestMessage` until there's either a new mention or this inbox
                         * entry is archived.
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                            isStickyMention: Schema.boolean.default(false),
                        }),

                        /**
                         * If the chat was archived by a message then this will be set to the message's
                         * index. Check this to make sure you don't unarchive when processing an older
                         * message.
                         */
                        latestArchivingCommentIndex: Schema.integer.nullable().default(null),

                        /**
                         * A second commenting account which we'll show on the inbox entry to imply a
                         * conversation between multiple users. We compute this as the account which
                         * commented before `latestComment`. Will never be the same account as the
                         * `latestComment`'s author.
                         */
                        otherCommentAuthorId: Schema.id<AccountId>().nullable(),
                    }),
                },
                {
                    name: "DocumentNewCommentThreadsEntry",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),

                        /**
                         * While we are at this inbox generation, new comment threads will be bucketed
                         * into this entry. When the generation advances new threads will fall into a
                         * new entry.
                         */
                        bucketGeneration: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** See the documentation on `isArchived` in `InboxEntriesIndex`. */
                        isArchived: Schema.boolean,
                        /** See the documentation on `generation` in `InboxEntriesIndex`. */
                        generation: Schema.integer.min(internalInitialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,

                        /**
                         * See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item.
                         *
                         * Should never have loud notifications in a document comment thread
                         * aggregation inbox entry. If we want a loud notification for a document
                         * comment we'll create a new entry.
                         */
                        loudNotificationCount: Schema.integer.min(0).max(0),

                        /**
                         * The comment threads in this inbox entry. In chronological order. The newest
                         * threads appear last.
                         */
                        commentThreadIds: Schema.set(Schema.id<DocumentCommentThreadId>()).minSize(
                            1,
                        ),

                        /**
                         * The first comment author of threads in this inbox entry. Will have a size
                         * less than or equal to `commentThreadIds`. In chronological order. The latest
                         * authors to create threads will appear last.
                         */
                        commentThreadAuthorIds: Schema.set(Schema.id<AccountId>()).minSize(1),

                        /**
                         * A preview of the first comment thread. Will display a preview of the first
                         * comment's content in the inbox entry.
                         */
                        firstComment: Schema.object({
                            commentThreadId: Schema.id<DocumentCommentThreadId>()
                                .nullable()
                                .default(null),
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                        }),

                        /**
                         * The time the latest comment thread was created.
                         */
                        latestCommentThreadCreatedTime: Schema.date,
                    }),
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
                        generation: Schema.integer.min(internalInitialInboxGeneration),
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /** See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item. */
                        loudNotificationCount: Schema.integer.min(0),

                        /**
                         * The last comment on the task. Will be used to render a preview of the task
                         * on the entry before the user clicks in.
                         *
                         * `isStickyMention` means the comment contains a mention and we want to keep
                         * it as the `latestComment` until there's either a new mention or this inbox
                         * entry is archived.
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                            isStickyMention: Schema.boolean,
                        }),

                        /**
                         * If the chat was archived by a message then this will be set to the message's
                         * index. Check this to make sure you don't unarchive when processing an older
                         * message.
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
                        const [author, references, {chatAccountCount}, otherChatAccount] =
                            await runAllPromises([
                                getAccount(context, item.spaceId, item.latestMessage.authorId),
                                getMessageContentReferencesForNode(
                                    context,
                                    item.spaceId,
                                    item.latestMessage.contentSnippet,
                                ),
                                authorizeChatAccessForAccount(
                                    context,
                                    item.chatId,
                                    item.latestMessage.authorId,
                                ),
                                item.otherAccountId
                                    ? getAccount(context, item.spaceId, item.otherAccountId)
                                    : null,
                            ]);

                        return new InboxChatEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            chatId: item.chatId,
                            chatAccountCount,
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            latestMessage: {
                                author,
                                createdTime: item.latestMessage.createdTime,
                                contentTextSnippet: printContentSingleLineTextSnippetForServer({
                                    doc: item.latestMessage.contentSnippet,
                                    references,
                                }),
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
                            {hasPostAccess, channel, postAuthor},
                            latestComment,
                            otherCommentAuthor,
                            postContentSnippetIfMentioned,
                        ] = await runAllPromises([
                            getPostAuthorAndChannelPreviewIfPossible(context, item.postId).then(
                                async postResult => {
                                    // We expect the post referenced by our `PostCommentsEntry` to exist.
                                    assert(postResult);

                                    if (postResult.ok) {
                                        return {
                                            hasPostAccess: true,
                                            channel: {
                                                isPrivate: false as const,
                                                channel: postResult.value.channel,
                                            },
                                            postAuthor: postResult.value.author,
                                        };
                                    } else {
                                        return {
                                            hasPostAccess: false,
                                            channel: {isPrivate: true as const},
                                            // If an account has `PostCommentsEntry` in their inbox then that means at one
                                            // point in time they had access to the post and were subscribed to the post.
                                            // And at one point in time they knew who the post author was. Given the post
                                            // author never changes we're ok showing the actor the post author again even
                                            // though they've lost access to the post.
                                            //
                                            // That way the inbox entry retains some structure even after the account has
                                            // lost access to the channel a post was in.
                                            postAuthor:
                                                await dangerouslyGetPostAuthorWithoutAuthorization(
                                                    context,
                                                    item.postId,
                                                ),
                                        };
                                    }
                                },
                            ),
                            item.latestComment
                                ? runAllObjectPromises({
                                      comment: item.latestComment,
                                      author: getAccount(
                                          context,
                                          item.spaceId,
                                          item.latestComment.authorId,
                                      ),
                                      references: getMessageContentReferencesForNode(
                                          context,
                                          item.spaceId,
                                          item.latestComment.contentSnippet,
                                      ),
                                  })
                                : null,
                            item.otherCommentAuthorId
                                ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                                : null,
                            item.postContentSnippetIfMentioned
                                ? runAllObjectPromises({
                                      doc: item.postContentSnippetIfMentioned,
                                      references: getContentReferencesForNode(
                                          context,
                                          item.spaceId,
                                          FilePostAuthorizer.bind({
                                              type: "Post",
                                              postId: item.postId,
                                          }),
                                          item.postContentSnippetIfMentioned,
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
                            postContentTextSnippetIfMentioned:
                                // If the actor lost access to the post then don't show them the post content
                                // snippet. They may have already seen this content in a push notification so
                                // it's not necessarily a permissions violation to show it again but a user
                                // removing another user's access from a channel would probably expect the
                                // content to be hidden.
                                hasPostAccess && postContentSnippetIfMentioned
                                    ? printContentSingleLineTextSnippetForServer(
                                          postContentSnippetIfMentioned,
                                      )
                                    : null,
                            latestComment: latestComment
                                ? {
                                      author: latestComment.author,
                                      createdTime: latestComment.comment.createdTime,
                                      contentTextSnippet: hasPostAccess
                                          ? // If the actor lost access to the post then don't show them the latest comment
                                            // snippet. They may have already seen this content in a push notification so
                                            // it's not necessarily a permissions violation to show it again but a user
                                            // removing another user's access from a channel would probably expect the
                                            // content to be hidden.
                                            //
                                            // We continue returning the author, created time, and whether the last comment
                                            // was a mention because the user has already theoretically seen these things
                                            // (via push notification) and otherwise the notification loses all structure.
                                            printContentSingleLineTextSnippetForServer({
                                                doc: latestComment.comment.contentSnippet,
                                                references: latestComment.references,
                                            })
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
                        const otherPostAuthorId = iterableFind(
                            item.postAuthorIds,
                            accountId => accountId !== item.latestPost.authorId,
                        );

                        const [
                            channelResult,
                            latestPostAuthor,
                            latestPostContentSnippetReferences,
                            otherPostAuthor,
                        ] = await runAllPromises([
                            getChannelPreviewIfPossible(context, item.channelId),
                            getAccount(context, item.spaceId, item.latestPost.authorId),
                            getContentReferencesForNode(
                                context,
                                item.spaceId,
                                FilePostAuthorizer.bind({
                                    type: "Post",
                                    // NOTE(calebmer, 2024-09-20): `postId` didn't exist on `latestPost` before
                                    // this date. So if we have a channel posts entry where `postId` is null then
                                    // use the first post in `item.postIds` and hope it's right. Getting this wrong
                                    // shouldn't matter since posts created before this date also won't have
                                    // attached files since files weren't implemented yet.
                                    postId:
                                        item.latestPost.postId ??
                                        assertExists(iterableFirst(item.postIds)),
                                }),
                                item.latestPost.contentSnippet,
                            ),
                            otherPostAuthorId
                                ? getAccount(context, item.spaceId, otherPostAuthorId)
                                : null,
                        ]);

                        // Channel must exist if we have a `ChannelPostsEntry` in our inbox.
                        assert(channelResult);

                        return new InboxChannelPostsEntryModel({
                            spaceId: item.spaceId,
                            accountId: item.accountId,
                            loudNotificationCount: item.loudNotificationCount,
                            isArchived: item.isArchived,
                            channel: channelResult.value
                                ? {isPrivate: false, channel: channelResult.value}
                                : {isPrivate: true, channelId: item.channelId},
                            bucketGeneration: item.bucketGeneration,
                            postCount: item.postIds.size,
                            postAuthorCount: item.postAuthorIds.size,
                            latestPost: {
                                author: latestPostAuthor,
                                createdTime: item.latestPost.createdTime,
                                contentTextSnippet: channelResult.ok
                                    ? printContentSingleLineTextSnippetForServer({
                                          doc: item.latestPost.contentSnippet,
                                          references: latestPostContentSnippetReferences,
                                      })
                                    : "",
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
                            latestCommentContentSnippetReferences,
                            otherCommentAuthor,
                        ] = await runAllPromises([
                            getDocumentPreviewIfPossible(context, item.documentId),
                            getAccount(context, item.spaceId, item.firstCommentAuthorId),
                            getAccount(context, item.spaceId, item.latestComment.authorId),
                            getMessageContentReferencesForNode(
                                context,
                                item.spaceId,
                                item.latestComment.contentSnippet,
                            ),
                            item.otherCommentAuthorId
                                ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                                : null,
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
                                    ? // If the actor lost access to the document then don't show them the latest
                                      // comment snippet. They may have already seen this content in a push
                                      // notification so it's not necessarily a permissions violation to show it
                                      // again but a user removing another user's access from a document would
                                      // probably expect the content to be hidden.
                                      //
                                      // We continue returning the author, created time, and whether the last comment
                                      // was a mention because the user has already theoretically seen these things
                                      // (via push notification) and otherwise the notification loses all structure.
                                      printContentSingleLineTextSnippetForServer({
                                          doc: item.latestComment.contentSnippet,
                                          references: latestCommentContentSnippetReferences,
                                      })
                                    : "",
                                isStickyMention: item.latestComment.isStickyMention,
                            },
                            otherCommentAuthor,
                        });
                    });
                },
            },
            DocumentNewCommentThreadsEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const otherCommentThreadAuthorId = iterableFind(
                            item.commentThreadAuthorIds,
                            accountId => accountId !== item.firstComment.authorId,
                        );

                        const [
                            documentResult,
                            firstCommentAuthor,
                            firstCommentContentSnippetReferences,
                            otherCommentThreadAuthor,
                        ] = await runAllPromises([
                            getDocumentPreviewIfPossible(context, item.documentId),
                            getAccount(context, item.spaceId, item.firstComment.authorId),
                            getMessageContentReferencesForNode(
                                context,
                                item.spaceId,
                                item.firstComment.contentSnippet,
                            ),
                            otherCommentThreadAuthorId
                                ? getAccount(context, item.spaceId, otherCommentThreadAuthorId)
                                : null,
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
                            commentThreadCount: item.commentThreadIds.size,
                            commentThreadAuthorCount: item.commentThreadAuthorIds.size,
                            firstComment: {
                                author: firstCommentAuthor,
                                createdTime: item.firstComment.createdTime,
                                contentTextSnippet: documentResult.ok
                                    ? // If the actor lost access to the document then don't show them the latest
                                      // comment snippet. They may have already seen this content in a push
                                      // notification so it's not necessarily a permissions violation to show it
                                      // again but a user removing another user's access from a document would
                                      // probably expect the content to be hidden.
                                      //
                                      // We continue returning the author, created time, and whether the last comment
                                      // was a mention because the user has already theoretically seen these things
                                      // (via push notification) and otherwise the notification loses all structure.
                                      printContentSingleLineTextSnippetForServer({
                                          doc: item.firstComment.contentSnippet,
                                          references: firstCommentContentSnippetReferences,
                                      })
                                    : "",
                            },
                            otherCommentThreadAuthor,
                        });
                    });
                },
            },

            // The Task owner object is either the assignee or creator of the task. Since
            // tasks can be reassigned the "owner" of the task can constantly change over time.
            TaskEntry: {
                build(context, item) {
                    return protectInboxEntryModelBuilder(context, item, async context => {
                        const [taskOwnerResult, latestComment, otherCommentAuthor] =
                            await runAllPromises([
                                getTaskOwnerIfPossible(context, item.taskId),
                                runAllObjectPromises({
                                    comment: item.latestComment,
                                    author: getAccount(
                                        context,
                                        item.spaceId,
                                        item.latestComment.authorId,
                                    ),
                                    references: getMessageContentReferencesForNode(
                                        context,
                                        item.spaceId,
                                        item.latestComment.contentSnippet,
                                    ),
                                }),
                                item.otherCommentAuthorId
                                    ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                                    : null,
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
                                author: latestComment.author,
                                createdTime: latestComment.comment.createdTime,
                                contentTextSnippet: taskOwnerResult.ok
                                    ? // If the actor lost access to the task then don't show them the latest
                                      // comment snippet. They may have already seen this content in a push
                                      // notification so it's not necessarily a permissions violation to show it
                                      // again but a user removing another user's access from a task would
                                      // probably expect the content to be hidden.
                                      //
                                      // We continue returning the author, created time, and whether the last comment
                                      // was a mention because the user has already theoretically seen these things
                                      // (via push notification) and otherwise the notification loses all structure.
                                      printContentSingleLineTextSnippetForServer({
                                          doc: latestComment.comment.contentSnippet,
                                          references: latestComment.references,
                                      })
                                    : "",
                                isStickyMention: latestComment.comment.isStickyMention,
                            },
                            otherCommentAuthor,
                        });
                    });
                },
            },
        },
    },
    broadcastEventTransaction: async (context, readTime, eventTransaction) => {
        // Split up event transactions by unique `SpaceId` and `AccountId`
        // combinations. By splitting a transaction it may not be applied atomically.
        // We split by `AccountId` since events need to go to different durable
        // objects.
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
                                readTime,
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
 * First, see the documentation on the `Inbox` partition of `NotificationsTable`
 * to help understand the purpose of this index.
 *
 * In short, inbox entries are NOT ordered in `Inbox` partitions of the
 * notifications table. But when the user views their index they should only
 * see unarchived entries and the entries should be in a meaningful order.
 *
 * Inbox entries are not ordered in `Inbox` partitions because inbox entries
 * need to be uniquely addressable so we can add to them when a notification
 * event occurs. So this index provides sorting by copying index entries into
 * the appropriate order.
 *
 * ## DynamoDB implementation notes
 *
 * The index is backed by a [DynamoDB global secondary index][1]. This global
 * secondary index has the same partition key as our `Inbox` partition. That
 * means it could be using a [local secondary index][2]! However, a local
 * secondary index puts a size constraint on the `Inbox` partition which needs
 * to grow unbounded. Constantly moving data out of the `Inbox` partition to
 * keep it within the partition bounds would complicate our implementation.
 *
 * The main advantage of a local secondary index is it allows for strongly
 * consistent reads. This is appealing since we need to maintain the inbox in
 * realtime so strongly consistent reads can be helpful for ensuring we don't
 * miss realtime updates. Instead we're going with a realtime implementation
 * that works with eventually consistent initial reads.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html
 * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html
 */
export const InboxEntriesIndex = InboxTable.addExpensiveFullIndex({
    name: "InboxEntries",
    itemTypes: internalInboxEntryItemTypes,
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {
        /**
         * Has this entry been manually dismissed by the user? When a user interacts
         * with an entry we remove it from their main inbox (but keep it in their inbox
         * archive so they can refer to it later). When a notification event revives an
         * entry it moves out of the archive and back into the main index. This boolean
         * controls that and separates the two in this inbox.
         */
        isArchived: DynamoKeyAttributeSchema.boolean,

        /**
         * What inbox generation does the entry live in? See the terminology
         * explanation of "inbox generations" in the `Inbox` partition documentation.
         *
         * Generations create "stratas" in the inbox. We put all entries at a higher
         * generation first then sort by time.
         */
        generation: DynamoKeyAttributeSchema.integer.reverse(),

        /**
         * When did this entry enter the inbox? This will determine sort order in the
         * inbox. Entries tend to stay at the position they entered the inbox unless a
         * loud notification occurred which will cause us to move the entry up to the
         * top of the inbox.
         */
        enteredTime: DynamoKeyAttributeSchema.date.reverse(),
    },
});

/**
 * This is a sparse index for tracking space accounts that are eligible to receive a digest
 * notification.
 *
 * The time of their next scheduled digest notification is the partition key, which
 * allows us to query for all of the accounts that need to receive a digest notification at a given time.
 * Note that `digestNotificationsNextScheduledDateTime` is in UTC time.
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
 * representing the account the inbox entry is for to make sure we don't
 * include data the account with access to the inbox isn't allowed to see!
 *
 * This function throws an error if the wrong account is trying to access an
 * inbox entry and if we have a system actor (e.g. while processing
 * the notification event job) then we impersonate the account associated with
 * the inbox entry to avoid loading data with a system permission level.
 */
function protectInboxEntryModelBuilder<Value>(
    context: ServerActionContext,
    {accountId}: {accountId: AccountId},
    action: (context: ServerActionContext) => Promise<Value>,
): Promise<Value> {
    switch (context.actor.type) {
        case "Anonymous": {
            throw new PermissionDeniedError("Can’t read inbox as an anonymous actor");
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
            throw new InternalError("Bot actors shouldn’t have an inbox");
        }
        default:
            throw exhaustive(context.actor);
    }
}
