import {differenceInMinutes} from "date-fns";
import {Node} from "prosemirror-model";
import {deleteAccountAppleDeviceTokenIfExists} from "~/server/accounts/accounts_table.js";
import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {
    FileChatAuthorizer,
    authorizeChatAccessForAccount,
    authorizeChatAccessIfPossible,
    getChatAccountIds,
} from "~/server/chat/data/chat_table.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    getContentReferencesForNode,
    getMessageContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {printContentSingleLineTextSnippetForServer} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {ContentContextModuleBase} from "~/server/context/content_context_module_base.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerActionContextModules,
    ServerImpersonatedAccountActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {
    ServerContentActionContext,
    ServerContentSessionActionContext,
    ServerContentSystemActionContext,
} from "~/server/context/server_content_action_context.js";
import {
    FileDocumentAuthorizer,
    authorizeDocumentAccessIfPossible,
    getDocumentAndCommentThreadsWithInitialComments,
    getDocumentCommentAuthorId,
    getDocumentCommentThreadNotificationSubscribers,
    getDocumentPreview,
    getDocumentPreviewIfPossible,
} from "~/server/documents/data/documents_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {dynamoClientRequestTokenMaxLength} from "~/server/dynamo/core/dynamo_max_client_request_token_length.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    DynamoGeneralRealtimeTableSchema,
    DynamoGeneralRealtimeTableSchemaGetTypes,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {FileAuthorizer} from "~/server/files/data/files_table.js";
import {
    FilePostAuthorizer,
    authorizePostAccessIfPossible,
    dangerouslyGetPostAuthorWithoutAuthorization,
    getChannelNotificationSubscribers,
    getChannelPreview,
    getChannelPreviewIfPossible,
    getPost,
    getPostAndInitialComments,
    getPostAuthorAndChannelPreview,
    getPostAuthorAndChannelPreviewIfPossible,
    getPostNotificationSubscribers,
} from "~/server/forum/data/forum_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {
    NotificationCreateChatMessageEvent,
    NotificationCreateDocumentCommentEvent,
    NotificationCreatePostCommentEvent,
    NotificationCreatePostEvent,
    NotificationCreateTaskCommentEvent,
    NotificationEvent,
} from "~/server/notifications/core/notification_event.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {
    authorizeSpaceAccess,
    getAccount,
    getRegisteredAccountDevices,
    impersonateAccountAsSystemContext,
    isAccountMemberOfSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_table.js";
import {
    FileTaskAuthorizer,
    authorizeTaskAccessIfPossible,
    getTaskNotificationSubscribers,
    getTaskOwnerIfPossible,
} from "~/server/tasks/data/task_table.js";
import {EdgeServiceContextModuleBase} from "~/server/tokens/edge_service_context_module.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {isTextEndedWithPunctuation} from "~/shared/content/print_content_single_line_text_snippet.js";
import {Context} from "~/shared/context/context.js";
import {printPrettyNumber} from "~/shared/design/print_pretty_number.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {NotFoundError} from "~/shared/error/error.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Locale, defaultLocale} from "~/shared/helpers/intl/locale.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {generateId, isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    ContentMentionAccountId,
    DocumentCommentThreadId,
    DocumentId,
    NotificationEventId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {MessageContent, MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessageContentPayloadClerical,
    MessageContentPayloadClericalSchema,
} from "~/shared/messaging/message_model.js";
import {
    InboxChannelPostsEntryModel,
    InboxChatEntryModel,
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
    InboxEntryKey,
    InboxEntryModel,
    InboxItemModelSchema,
    InboxModel,
    InboxPostCommentsEntryModel,
    InboxTaskEntryModel,
    getInboxEntryKeyPath,
} from "~/shared/notifications/inbox_model.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/notifications/min_message_view_timestamp_divider_elapsed_minutes.js";
import {MyAccountBroadcastInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_protocol.js";
import {truncateDocumentTitleForNotification} from "~/shared/notifications/truncate_document_title_for_notification.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type InboxActionExtraBroadcastContextModules = {
    edge: EdgeServiceContextModuleBase;
    content: ContentContextModuleBase;
    opensearch: OpensearchContextModule;
    files: FilesContextModuleBase;
    r2: CloudflareR2ContextModule;
};

export type InboxActionContextModulesWithBroadcast = ServerActionContextModules &
    InboxActionExtraBroadcastContextModules;

export type InboxActionContextWithBroadcast = Context<InboxActionContextModulesWithBroadcast>;

export type InboxSessionActionContextModulesWithBroadcast = ServerSessionActionContextModules &
    InboxActionExtraBroadcastContextModules;

export type InboxSessionActionContextWithBroadcast =
    Context<InboxSessionActionContextModulesWithBroadcast>;

export type InboxSystemActionContextModulesWithBroadcast = ServerSystemActionContextModules &
    InboxActionExtraBroadcastContextModules;

export type InboxSystemActionContextWithBroadcast =
    Context<InboxSystemActionContextModulesWithBroadcast>;

/**
 * The initial generation of a new inbox.
 */
const initialInboxGeneration = 0;

const InboxTable = DynamoGeneralRealtimeTableSchema.new({
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
                        generation: Schema.integer.min(initialInboxGeneration),

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
                // TODO(calebmer, 2024-06-13): We've moved the inbox attributes item from this
                // partition into an `Account` partition so we can query all inboxes for an
                // account at once. This item definition still exists to maintain backwards
                // compatibility but shouldn't be used. Once we fully migrate all inbox items
                // we can remove this.
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        generation: Schema.integer.min(initialInboxGeneration),
                        loudNotificationCount: Schema.integer.min(0),
                        entryCount: Schema.integer.min(0).default(0),
                        lastZeroEntryCountTime: Schema.date.nullable().default(null),
                    }),
                },

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
                        generation: Schema.integer.min(initialInboxGeneration),
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
                        generation: Schema.integer.min(initialInboxGeneration),
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
                        generation: Schema.integer.min(initialInboxGeneration),
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
                        generation: Schema.integer.min(initialInboxGeneration),
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
                        generation: Schema.integer.min(initialInboxGeneration),
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
                    });
                },
            },
        },
        Inbox: {
            Attributes: {
                async build(context, item) {
                    return new InboxModel({
                        spaceId: item.spaceId,
                        accountId: item.accountId,
                        loudNotificationCount: item.loudNotificationCount,
                        entryCount: item.entryCount,
                        lastZeroEntryCountTime: item.lastZeroEntryCountTime,
                    });
                },
            },
            ChatEntry: {
                async build(context, item) {
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
                },
            },
            PostCommentsEntry: {
                async build(context, item) {
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
                                      FilePostAuthorizer.bind({type: "Post", postId: item.postId}),
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
                },
            },
            ChannelPostsEntry: {
                async build(context, item) {
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
                },
            },
            DocumentCommentThreadEntry: {
                async build(context, item) {
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
                },
            },
            DocumentNewCommentThreadsEntry: {
                async build(context, item) {
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
                },
            },

            // The Task owner object is either the assignee or creator of the task. Since
            // tasks can be reassigned the "owner" of the task can constantly change over time.
            TaskEntry: {
                async build(context, item) {
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

        for (const eventEntry of eventTransaction) {
            getOrSetDefaultMapValue(
                eventTransactionBySpaceIdAndAccountId,
                `${eventEntry.itemKey.spaceId}:${eventEntry.itemKey.accountId}`,
                () => [],
            ).push(eventEntry.event);
        }

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

const inboxEntryItemTypes = [
    {partitionType: "Inbox", sortRangeType: "ChatEntry"},
    {partitionType: "Inbox", sortRangeType: "PostCommentsEntry"},
    {partitionType: "Inbox", sortRangeType: "ChannelPostsEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentCommentThreadEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentNewCommentThreadsEntry"},
    {partitionType: "Inbox", sortRangeType: "TaskEntry"},
] as const;

type InboxTableTypes = DynamoGeneralRealtimeTableSchemaGetTypes<typeof InboxTable>;

type InboxAttributesItem = MergeObjectIntersection<
    InboxTableTypes["Item"] & {
        readonly partitionType: "Account";
        readonly sortRangeType: "InboxAttributes";
    }
>;

type InboxEntryItem = MergeObjectIntersection<
    InboxTableTypes["Item"] & (typeof inboxEntryItemTypes)[number]
>;

type InboxEntryItemKey = MergeObjectIntersection<
    InboxTableTypes["ItemKey"] & (typeof inboxEntryItemTypes)[number]
>;

/**
 * Move inbox attribute items from their old destination to their new destination.
 */
export async function runMoveInboxAttributesItemMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    for await (const initialLegacyItem of InboxTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "Inbox", sortRangeType: "Attributes"}],
    })) {
        if (
            initialLegacyItem.partitionType !== "Inbox" ||
            initialLegacyItem.sortRangeType !== "Attributes"
        ) {
            break;
        }

        let hasAlreadyAttempted = false;

        await context.dynamo.retryTransaction(async context => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            const legacyItem = isInitialAttempt
                ? initialLegacyItem
                : await InboxTable.getItemIfExists(
                      context,
                      {
                          partitionType: "Inbox",
                          sortRangeType: "Attributes",
                          spaceId: initialLegacyItem.spaceId,
                          accountId: initialLegacyItem.accountId,
                      },
                      {consistency: "Strong"},
                  );
            if (!legacyItem) return;

            await DynamoTableSchema.executeTransaction(context, [
                InboxTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
                    {
                        ...legacyItem,
                        partitionType: "Account",
                        sortRangeType: "InboxAttributes",
                    },
                ),
                InboxTable.transactionDangerouslyDeleteItemWithoutGravestoneAndWithoutEvent(
                    legacyItem,
                ),
            ]);
        });
    }
}

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
const InboxEntriesIndex = InboxTable.addExpensiveFullIndex({
    name: "InboxEntries",
    itemTypes: inboxEntryItemTypes,
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
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in test environments.
 */
export function getInboxEntriesIndexForTest() {
    assert(process.env.NODE_ENV === "test");
    return InboxEntriesIndex;
}

/**
 * When the inbox is observed, we increment the inbox's generation counter by
 * this amount. New entries will use the generation from the inbox's generation
 * counter.
 *
 * This value is higher than `loudNotificationInboxGenerationIncrement`. Loud
 * notifications add that value to the inbox's generation counter so that loud
 * notifications are at the top of the inbox. When the inbox is observed we
 * therefore need to move the inbox generation counter past this intermediate
 * generation.
 */
const observeInboxGenerationIncrement = 2;

/**
 * For inbox entries with loud notifications we add this value to the inbox's
 * generation counter to determine the generation of the inbox entry. This puts
 * inbox entries with loud notifications above all other entries that use the
 * inbox's generation counter unmodified.
 *
 * When we observe the inbox we need to increment the inbox's generation
 * counter past the intermediate generation used by loud notifications so that
 * new entries are placed at the top of the inbox.
 */
const loudNotificationInboxGenerationIncrement = 1;

/**
 * When we unarchive inbox entries we want to put them at the top of the inbox.
 * Even above inbox entries with loud notifications! We do this, currently, by
 * putting them at the same generation as loud notifications. The `enteredTime`
 * of the unarchived entry will be higher than the ones for loud notifications
 * so the entry goes at the top.
 */
const unarchivedInboxEntryGenerationIncrement = 1;

function getInitialInboxItem(spaceId: SpaceId, accountId: AccountId): InboxAttributesItem {
    return {
        partitionType: "Account",
        sortRangeType: "InboxAttributes",
        spaceId,
        accountId,
        generation: initialInboxGeneration,
        loudNotificationCount: 0,
        entryCount: 0,
        lastZeroEntryCountTime: null,
    };
}

/**
 * Get the session account's inbox in the provided space.
 */
export async function getInbox(
    context: InboxSessionActionContextWithBroadcast,
    {spaceId, consistency = "Eventual"}: {spaceId: SpaceId; consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<InboxModel>> {
    await authorizeSpaceAccess(context, spaceId);

    return context.dynamo.retryTransaction(async context => {
        const inbox = await InboxTable.getRealtimeItemIfExists(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId: context.actor.getAccountId(),
            },
            {consistency},
        );
        if (inbox) return inbox;

        // If the inbox item doesn't exist yet, let's create one.
        const {getEvent} = await InboxTable.createItem(
            context,
            getInitialInboxItem(spaceId, context.actor.getAccountId()),
            // By default condition check errors from `createItem()` call won't retry. Make
            // sure we handle race conditions by retrying on condition check error.
            {isConditionCheckErrorRetriable: true},
        );

        return (await getEvent(context)).item;
    });
}

/**
 * Get all of the session actor's inboxes for all the spaces they're in.
 * Inboxes are stored in the same DynamoDB partition so it's one DynamoDB query
 * to load them all.
 *
 * You must provide a list of the account's `SpaceId`s so we can filter out
 * inboxes for spaces the actor has lost access to.
 */
export async function getOurAccountInboxes(
    context: ServerContentSessionActionContext,
    spaceIds: ReadonlySet<SpaceId>,
): Promise<ReadonlyArray<DynamoGeneralRealtimeItem<InboxModel>>> {
    const inboxes = await parallelMapAsyncIterableToArray(
        InboxTable.query(context, {
            partitionKey: {partitionType: "Account", accountId: context.actor.getAccountId()},
            startSortKey: {
                sortRangeType: "InboxAttributes",
                spaceId: DynamoKeyAttributeSchema.id.getMinValue<SpaceId>(),
            },
            endSortKey: {
                sortRangeType: "InboxAttributes",
                spaceId: DynamoKeyAttributeSchema.id.getMaxValue<SpaceId>(),
            },
            limit: "All",
        }),
        async item => {
            // Confirm the account is still a member of this space. If an account is
            // removed from a space we don't clean up their inbox item in case they're
            // re-added.
            if (!spaceIds.has(item.spaceId)) return null;

            return InboxTable.buildRealtimeItem(context, item);
        },
    );

    return inboxes.filter(isNonNullable);
}

/**
 * Get the entries for the current account's inbox.
 */
export async function getInboxEntries(
    context: ServerContentSessionActionContext,
    {
        spaceId,
        filter,
        limit,
        afterCursor,
    }: {
        spaceId: SpaceId;
        filter: "New" | "Archive";
        limit: number;
        afterCursor: DynamoIndexCursor | null;
    },
): Promise<DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>> {
    await authorizeSpaceAccess(context, spaceId);

    const result = await InboxEntriesIndex.realtimeQuery(context, {
        partitionKey: {
            spaceId,
            accountId: context.actor.getAccountId(),
        },
        startSortKey:
            filter === "Archive"
                ? {
                      isArchived: true,
                      generation: InboxEntriesIndex.sortKeyAttributes.generation.minValue,
                      enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.minValue,
                  }
                : undefined,
        endSortKey:
            filter === "New"
                ? {
                      isArchived: false,
                      generation: InboxEntriesIndex.sortKeyAttributes.generation.maxValue,
                      enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
                  }
                : undefined,
        limit,
        paginate: {type: "FromStart", afterCursor},
    });

    // In test environments, if we've fetched all non-archived entries from the
    // inbox then test the inbox attributes item has the correct entry count.
    //
    // This works because we have a lot of Jest notification tests that load all
    // un-archived inbox entries.
    if (
        process.env.NODE_ENV === "test" &&
        filter === "New" &&
        afterCursor === null &&
        (result.pageInfo.type === "FromStart"
            ? !result.pageInfo.hasNextPage
            : !result.pageInfo.hasPreviousPage)
    ) {
        const inboxItem = await InboxTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId: context.actor.getAccountId(),
        });

        assert(
            (inboxItem?.entryCount ?? 0) === result.items.length,
            "Expected inbox item’s `entryCount` to have the correct number of non-archived inbox entries",
        );

        assert(
            (inboxItem?.loudNotificationCount ?? 0) ===
                result.items.reduce(
                    (loudNotificationCount, item) =>
                        loudNotificationCount + item.model.loudNotificationCount,
                    0,
                ),
            "Expected inbox item’s `loudNotificationCount` to be the sum of all non-archived inbox entry loud notification counts",
        );
    }

    return result;
}

/**
 * Get a single inbox for the actor based on the provided key.
 */
export async function getInboxEntry(
    context: ServerContentSessionActionContext,
    {
        spaceId,
        key,
        consistency,
    }: {
        spaceId: SpaceId;
        key: InboxEntryKey;
        consistency?: DynamoReadConsistency;
    },
): Promise<DynamoGeneralRealtimeItem<InboxEntryModel>> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await InboxTable.getRealtimeItem(
        context,
        getInboxEntryItemKey({spaceId, accountId: context.actor.getAccountId(), key}),
        {consistency},
    );

    return item;
}

/**
 * Backfill any inbox entry updates between now and `readTime`. Use when you
 * connect to realtime after reading data to make sure you haven't missed
 * any updates.
 *
 * This will backfill updates both for non-archived and archived entries.
 */
export async function backfillInboxEntries(
    context: ServerContentSessionActionContext,
    {spaceId, readTime}: {spaceId: SpaceId; readTime: Date},
): Promise<DynamoGeneralRealtimeBackfillResult<InboxEntryModel>> {
    await authorizeSpaceAccess(context, spaceId);

    return InboxEntriesIndex.backfillRealtimeQuery(context, {
        partitionKey: {
            spaceId,
            accountId: context.actor.getAccountId(),
        },
        readTime,
    });
}

/**
 * Mark the current account's inbox as observed. Any loud notifications will
 * freeze in place at this point.
 */
// TODO(calebmer): It's a little weird that we observe the inbox only when it
// opens. That means inbox entries accumulate as if the inbox is unobserved
// while the user is staring it in realtime. We should probably change this to
// a model of "user is observing" and if the user is observing we increment the
// inbox generation on basically every update. This means new inbox entries
// will be directly added to the top of the inbox while the user is actively
// observing.
export async function observeInbox(
    context: InboxSessionActionContextWithBroadcast,
    {spaceId}: {spaceId: SpaceId},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    await InboxTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= getInitialInboxItem(spaceId, context.actor.getAccountId());
            return observeInboxItem(item);
        },
    );
}

function observeInboxItem(item: InboxAttributesItem) {
    return {
        ...item,
        generation: item.generation + observeInboxGenerationIncrement,
    };
}

function getInboxEntryItemKey({
    spaceId,
    accountId,
    key,
}: {
    spaceId: SpaceId;
    accountId: AccountId;
    key: InboxEntryKey;
}): InboxEntryItemKey {
    switch (key.type) {
        case "Chat": {
            return {
                partitionType: "Inbox",
                sortRangeType: "ChatEntry",
                spaceId,
                accountId,
                chatId: key.chatId,
            };
        }
        case "PostComments": {
            return {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId,
                accountId,
                postId: key.postId,
            };
        }
        case "ChannelPosts": {
            return {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId,
                accountId,
                channelId: key.channelId,
                bucketGeneration: key.bucketGeneration,
            };
        }
        case "DocumentCommentThread": {
            return {
                partitionType: "Inbox",
                sortRangeType: "DocumentCommentThreadEntry",
                spaceId,
                accountId,
                documentId: key.documentId,
                commentThreadId: key.commentThreadId,
            };
        }
        case "DocumentNewCommentThreads": {
            return {
                partitionType: "Inbox",
                sortRangeType: "DocumentNewCommentThreadsEntry",
                spaceId,
                accountId,
                documentId: key.documentId,
                bucketGeneration: key.bucketGeneration,
            };
        }
        case "Task": {
            return {
                partitionType: "Inbox",
                sortRangeType: "TaskEntry",
                spaceId,
                accountId,
                taskId: key.taskId,
            };
        }
        default:
            throw exhaustive(key);
    }
}

function getInboxEntryKey(itemKey: InboxEntryItemKey): InboxEntryKey {
    switch (itemKey.sortRangeType) {
        case "ChatEntry": {
            return {
                type: "Chat",
                chatId: itemKey.chatId,
            };
        }
        case "PostCommentsEntry": {
            return {
                type: "PostComments",
                postId: itemKey.postId,
            };
        }
        case "ChannelPostsEntry": {
            return {
                type: "ChannelPosts",
                channelId: itemKey.channelId,
                bucketGeneration: itemKey.bucketGeneration,
            };
        }
        case "DocumentCommentThreadEntry": {
            return {
                type: "DocumentCommentThread",
                documentId: itemKey.documentId,
                commentThreadId: itemKey.commentThreadId,
            };
        }
        case "DocumentNewCommentThreadsEntry": {
            return {
                type: "DocumentNewCommentThreads",
                documentId: itemKey.documentId,
                bucketGeneration: itemKey.bucketGeneration,
            };
        }
        case "TaskEntry": {
            return {
                type: "Task",
                taskId: itemKey.taskId,
            };
        }
        default:
            throw exhaustive(itemKey);
    }
}

/**
 * Archives an inbox entry, moving it out of the account's primary inbox and
 * into an archive. The user can still manually revive archived inbox entries
 * if desired.
 *
 * If the user sends a message to a chat and that implicitly archives the inbox
 * entry, that doesn't happen through this function. Instead it happens through
 * `processNotificationEvent()`.
 */
export async function archiveInboxEntry(
    context: Context<InboxSessionActionContextModulesWithBroadcast & {apns: ApnsContextModuleBase}>,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<{archiveTime: Date}> {
    return archiveInboxEntryItemKey(
        context,
        getInboxEntryItemKey({
            spaceId,
            accountId: context.actor.getAccountId(),
            key,
        }),
    );
}

/**
 * Unarchives an inbox entry. Moves the entry out of an account's archive and
 * into their primary inbox. Puts the unarchived entry at the top of the
 * primary inbox so the user can easily find it.
 */
export function unarchiveInboxEntry(
    context: InboxSessionActionContextWithBroadcast,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<void> {
    return unarchiveInboxEntryItemKey(
        context,
        getInboxEntryItemKey({
            spaceId,
            accountId: context.actor.getAccountId(),
            key,
        }),
    );
}

async function archiveInboxEntryItemKey(
    context: Context<InboxSessionActionContextModulesWithBroadcast & {apns: ApnsContextModuleBase}>,
    itemKey: InboxEntryItemKey,
): Promise<{archiveTime: Date}> {
    await authorizeSpaceAccess(context, itemKey.spaceId);

    const {archiveTime, newInboxEntryItem, loudNotificationCountDifference} =
        await context.dynamo.retryTransaction(async context => {
            const [inboxItem, inboxEntryItem] = await runAllPromises([
                InboxTable.getItemIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId: itemKey.spaceId,
                    accountId: itemKey.accountId,
                }),
                InboxTable.getItemIfExists(context, itemKey),
            ]);

            if (!inboxEntryItem) throw new NotFoundError("Inbox entry not found");

            assert(
                inboxItem,
                "Can’t have inbox entry item without corresponding inbox attributes item",
            );

            // If the inbox entry item is already archived, do nothing.
            if (inboxEntryItem.isArchived) {
                return {
                    archiveTime: inboxEntryItem.enteredTime,
                    newInboxItem: inboxItem,
                    newInboxEntryItem: inboxEntryItem,
                    loudNotificationCountDifference: 0,
                };
            }

            const archiveTime = new Date();

            let newInboxEntryItem = {
                ...inboxEntryItem,
                isArchived: true,
                // Archiving an entry clears all of its loud notifications.
                loudNotificationCount: 0,
                // When we archive an item it goes back to our inbox generation. That way if
                // it's unarchived it doesn't go back into the loud notification generation.
                generation: inboxItem.generation,
                // When we archive an item, it goes to the top of the archive.
                enteredTime: archiveTime,
            };

            // Clear out the `isStickyMention` property for messaging entries.
            if (
                "latestMessage" in newInboxEntryItem &&
                newInboxEntryItem.latestMessage.isStickyMention
            ) {
                newInboxEntryItem = {
                    ...newInboxEntryItem,
                    latestMessage: {
                        ...newInboxEntryItem.latestMessage,
                        isStickyMention: false,
                    },
                };
            }

            // Clear out the `isStickyMention` property for messaging entries.
            if (
                "latestComment" in newInboxEntryItem &&
                newInboxEntryItem.latestComment?.isStickyMention
            ) {
                newInboxEntryItem = {
                    ...newInboxEntryItem,
                    latestComment: {
                        ...newInboxEntryItem.latestComment,
                        isStickyMention: false,
                    },
                };
            }

            // `Math.max` to protect against in case we under-counted the number of inbox
            // entries at some point.
            const newEntryCount = Math.max(0, inboxItem.entryCount - 1);

            const newInboxItem: InboxAttributesItem = {
                ...inboxItem,
                loudNotificationCount:
                    inboxItem.loudNotificationCount - inboxEntryItem.loudNotificationCount,
                entryCount: newEntryCount,
                lastZeroEntryCountTime:
                    newEntryCount === 0 && inboxItem.entryCount !== 0
                        ? archiveTime
                        : inboxItem.lastZeroEntryCountTime,
            };

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                InboxTable.transactionDirectlyUpdateItem(newInboxItem),
                InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
            ]);

            return {
                archiveTime,
                newInboxItem,
                newInboxEntryItem,
                loudNotificationCountDifference: -inboxEntryItem.loudNotificationCount,
            };
        });

    // If we're archiving an entry with loud notifications, we need to send an
    // alert to Apple devices to update the badge count.
    if (loudNotificationCountDifference !== 0) {
        assert(newInboxEntryItem.isArchived);

        // NOTE(calebmer): Consider turning this into a job on the job queue to
        // guarantee notification delivery.
        context.process.waitUntil(
            sendPushNotificationToAccountDevices(context, {
                accountId: context.actor.getAccountId(),
                eventId: generateId(),
                newInboxEntryItem,
                loudNotificationCountDifference,
            }),
        );
    }

    return {archiveTime};
}

async function unarchiveInboxEntryItemKey(
    context: InboxSessionActionContextWithBroadcast,
    itemKey: InboxEntryItemKey,
): Promise<void> {
    await authorizeSpaceAccess(context, itemKey.spaceId);

    await context.dynamo.retryTransaction(async context => {
        const [inboxItem, inboxEntryItem] = await runAllPromises([
            InboxTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
            }),
            InboxTable.getItemIfExists(context, itemKey),
        ]);

        if (!inboxEntryItem) throw new NotFoundError("Inbox entry not found");

        assert(
            inboxItem,
            "Can’t have inbox entry item without corresponding inbox attributes item",
        );

        // If the inbox entry item is already unarchived, do nothing.
        if (!inboxEntryItem.isArchived) return;

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
            InboxTable.transactionDirectlyUpdateItem({
                ...inboxItem,
                entryCount: inboxItem.entryCount + 1,
            }),
            InboxTable.transactionDirectlyUpdateItem({
                ...inboxEntryItem,
                isArchived: false,
                // When unarchiving, move the unarchived entry to the top of the inbox so it's
                // easier to find. Unarchiving is a clear signal from the user that they care
                // about this entry.
                generation: inboxItem.generation + unarchivedInboxEntryGenerationIncrement,
                enteredTime: new Date(),
            }),
        ]);
    });
}

export const notificationEventProcessingTestCounter = new TestCounter<AccountId>();
export const notificationEventBeforeProcessingTestCheckpoint = new TestCheckpoint<AccountId>();
export const notificationEventAfterProcessingTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Processes a notification generating event by fanning out to subscriber
 * inboxes and notification destinations (like email or mobile push
 * notifications).
 *
 * This function is idempotent.
 */
export async function processNotificationEvent(
    context: Context<InboxSystemActionContextModulesWithBroadcast & {apns: ApnsContextModuleBase}>,
    event: NotificationEvent,
    span: TracerSpan,
): Promise<void> {
    notificationEventProcessingTestCounter.incrementForTest(event.authorId);
    await notificationEventBeforeProcessingTestCheckpoint.waitForTest(event.authorId);
    try {
        await actuallyProcessNotificationEvent(context, event, span);
    } finally {
        await notificationEventAfterProcessingTestCheckpoint.waitForTest(event.authorId);
    }
}

function actuallyProcessNotificationEvent(
    context: Context<InboxSystemActionContextModulesWithBroadcast & {apns: ApnsContextModuleBase}>,
    event: NotificationEvent,
    span: TracerSpan,
): Promise<void> {
    switch (event.type) {
        case "CreateChatMessage":
            return processNotificationCreateChatMessageEvent(context, event, span);
        case "CreatePostComment":
            return processNotificationCreatePostCommentEvent(context, event, span);
        case "CreatePost":
            return processNotificationCreatePostEvent(context, event, span);
        case "CreateDocumentComment":
            return processNotificationCreateDocumentCommentEvent(context, event, span);
        case "CreateTaskComment":
            return processNotificationCreateTaskCommentEvent(context, event, span);
        default:
            throw exhaustive(event);
    }
}

/**
 * Creates a function that will process a notification event for all
 * subscribers. Some features:
 *
 * - Makes sure traces are consistent
 * - Reads subscribers with strong consistency so we don't miss new subscribers
 * - Implements notification fan-out
 *
 * This creates a processing function that's (mostly) idempotent as long as
 * `updateInboxEntry` is idempotent. We're mostly idempotent since
 * `getSubscribers` may return different `AccountId`s on each call. However,
 * we find that acceptable. If it returns a new `AccountId` on a second call
 * then we'll update that `AccountId`'s inbox which seems harmless. If it stops
 * returning an `AccountId` on a second call we already update that
 * `AccountId`'s inbox which is fine.
 */
function createNotificationEventProcessor<Event extends NotificationEvent, Info>({
    getSubscribers,
    authorizeAccess,
    updateInboxEntry,
    getAlertContent,
}: {
    /**
     * Get the accounts subscribed to notifications for this event.
     *
     * IMPORTANT: This function needs read-after-write consistency which means you
     * can't make eventually consistent reads. If reading from DynamoDB, always
     * make sure to explicitly use `Strong` consistency.
     *
     * We need read-after-write consistency since the update which caused a
     * notification event may have just itself added a subscriber.
     */
    getSubscribers: (
        context: ServerSystemActionContext,
        event: Event,
    ) => Promise<{
        info: Info;
        accountIds: Iterable<AccountId | ContentMentionAccountId>;
    }>;

    /**
     * Authorize that the account actor has access to the notification subject.
     *
     * This is run for every subscriber returned by `getSubscribers()` that is
     * a current space member before we call `updateInboxEntry()`.
     *
     * You could implement authorization yourself in `getSubscribers()` by only
     * returning `AccountId`s that have access to the notification subject.
     * We've chosen to add a required function here to force you to consider
     * authorization instead of accidentally ignoring it.
     *
     * IMPORTANT: This function needs read-after-write consistency which means you
     * can't make eventually consistent reads. If reading from DynamoDB, always
     * make sure to explicitly use `Strong` consistency.
     *
     * We need read-after-write consistency since the update which caused a
     * notification event may have just itself added a subscriber.
     */
    authorizeAccess: (
        context: ServerImpersonatedAccountActionContext,
        event: Event,
        options: {info: Info},
    ) => Promise<Result<unknown>>;

    /**
     * Update the inbox entry for each subscriber. Called in parallel.
     *
     * Make sure this function is idempotent! That way the notification processor
     * as a whole will be idempotent.
     */
    updateInboxEntry: (
        context: InboxSystemActionContextWithBroadcast,
        event: Event,
        options: {
            info: Info;
            accountId: AccountId;
        },
    ) => Promise<UpdateInboxEntryResult | null>;

    /**
     * Get the content of a push notification for the action. The notification will
     * be displayed in different ways on different platforms. [iOS push
     * notifications][1] appear in a banner on the device's notification feed.
     *
     * A push notification is sent if:
     *
     * - The inbox entry was updated; and
     * - The inbox entry is not archived
     *
     * The alert will be delivered silently unless `loudNotificationCount` changed.
     * In which case the alert will be delivered with high priority and a sound.
     *
     * # Style guide
     *
     * A brief style guide for writing notifications:
     *
     * - `title`: The full name of the actor sending this notification.
     *
     * - `subtitle`: A continuation of `title` detailing critical context for the
     *   notification. The subtitle must be short and fit on a single line.
     *
     *   The user should be able to read the notification's `title` and `subtitle`
     *   as one sentence. They are rendered on two lines as operating systems
     *   truncate notification titles to one line. The subtitle is on its own line
     *   (and not combined with title) so the critical context it carries can be
     *   visible.
     *
     *   For example, a `title` of "Caleb Meredith" and a `subtitle` of "on their
     *   post in Welcome" is a good notification. We don't have space to say that
     *   "Welcome" is a channel. "on" is lower cased so the `title` and `subtitle`
     *   read like one sentence when put together.
     *
     * - `body`: The content snippet associated with this notification printed on a
     *   single line of text. `printNotificationEventAlertContentBody()` can handle
     *   this for you.
     *
     * [1]: https://developer.apple.com/design/human-interface-guidelines/notifications
     */
    getAlertContent: (
        context: ServerContentSystemActionContext,
        event: Event,
        options: {
            info: Info;
            accountId: AccountId;
            locale: Locale;
            entryItem: InboxEntryItem;
        },
    ) => Promise<{
        title: string;
        subtitle?: string;
        body: string;
    }>;
}): (
    context: Context<InboxSystemActionContextModulesWithBroadcast & {apns: ApnsContextModuleBase}>,
    event: Event,
    span: TracerSpan,
) => Promise<void> {
    return async (context, event, span) => {
        span.addData({
            notifications: {
                eventType: event.type,
                eventId: event.id,
            },
        });

        const {info, accountIds} = await getSubscribers(
            // This function needs read-after-write consistency! So throw an error (in
            // development) when a DynamoDB read doesn't use strong consistency to make
            // sure developers don't accidentally use eventual consistency.
            //
            // We need read-after-write consistency since the update which caused a
            // notification event may have just itself added a subscriber.
            context.dynamo.expectStrongReadConsistency(),
            event,
        );

        await runAllPromises(
            mapIterable(accountIds, async accountOrMentionId => {
                // Make sure the account is a current member of the space.
                if (!(await isAccountMemberOfSpace(context, event.spaceId, accountOrMentionId))) {
                    return;
                }

                // Make sure the subscriber still has access to the subject of this
                // notification.
                const result = await impersonateAccountAsSystemContext(
                    context,
                    accountOrMentionId as AccountId,
                    context =>
                        authorizeAccess(
                            // We expect strong read consistency here too since we need read-after-write
                            // consistency. For example, in cases where we're sending a notification right
                            // after the account was granted access to the notification's subject.
                            context.dynamo.expectStrongReadConsistency(),
                            event,
                            {info},
                        ),
                );
                if (!result.ok) return;

                // This is a verified `AccountId` after the `isAccountMemberOfSpace()`
                // check above.
                const accountId = accountOrMentionId as AccountId;

                await context.tracer.withSpan(
                    "Process notification event for account",
                    async (context, span) => {
                        span.addData({
                            notifications: {
                                eventType: event.type,
                                eventId: event.id,
                            },
                        });
                        span.addPropagatedData({context: {accountId}});

                        const result = await context.tracer.withSpan(
                            "Update inbox entry",
                            async context => updateInboxEntry(context, event, {info, accountId}),
                        );
                        if (!result) return;

                        await sendPushNotificationToAccountDevices(context, {
                            accountId,
                            eventId: event.id,
                            newInboxEntryItem: result.newInboxEntryItem,
                            loudNotificationCountDifference: result.loudNotificationCountDifference,
                            getAlertContent: () =>
                                getAlertContent(context, event, {
                                    info,
                                    accountId,
                                    // TODO(calebmer): All notifications are currently in US English. When we
                                    // localize the product this should change.
                                    locale: defaultLocale,
                                    entryItem: result.newInboxEntryItem,
                                }),
                        });
                    },
                );
            }),
        );
    };
}

/**
 * Send push notifications to registered account devices. Only sends a
 * notification if the new inbox entry is not archived OR loud notification
 * counts changed. If the new inbox entry is archived and loud notification
 * counts changed then we'll send an alert with no content (so we won't call
 * `getAlertContent`). If the new inbox entry is not archived then
 * `getAlertContent` must be provided.
 *
 * This function is idempotent. If you call it multiple times with the save
 * `eventId` the user will only see one notification on their device.
 */
async function sendPushNotificationToAccountDevices(
    context: Context<ServerActionContextModules & {apns: ApnsContextModuleBase}>,
    {
        accountId,
        eventId,
        newInboxEntryItem,
        loudNotificationCountDifference,
        getAlertContent,
    }: {
        accountId: AccountId;
        eventId: NotificationEventId;
        newInboxEntryItem: InboxEntryItem;
        loudNotificationCountDifference: number;
        getAlertContent?: () => Promise<{
            title: string;
            subtitle?: string;
            body: string;
        }>;
    },
) {
    // If we archived an entry (or updated an archived entry) that shouldn't
    // generate a push notification.
    //
    // However, if the loud notification count changed then we need to send a
    // silent push notification updating the badge number.
    if (newInboxEntryItem.isArchived && loudNotificationCountDifference === 0) {
        return;
    }

    return context.tracer.withSpan("Send push notification to devices", (context, span) => {
        // We use `withSendAlert()` as an optimization to connect to APNs in parallel with
        // loading registered account devices. This will be a little wasteful if the
        // user has no Apple devices but it should be fine since we'll have an APN
        // connection later for an account which does have Apple devices.
        return context.apns.withSendAlert(async sendAlert => {
            const getLoudNotificationCount = async () => {
                const loudNotificationCounts = await parallelMapAsyncIterableToArray(
                    InboxTable.query(context, {
                        partitionKey: {
                            partitionType: "Account",
                            accountId,
                        },
                        startSortKey: {
                            sortRangeType: "InboxAttributes",
                            spaceId: DynamoKeyAttributeSchema.id.getMinValue<SpaceId>(),
                        },
                        endSortKey: {
                            sortRangeType: "InboxAttributes",
                            spaceId: DynamoKeyAttributeSchema.id.getMaxValue<SpaceId>(),
                        },
                        limit: "All",
                        // Use strong read consistency. We don't want to update the app notification
                        // badge with a stale count.
                        consistency: "Strong",
                    }),
                    async item => {
                        // Confirm the account is still a member of this space. If an account is
                        // removed from a space we don't clean up their inbox item in case they're
                        // re-added.
                        //
                        // We run the version of this function that doesn't authorize since a system
                        // actor will only have access to one space. Not all the spaces the account
                        // has access to.
                        if (
                            !(await isAccountMemberOfSpaceWithoutAuthorization(
                                context,
                                item.spaceId,
                                item.accountId,
                            ))
                        ) {
                            return 0;
                        }

                        return item.loudNotificationCount;
                    },
                );

                return loudNotificationCounts.reduce((a, b) => a + b, 0);
            };

            const [accountDevices, alertContent, loudNotificationCount] = await runAllPromises([
                getRegisteredAccountDevices(context, accountId),

                // We optimistically build alert content even if we don't need it (e.g. since
                // there are no registered devices).
                //
                // We expect accounts will want to set up push notifications on some device and
                // we want to send them notifications quickly. So it's worth speeding up
                // notification sending even if sometimes it's a little wasteful to load alert
                // content when we don't need it.
                !newInboxEntryItem.isArchived ? assertExists(getAlertContent)() : null,

                // We optimistically get the account's total loud notification count even if we
                // don't need it (e.g. since there are no registered devices).
                //
                // We expect accounts will want to set up push notifications on some device and
                // we want to send them notifications quickly. So it's worth speeding up
                // notification sending even if sometimes it's a little wasteful to load the
                // notification count when we don't need it.
                loudNotificationCountDifference !== 0 ? getLoudNotificationCount() : null,
            ]);

            span.addData({common: {count: accountDevices.length}});

            // Interrupt the user if tge loud notification count increased.
            const isLoud = loudNotificationCountDifference > 0;

            const entryPath = getInboxEntryKeyPath(
                newInboxEntryItem.spaceId,
                getInboxEntryKey(newInboxEntryItem),
                "narrow",
            );

            await runAllPromises(
                accountDevices.map(async accountDevice => {
                    const {wasDeviceTokenUnregistered} = await sendAlert(
                        accountDevice.deviceToken,
                        {
                            entry: entryPath,

                            aps: {
                                alert: alertContent ?? undefined,
                                "thread-id": getApnsNotificationThreadId(newInboxEntryItem),

                                // Update the badge.
                                //
                                // NOTE(calebmer, 2024-06-14): There are likely all kinds of race conditions
                                // with badge updates. For example, let's say we're sending alert A and alert
                                // B. Alert A updates notification count to 3. Alert B dismisses the
                                // notification changing it to 2. If alert A runs on a server which needs to
                                // establish a new APNs connection then alert B may be delivered to the device
                                // first! When alert A is received the notification count will be 3 when in
                                // fact it's 2.
                                //
                                // I can't find a way to set an ordering for APNs notifications. So we need to
                                // find another way to fix this issue when it comes up. Maybe we schedule a
                                // reconciliation job to send an alert 5 minutes from now? Maybe we update the
                                // loud notification count when the app opens? I'm not sure.
                                //
                                // NOTE(calebmer, 2024-07-16): Another idea for a solution. Include a last
                                // modified time on `InboxAttributes` items. If we see a modified time within
                                // the last ten seconds or so schedule a job for three minutes from now to
                                // update the notification count. That way we're guaranteed to set the correct
                                // notification count after everything has settled down.
                                badge: loudNotificationCount ?? undefined,

                                // Only make a sound for loud notifications.
                                sound: isLoud ? "default" : undefined,
                                "interruption-level": isLoud ? "active" : "passive",
                            },
                        },
                        {
                            // If this is a loud notification then send the notification immediately.
                            // Otherwise, we can respect the device's power needs.
                            priority: isLoud ? 10 : 5,

                            // Make sure notification sending is idempotent. If we send the same
                            // notification twice it should be collapsed into one on the user's device.
                            collapseId: eventId,
                        },
                    );

                    // If a device token is unregistered then delete it from our database so we
                    // won't try to use it again.
                    if (wasDeviceTokenUnregistered) {
                        await deleteAccountAppleDeviceTokenIfExists(
                            context,
                            accountId,
                            accountDevice.deviceToken,
                        );
                    }
                }),
            );
        });
    });
}

function getApnsNotificationThreadId(item: InboxEntryItem): string | undefined {
    switch (item.sortRangeType) {
        case "ChatEntry":
            return item.chatId;
        case "PostCommentsEntry":
            return item.postId;
        case "ChannelPostsEntry":
            return `${item.channelId}-${item.bucketGeneration}`;
        case "DocumentCommentThreadEntry":
            // `DocumentCommentThreadId` is only guaranteed to be unique within a document.
            // It may not be unique across documents. Which is why we include the
            // `DocumentId` in the thread ID.
            return `${item.documentId}-${item.commentThreadId}`;
        case "DocumentNewCommentThreadsEntry":
            return `${item.documentId}-${item.bucketGeneration}`;
        case "TaskEntry":
            return item.taskId;
        default:
            throw exhaustive(item);
    }
}

/**
 * Is the key of a given inbox entry item constructed idempotently from a
 * `NotificationEvent` object? In other words, do we _only_ need a
 * `NotificationEvent` object to create the sort key (return true) or do we
 * need to load some data from the database to create the sort key (return
 * false).
 *
 * If the sort key is constructed idempotently we can skip sending a
 * `TransactWriteItems` DynamoDB action with a `ClientRequestToken` if the
 * inbox entry item was updated idempotently. Since the update itself is
 * idempotent so we don't need DynamoDB idempotent transaction protection.
 *
 * For instance the key for `PostCommentsEntry` is constructed idempotently
 * since all we need is a `PostId` and the `PostId` comes from the
 * `NotificationEvent` object. However `ChannelPostsEntry` is not idempotent
 * since while it has a `ChannelId` coming from the `NotificationEvent` object
 * it _also_ has a `bucketGeneration` property which is loaded from the
 * database. If we were to process a `NotificationEvent` which updates a
 * `ChannelPostsEntry` twice without `ClientRequestToken` protection and the
 * inbox generation updated you'd get two inbox entries!
 */
function isInboxEntryItemKeyConstructionFromNotificationEventIdempotent(
    sortRangeType: InboxEntryItem["sortRangeType"],
): boolean {
    switch (sortRangeType) {
        case "ChatEntry":
        case "PostCommentsEntry":
        case "TaskEntry":
        case "DocumentCommentThreadEntry":
            return true;
        case "ChannelPostsEntry":
        case "DocumentNewCommentThreadsEntry":
            return false;
        default:
            throw exhaustive(sortRangeType);
    }
}

type UpdateInboxEntryResult = {
    readonly newInboxEntryItem: InboxEntryItem;
    readonly loudNotificationCountDifference: number;
};

/**
 * Helper function for updating an inbox entry and the main inbox attributes
 * item along with it. Makes sure to keep everything consistent. For example,
 * updating the inbox total loud notification count when the entry loud
 * notification count updates.
 *
 * This function is idempotent if `update` is idempotent (excluding changes to
 * `isArchived` or `loudNotificationCount`). Make sure you update properties
 * (besides `isArchived` or `loudNotificationCount`) idempotently!
 *
 * This function could be idempotent irregardless of how `update` is
 * implemented if we perform every write in a DynamoDB write transaction with a
 * `clientRequestToken` but as an optimization we try to avoid transactions
 * when possible which means we need `update` to be idempotent.
 */
async function updateInboxEntry<ItemKey extends InboxEntryItemKey>(
    context: InboxSystemActionContextWithBroadcast,
    event: NotificationEvent,
    accountId: AccountId,
    itemKey: ItemKey,
    update: (
        item: (InboxEntryItem & ItemKey) | null,
    ) => MaybePromise<
        DistributiveOmit<
            InboxEntryItem & ItemKey,
            DistributiveKeyOf<InboxEntryItemKey> | "generation" | "enteredTime"
        >
    >,
    {initialInboxItemIfExists}: {initialInboxItemIfExists?: InboxAttributesItem | null} = {},
): Promise<UpdateInboxEntryResult | null> {
    let hasAttempted = false;

    return context.dynamo.retryTransaction(run);

    async function run(
        context: InboxSystemActionContextWithBroadcast,
    ): Promise<UpdateInboxEntryResult | null> {
        const isInitialAttempt = !hasAttempted;
        hasAttempted = true;

        const [inboxItem, oldInboxEntryItem] = await runAllPromises([
            isInitialAttempt && initialInboxItemIfExists !== undefined
                ? initialInboxItemIfExists
                : InboxTable.getItemIfExists(context, {
                      partitionType: "Account",
                      sortRangeType: "InboxAttributes",
                      spaceId: itemKey.spaceId,
                      accountId: itemKey.accountId,
                  }),
            InboxTable.getItemIfExists(context, itemKey),
        ]);

        const newInboxEntryItemPartial1 = await update(oldInboxEntryItem);

        assert(
            !newInboxEntryItemPartial1.isArchived ||
                newInboxEntryItemPartial1.loudNotificationCount === 0,
            "Loud notification count of archived inbox entries must be zero",
        );

        const loudNotificationCountDifference =
            newInboxEntryItemPartial1.loudNotificationCount -
            (oldInboxEntryItem?.loudNotificationCount ?? 0);

        const inboxGeneration = inboxItem?.generation ?? initialInboxGeneration;

        const newInboxEntryItemPartial2 = {
            ...newInboxEntryItemPartial1,
            ...itemKey,
            updateLockVersion: oldInboxEntryItem?.updateLockVersion,
        } as DistributiveOmit<InboxEntryItem & ItemKey, "generation" | "enteredTime">;

        // If there was no inbox entry and the new inbox entry would be archived (maybe
        // a user is sending a message to a chat they created) then don't create a
        // new entry.
        if (!oldInboxEntryItem && newInboxEntryItemPartial2.isArchived) {
            return null;
        }

        // We don't update archived inbox entries. An archived inbox entry stays the
        // same from the moment it's archived onward. Some `update()` functions may
        // make a change (e.g. `processNotificationCreateChatMessageEvent()` always
        // updates `latestMessage`) but we ignore it.
        if (oldInboxEntryItem?.isArchived && newInboxEntryItemPartial2.isArchived) {
            return null;
        }

        // Move the entry to the top of the inbox if:
        //
        // - The entry is newly created; OR
        // - The entry is revived from the archive; OR
        // - The entry has a loud notification
        const shouldMoveToTop =
            !oldInboxEntryItem ||
            (!newInboxEntryItemPartial2.isArchived && oldInboxEntryItem.isArchived) ||
            loudNotificationCountDifference > 0;

        const currentTime = new Date();

        const newInboxEntryItem: InboxEntryItem = {
            ...newInboxEntryItemPartial2,

            generation: shouldMoveToTop
                ? // Move our entry to the higher generation of:
                  //
                  // - The entry's current generation
                  // - The inbox's current generation plus an increment if this is a loud
                  //   notification since loud notifications should appear on top
                  //
                  // If our entry moves to a higher generation (usually due to a loud
                  // notification) then it should stay at that generation.
                  Math.max(
                      ...(oldInboxEntryItem ? [oldInboxEntryItem.generation] : []),
                      inboxGeneration +
                          (loudNotificationCountDifference > 0
                              ? loudNotificationInboxGenerationIncrement
                              : 0),
                  )
                : // When we archive an item it goes back to our inbox generation. That way if
                // it's unarchived it doesn't go back into the loud notification generation.
                newInboxEntryItemPartial2.isArchived && !oldInboxEntryItem.isArchived
                ? inboxGeneration
                : oldInboxEntryItem.generation,

            enteredTime: shouldMoveToTop
                ? getInboxEntryLatestUpdateTime(newInboxEntryItemPartial2)
                : // When we archive an item, it goes to the top of the archive.
                newInboxEntryItemPartial2.isArchived && !oldInboxEntryItem.isArchived
                ? currentTime
                : oldInboxEntryItem.enteredTime,
        };

        const entryCountDifference =
            (!newInboxEntryItem.isArchived ? 1 : 0) -
            (oldInboxEntryItem && !oldInboxEntryItem.isArchived ? 1 : 0);

        const maxClientRequestTokenLengthForIds = dynamoClientRequestTokenMaxLength - 3;
        const maxClientRequestTokenEventIdLength = Math.ceil(maxClientRequestTokenLengthForIds / 2);
        const maxClientRequestTokenAccountIdLength = Math.floor(
            maxClientRequestTokenLengthForIds / 2,
        );

        // Fill the client request token with half of the event ID and half of the
        // account ID. We end up using 16 characters for `AccountId`s and 17 characters
        // for `NotificationEventId`s whereas the full length of an ID is 26
        // characters. This does increase collision chances!
        //
        // However, if we're generating IDs at the rate of 1000 per hour we'll end up
        // [needing to wait ~18 thousand years][1] for a 1% collision chance of
        // `AccountId`s and ~101 thousand years for a 1% collision chance of
        // `NotificationEventId`s. If we get a random collision that means a
        // notification won't be sent which could be pretty bad if it's an urgent
        // notification but won't leave the system in a corrupted state.
        //
        // We start the token with `i:` (`i` stands for `inbox`) to make sure we don't
        // collide with `clientRequestToken`s generated by other parts of our system
        // since `clientRequestToken`s need to be globally unique.
        //
        // [1]: https://zelark.github.io/nano-id-cc/
        const clientRequestToken = `i:${event.id.slice(
            0,
            maxClientRequestTokenEventIdLength,
        )}-${accountId.slice(0, maxClientRequestTokenAccountIdLength)}`;

        assert(clientRequestToken.length <= dynamoClientRequestTokenMaxLength);

        try {
            // Optimization: If the inbox item isn't changing don't run a transaction.
            if (inboxItem && loudNotificationCountDifference === 0 && entryCountDifference === 0) {
                if (
                    isInboxEntryItemKeyConstructionFromNotificationEventIdempotent(
                        newInboxEntryItem.sortRangeType,
                    )
                ) {
                    // Optimization: Don't write to the database (and so update `updateVersionLock`)
                    // if the item didn't actually update.
                    if (oldInboxEntryItem && isDeepEqual(oldInboxEntryItem, newInboxEntryItem)) {
                        // Even though we don't actually write a new inbox item, we still want to
                        // return an update result. If we return null we won't send push notifications
                        // for this event!
                        //
                        // It's important to still send push notifications in this case. If there's a
                        // sticky mention (`latestMessage.isStickyMention` is set) the inbox entry
                        // won't update (it continues to show the sticky mention) but we still want to
                        // send push notifications for any messages sent after the sticky mention.
                        return {
                            newInboxEntryItem: oldInboxEntryItem,
                            loudNotificationCountDifference,
                        };
                    } else {
                        await InboxTable.directlyUpdateItem(context, newInboxEntryItem);

                        return {
                            newInboxEntryItem,
                            loudNotificationCountDifference,
                        };
                    }
                } else {
                    await DynamoGeneralRealtimeTableSchema.executeTransaction(
                        context,
                        [InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem)],
                        {clientRequestToken},
                    );

                    return {
                        newInboxEntryItem,
                        loudNotificationCountDifference,
                    };
                }
            } else {
                const oldEntryCount = inboxItem?.entryCount ?? 0;

                // `Math.max` to protect against in case we under-counted the number of inbox
                // entries at some point.
                const newEntryCount = Math.max(0, oldEntryCount + entryCountDifference);

                const newInboxItem: InboxAttributesItem = {
                    ...inboxItem,
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId: itemKey.spaceId,
                    accountId: itemKey.accountId,
                    generation: inboxGeneration,
                    loudNotificationCount:
                        (inboxItem?.loudNotificationCount ?? 0) + loudNotificationCountDifference,
                    entryCount: newEntryCount,
                    lastZeroEntryCountTime:
                        newEntryCount === 0 && oldEntryCount !== 0
                            ? currentTime
                            : inboxItem?.lastZeroEntryCountTime ?? null,
                };

                await DynamoGeneralRealtimeTableSchema.executeTransaction(
                    context,
                    [
                        InboxTable.transactionDirectlyUpdateItem(newInboxItem),
                        InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
                    ],
                    {clientRequestToken},
                );

                return {
                    newInboxEntryItem,
                    loudNotificationCountDifference,
                };
            }
        } catch (error) {
            // If DynamoDB has committed a transaction with this `clientRequestToken` in the
            // last 10min then we can return peacefully to make sure this function is
            // idempotent.
            if (isDynamoIdempotentParameterMismatchError(error)) return null;

            throw error;
        }
    }
}

function getInboxEntryLatestUpdateTime(
    entryItem: DistributiveOmit<InboxEntryItem, "isArchived" | "generation" | "enteredTime">,
): Date {
    switch (entryItem.sortRangeType) {
        case "ChatEntry":
            return entryItem.latestMessage.createdTime;
        case "PostCommentsEntry":
            return entryItem.latestComment?.createdTime ?? entryItem.postCreatedTime;
        case "ChannelPostsEntry":
            return entryItem.latestPost.createdTime;
        case "DocumentCommentThreadEntry":
            return entryItem.latestComment.createdTime;
        case "DocumentNewCommentThreadsEntry":
            return entryItem.latestCommentThreadCreatedTime;
        case "TaskEntry":
            return entryItem.latestComment.createdTime;
        default:
            throw exhaustive(entryItem);
    }
}

async function printNotificationEventAlertContentBody(
    context: ServerContentActionContext,
    fileAuthorizer: FileAuthorizer,
    event: {spaceId: SpaceId; isContentSnippetComplete: boolean; contentSnippet: Node},
) {
    // We don't render files in the alert content so don't bother preloading files.
    const contentReferences = await getContentReferencesForNode(
        context,
        event.spaceId,
        fileAuthorizer,
        event.contentSnippet,
    );

    let body = printContentSingleLineTextSnippetForServer({
        doc: event.contentSnippet,
        references: contentReferences,
    });

    if (!event.isContentSnippetComplete && !isTextEndedWithPunctuation(body)) {
        body += "…";
    }

    return body;
}

const processNotificationCreateChatMessageEvent = createNotificationEventProcessor<
    NotificationCreateChatMessageEvent,
    {spaceId: SpaceId; accountIds: ReadonlyArray<AccountId>}
>({
    getSubscribers: async (context, event) => {
        const {spaceId, accountIds} = await getChatAccountIds(context, event.chatId, {
            consistency: "StrongWithinCache",
        });

        return {
            info: {spaceId, accountIds},
            accountIds,
        };
    },
    authorizeAccess: (context, event) => {
        return authorizeChatAccessIfPossible(context, event.chatId, {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: (
        context,
        event,
        {info: {spaceId, accountIds: chatAccountIds}, accountId},
    ) => {
        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "ChatEntry",
                spaceId,
                accountId,
                chatId: event.chatId,
            },
            oldItem => {
                // When the user messages a chat we archive the corresponding inbox entry. Or
                // if the chat is already archived, we keep it archived. By sending a message
                // the user implicitly marks their entry as done.
                //
                // If the events were received out-of-order we keep the last archive state
                // of the entry.
                const isArchived =
                    !oldItem ||
                    (event.messageIndex > oldItem.latestMessage.index &&
                        (oldItem.latestArchivingMessageIndex === null ||
                            event.messageIndex > oldItem.latestArchivingMessageIndex))
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let isMention;
                let shouldIncrementLoudNotificationCount;
                let loudNotificationCount;
                if (isArchived) {
                    isMention = false;
                    shouldIncrementLoudNotificationCount = false;
                    loudNotificationCount = 0;
                } else {
                    isMention = event.mentionedAccountIds.has(accountId);

                    // We increment the loud notification count if:
                    //
                    // - This account was mentioned in the message
                    // - We are adding an entry for this chat to this account's inbox (either we
                    //   are creating a new one or moving it out of the inbox archive)
                    // - Enough time has passed that new messages are likely a new thought (we use
                    //   the same time period in which timestamp dividers will be inserted so the
                    //   user may also see this visually)
                    //
                    // Chat messages are attention grabbing by default (even without messages)
                    // since chat is intended to be a realtime communication medium unlike forum
                    // which is an asynchronous communication medium.
                    //
                    // However, we don't want 1 chat message to equal 1 loud notification count
                    // since then chat messages could easily overwhelm your loud notification count
                    // and make it meaningless. So instead we have approximately 1 loud
                    // notification per chat per hour.
                    //
                    // While this scheme is a little hard for users to understand, the loud
                    // notification count does not need to be precise. It needs to give a sense of
                    // scale of work involved in answering entries in the user's inbox and our bet
                    // is the work involved to resolve your inbox entries is proportional to number
                    // of entries (vs number of messages within an entry).
                    shouldIncrementLoudNotificationCount = (() => {
                        if (isMention) return true;

                        // Don't increment the loud notification count if this is a clerical message
                        // unless this clerical message also contained a mention.
                        if (event.clerical) return false;

                        if (oldItem?.isArchived) return true;
                        if (!oldItem?.lastLoudNotificationCountTime) return true;

                        return (
                            differenceInMinutes(
                                event.createdTime,
                                oldItem.lastLoudNotificationCountTime,
                            ) >= minMessageViewTimestampDividerElapsedMinutes
                        );
                    })();

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestMessage: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                    isStickyMention: boolean;
                    clerical?: MessageContentPayloadClerical;
                };
                let otherAccountId: AccountId | null;

                if (
                    oldItem &&
                    // Our events may arrive out-of-order. If we have an earlier message index then
                    // what's in the entry's latest message then don't bother updating the latest
                    // message.
                    (oldItem.latestMessage.index >= event.messageIndex ||
                        // Or if the latest comment was a mention then we'll leave that in place even
                        // if there are further comments added.
                        (oldItem.latestMessage.isStickyMention && !isMention && !isArchived) ||
                        // Or if the message from our event is from the same account as the inbox
                        // owner's then don't update the latest message. Leave the last message from an
                        // account other than our inbox's account in the entry.
                        accountId === event.authorId)
                ) {
                    latestMessage = oldItem.latestMessage;
                    otherAccountId = oldItem.otherAccountId;
                } else {
                    latestMessage = {
                        index: event.messageIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
                        isStickyMention: isMention,
                        clerical: event.clerical,
                    };

                    if (!oldItem) {
                        // If we are creating this inbox entry fresh, pick a random account in the chat
                        // that's not our inbox's account and that's not the message author as
                        // `otherAccountId`.
                        //
                        // Randomly picking an account is probably not the ideal heuristic but gives
                        // the user some diversity in other accounts they see as opposed to, say,
                        // always picking the user with the first name alphabetically.
                        const latestMessageAuthorId = latestMessage.authorId;
                        const eligibleOtherAccountIds = chatAccountIds.filter(
                            chatAccountId =>
                                chatAccountId !== latestMessageAuthorId &&
                                chatAccountId !== accountId,
                        );

                        otherAccountId =
                            eligibleOtherAccountIds.length > 0
                                ? eligibleOtherAccountIds[
                                      randomInteger(0, eligibleOtherAccountIds.length)
                                  ]!
                                : null;
                    } else {
                        // If the `latestMessage`'s author changed then move the old `latestMessage`
                        // author into `otherAccountId`. But not if the old `latestMessage` had our
                        // inbox's account as the author.
                        otherAccountId =
                            oldItem.latestMessage.authorId !== latestMessage.authorId &&
                            oldItem.latestMessage.authorId !== accountId
                                ? oldItem.latestMessage.authorId
                                : oldItem.otherAccountId;
                    }
                }

                return {
                    isArchived,
                    loudNotificationCount,
                    lastLoudNotificationCountTime: shouldIncrementLoudNotificationCount
                        ? event.createdTime
                        : oldItem?.lastLoudNotificationCountTime ?? null,
                    latestMessage:
                        isArchived && latestMessage.isStickyMention
                            ? {...latestMessage, isStickyMention: false}
                            : latestMessage,
                    latestArchivingMessageIndex:
                        isArchived && !oldItem?.isArchived
                            ? event.messageIndex
                            : oldItem?.latestArchivingMessageIndex ?? null,
                    otherAccountId,
                };
            },
        );
    },
    getAlertContent: async (
        context,
        event,
        {info: {accountIds: chatAccountIds}, entryItem, locale},
    ) => {
        assert(entryItem.sortRangeType === "ChatEntry");

        const [authorAccount, otherAccount, bodyFromEventContent] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            entryItem.otherAccountId && entryItem.otherAccountId !== event.authorId
                ? getAccount(context, event.spaceId, entryItem.otherAccountId)
                : null,
            printNotificationEventAlertContentBody(
                context,
                FileChatAuthorizer.bind({type: "ChatMessages", chatId: event.chatId}),
                event,
            ),
        ]);

        const title = authorAccount.initialData.name;
        let body = bodyFromEventContent;

        // We don't include "Mentioned you" in the subtitle even if there was a
        // mention since:
        //
        // - Subtitle is already long
        // - All chat messages are loud notifications even if there's not a mention
        let subtitle: string | undefined;

        if (chatAccountIds.length <= 2) {
            // No subtitle
        } else {
            subtitle = "to ";

            if (chatAccountIds.length === 3 && otherAccount) {
                subtitle += "you and ";
                subtitle += getAccountShortNameWithoutFullNameTooltip(otherAccount.initialData);
            } else if (!otherAccount) {
                subtitle += "you and ";
                subtitle += printPrettyNumber(locale, chatAccountIds.length - 2, "other");
            } else {
                subtitle += "you, ";
                subtitle += getAccountShortNameWithoutFullNameTooltip(otherAccount.initialData);
                subtitle += ", and ";
                subtitle += printPrettyNumber(locale, chatAccountIds.length - 3, "other");
            }
        }

        // If this is a share notification then override the subtitle to
        // describe what happened.
        if (event.clerical?.type === "ShareNotification") {
            const entityNoun = getFileEntityNoun(event.clerical.entityType);

            // If there's no body then put the "shared with you" message in the body
            // instead of the subtitle. This looks better since the notification isn't all
            // bold text.
            if (body.length === 0) {
                body = `shared a ${entityNoun} with you`;
            } else {
                subtitle = `shared a ${entityNoun} with you`;
            }
        }

        return {title, subtitle, body};
    },
});

const processNotificationCreatePostCommentEvent = createNotificationEventProcessor<
    NotificationCreatePostCommentEvent,
    {postCreatedTime: Date}
>({
    getSubscribers: async (context, event) => {
        const {accountIds, postCreatedTime} = await getPostNotificationSubscribers(
            context,
            event.postId,
            {consistency: "StrongWithinCache"},
        );

        return {
            info: {postCreatedTime},
            accountIds,
        };
    },
    authorizeAccess: (context, event) => {
        return authorizePostAccessIfPossible(context, event.postId, "View", {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: (context, event, {info: {postCreatedTime}, accountId}) => {
        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId: event.spaceId,
                accountId,
                postId: event.postId,
            },
            oldItem => {
                // When the user comments on a post we archive the corresponding inbox entry. Or
                // if the entry is already archived, we keep it archived. By sending a comment
                // the user implicitly marks their entry as done.
                //
                // If the events were received out-of-order we keep the last archive state
                // of the entry.
                const isArchived =
                    !oldItem?.latestComment ||
                    (event.commentIndex > oldItem.latestComment.index &&
                        (oldItem.latestArchivingCommentIndex === null ||
                            event.commentIndex > oldItem.latestArchivingCommentIndex))
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let isMention;
                let loudNotificationCount;
                if (isArchived) {
                    isMention = false;
                    loudNotificationCount = 0;
                } else {
                    isMention = event.mentionedAccountIds.has(accountId);

                    // We increment the loud notification count only if someone is explicitly
                    // trying to get your attention by mentioning your account. Otherwise, we
                    // expect users will respond to new post comments in their own time.
                    const shouldIncrementLoudNotificationCount = isMention;

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestComment: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                    isStickyMention: boolean;
                };
                let otherCommentAuthorId: AccountId | null;

                if (
                    oldItem?.latestComment &&
                    // Our events may arrive out-of-order. If we have an earlier message index then
                    // what's in the entry's latest message then don't bother updating the latest
                    // message.
                    (oldItem.latestComment.index >= event.commentIndex ||
                        // Or if the latest comment was a mention then we'll leave that in place even
                        // if there are further comments added.
                        (oldItem.latestComment.isStickyMention && !isMention && !isArchived) ||
                        // Or if the message from our event is from the same account as the inbox
                        // owner's then don't update the latest message. Leave the last message from an
                        // account other than our inbox's account in the entry.
                        accountId === event.authorId)
                ) {
                    latestComment = oldItem.latestComment;
                    otherCommentAuthorId = oldItem.otherCommentAuthorId;
                } else {
                    latestComment = {
                        index: event.commentIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
                        isStickyMention: isMention,
                    };

                    if (!oldItem) {
                        otherCommentAuthorId = null;
                    } else {
                        // If the `latestComment`'s author changed then move the old `latestComment`
                        // author into `otherCommentAuthorId`. But not if the old `latestComment`
                        // had our inbox's account as the author.
                        otherCommentAuthorId =
                            oldItem.latestComment &&
                            oldItem.latestComment.authorId !== latestComment.authorId &&
                            oldItem.latestComment.authorId !== accountId
                                ? oldItem.latestComment.authorId
                                : oldItem.otherCommentAuthorId;
                    }
                }

                // If the new comment moves our entry out of the archive, unset the post
                // comment snippet.
                const postContentSnippetIfMentioned =
                    oldItem?.isArchived && !isArchived
                        ? null
                        : oldItem?.postContentSnippetIfMentioned ?? null;

                return {
                    isArchived,
                    loudNotificationCount,
                    postCreatedTime,
                    postContentSnippetIfMentioned,
                    latestComment:
                        isArchived && latestComment.isStickyMention
                            ? {...latestComment, isStickyMention: false}
                            : latestComment,
                    latestArchivingCommentIndex:
                        isArchived && !oldItem?.isArchived
                            ? event.commentIndex
                            : oldItem?.latestArchivingCommentIndex ?? null,
                    otherCommentAuthorId,
                };
            },
        );
    },
    getAlertContent: async (context, event, {accountId}) => {
        const [author, post, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            // This function is cached which is important since we call this function when
            // building a `InboxPostCommentsEntryModel` for realtime in the same action.
            getPostAuthorAndChannelPreview(context, event.postId),
            printNotificationEventAlertContentBody(
                context,
                FilePostAuthorizer.bind({type: "PostComments", postId: event.postId}),
                event,
            ),
        ]);

        let subtitle = "";

        if (!event.mentionedAccountIds.has(accountId)) {
            subtitle += "on ";
        } else {
            subtitle += "mentioned you on ";
        }

        if (post.author.id === accountId) {
            subtitle += "your";
        } else if (post.author.id === event.authorId) {
            subtitle += "their";
        } else {
            subtitle += `${getAccountShortNameWithoutFullNameTooltip(post.author.initialData)}’s`;
        }

        subtitle += ` post in ${post.channel.name}`;

        return {title: author.initialData.name, subtitle, body};
    },
});

const processNotificationCreatePostEvent = createNotificationEventProcessor<
    NotificationCreatePostEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        const accountIds = await getChannelNotificationSubscribers(context, event.channelId, {
            consistency: "StrongWithinCache",
        });

        return {
            info: {},
            accountIds: new Set(
                concatIterables(
                    accountIds,
                    // We need to send a notification to mentioned accounts even if they're not a
                    // channel subscriber.
                    event.mentionedAccountIds,
                ),
            ),
        };
    },
    authorizeAccess: (context, event) => {
        return authorizePostAccessIfPossible(context, event.postId, "View", {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: async (context, event, {info: {}, accountId}) => {
        // Don't update an entry for the account who created the post.
        if (event.authorId === accountId) return null;

        // If the account was mentioned in the post, we create a separate entry with a
        // loud notification instead of merging into one channel post summary entry.
        if (event.mentionedAccountIds.has(accountId)) {
            return updateInboxEntry(
                context,
                event,
                accountId,
                {
                    partitionType: "Inbox",
                    sortRangeType: "PostCommentsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    postId: event.postId,
                },
                oldItem => {
                    // If we received events out-of-order a new comment event may have created this
                    // comments inbox entry. Keep old properties in this case.
                    if (oldItem) {
                        return {
                            ...oldItem,
                            loudNotificationCount:
                                oldItem.loudNotificationCount + (!oldItem.isArchived ? 1 : 0),
                            postContentSnippetIfMentioned: event.contentSnippet,
                        };
                    }

                    return {
                        isArchived: false,
                        loudNotificationCount: 1,
                        postCreatedTime: event.createdTime,
                        postContentSnippetIfMentioned: event.contentSnippet,
                        latestComment: null,
                        latestArchivingCommentIndex: null,
                        otherCommentAuthorId: null,
                    };
                },
            );
        }

        const inboxItem = await InboxTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: event.spaceId,
            accountId,
        });

        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId: event.spaceId,
                accountId,
                channelId: event.channelId,
                bucketGeneration: inboxItem?.generation ?? initialInboxGeneration,
            },
            oldItem => {
                const postIds = new Set([event.postId, ...(oldItem?.postIds ?? [])]);
                const postAuthorIds = new Set([event.authorId, ...(oldItem?.postAuthorIds ?? [])]);

                return {
                    isArchived: false,
                    loudNotificationCount: 0,
                    postIds,
                    postAuthorIds,
                    latestPost:
                        !oldItem ||
                        oldItem.latestPost.createdTime.getTime() < event.createdTime.getTime()
                            ? {
                                  postId: event.postId,
                                  authorId: event.authorId,
                                  createdTime: event.createdTime,
                                  contentSnippet: event.contentSnippet,
                              }
                            : oldItem.latestPost,
                };
            },
            {initialInboxItemIfExists: inboxItem},
        );
    },
    getAlertContent: async (context, event, {accountId}) => {
        const [author, channel, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            getChannelPreview(context, event.channelId),
            printNotificationEventAlertContentBody(
                context,
                FilePostAuthorizer.bind({type: "Post", postId: event.postId}),
                event,
            ),
        ]);

        let subtitle: string;
        if (!event.mentionedAccountIds.has(accountId)) {
            subtitle = `in ${channel.name}`;
        } else {
            subtitle = `mentioned you in ${channel.name}`;
        }

        return {
            title: author.initialData.name,
            subtitle,
            body,
        };
    },
});

const processNotificationCreateDocumentCommentEvent = createNotificationEventProcessor<
    NotificationCreateDocumentCommentEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        const {accountIds} = await getDocumentCommentThreadNotificationSubscribers(context, {
            documentId: event.documentId,
            commentThreadId: event.commentThreadId,
            isFirstComment: event.commentIndex === 0,
            consistency: "StrongWithinCache",
        });

        return {
            info: {},
            accountIds,
        };
    },
    authorizeAccess: (context, event) => {
        return authorizeDocumentAccessIfPossible(context, event.documentId, "View", {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: async (context, event, {info: {}, accountId}) => {
        const isFirstComment = event.commentIndex === 0;

        // The first comment in a thread (if it doesn't contain a mention of our user)
        // is batched into a "new comments" inbox entry. This makes it easier for the
        // document owner to browse new comments.
        if (isFirstComment && !event.mentionedAccountIds.has(accountId)) {
            // Don't update a new comment threads entry for the account who authored
            // the comment.
            if (event.authorId === accountId) return null;

            const inboxItem = await InboxTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId: event.spaceId,
                accountId,
            });

            return updateInboxEntry(
                context,
                event,
                accountId,
                {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentNewCommentThreadsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    documentId: event.documentId,
                    bucketGeneration: inboxItem?.generation ?? initialInboxGeneration,
                },
                oldItem => {
                    const commentThreadIds = new Set([
                        ...(oldItem?.commentThreadIds ?? []),
                        event.commentThreadId,
                    ]);
                    const commentThreadAuthorIds = new Set([
                        ...(oldItem?.commentThreadAuthorIds ?? []),
                        event.authorId,
                    ]);

                    return {
                        isArchived: false,
                        loudNotificationCount: 0,
                        commentThreadIds,
                        commentThreadAuthorIds,
                        firstComment: oldItem?.firstComment ?? {
                            commentThreadId: event.commentThreadId,
                            authorId: event.authorId,
                            createdTime: event.createdTime,
                            contentSnippet: event.contentSnippet,
                        },
                        latestCommentThreadCreatedTime: event.createdTime,
                    };
                },
                {initialInboxItemIfExists: inboxItem},
            );
        }

        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "DocumentCommentThreadEntry",
                spaceId: event.spaceId,
                accountId,
                documentId: event.documentId,
                commentThreadId: event.commentThreadId,
            },
            async oldItem => {
                // When the user comments on a document comment thread we archive the
                // corresponding inbox entry. Or if the entry is already archived, we keep it
                // archived. By sending a comment the user implicitly marks their entry as done.
                //
                // If the events were received out-of-order we keep the last archive state
                // of the entry.
                const isArchived =
                    !oldItem?.latestComment ||
                    (event.commentIndex > oldItem.latestComment.index &&
                        (oldItem.latestArchivingCommentIndex === null ||
                            event.commentIndex > oldItem.latestArchivingCommentIndex))
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let isMention;
                let loudNotificationCount;
                if (isArchived) {
                    isMention = false;
                    loudNotificationCount = 0;
                } else {
                    isMention = event.mentionedAccountIds.has(accountId);

                    // We increment the loud notification count only if someone is explicitly
                    // trying to get your attention by mentioning your account. Otherwise, we
                    // expect users will respond to new post comments in their own time.
                    const shouldIncrementLoudNotificationCount = isMention;

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestComment: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                    isStickyMention: boolean;
                };
                let otherCommentAuthorId: AccountId | null;

                if (
                    oldItem?.latestComment &&
                    // Our events may arrive out-of-order. If we have an earlier message index then
                    // what's in the entry's latest message then don't bother updating the latest
                    // message.
                    (oldItem.latestComment.index >= event.commentIndex ||
                        // Or if the latest comment was a mention then we'll leave that in place even
                        // if there are further comments added.
                        (oldItem.latestComment.isStickyMention && !isMention && !isArchived) ||
                        // Or if the message from our event is from the same account as the inbox
                        // owner's then don't update the latest message. Leave the last message from an
                        // account other than our inbox's account in the entry.
                        accountId === event.authorId)
                ) {
                    latestComment = oldItem.latestComment;
                    otherCommentAuthorId = oldItem.otherCommentAuthorId;
                } else {
                    latestComment = {
                        index: event.commentIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
                        isStickyMention: isMention,
                    };

                    if (!oldItem) {
                        otherCommentAuthorId = null;
                    } else {
                        // If the `latestComment`'s author changed then move the old `latestComment`
                        // author into `otherCommentAuthorId`. But not if the old `latestComment`
                        // had our inbox's account as the author.
                        otherCommentAuthorId =
                            oldItem.latestComment &&
                            oldItem.latestComment.authorId !== latestComment.authorId &&
                            oldItem.latestComment.authorId !== accountId
                                ? oldItem.latestComment.authorId
                                : oldItem.otherCommentAuthorId;
                    }
                }

                const firstCommentAuthorId =
                    oldItem?.firstCommentAuthorId ??
                    (isFirstComment
                        ? event.authorId
                        : await getDocumentCommentAuthorId(context, {
                              documentId: event.documentId,
                              commentThreadId: event.commentThreadId,
                              commentIndex: 0,
                          }));

                return {
                    isArchived,
                    loudNotificationCount,
                    firstCommentAuthorId,
                    latestComment:
                        isArchived && latestComment.isStickyMention
                            ? {...latestComment, isStickyMention: false}
                            : latestComment,
                    latestArchivingCommentIndex:
                        isArchived && !oldItem?.isArchived
                            ? event.commentIndex
                            : oldItem?.latestArchivingCommentIndex ?? null,
                    otherCommentAuthorId,
                };
            },
        );
    },
    getAlertContent: async (context, event, {accountId, entryItem}) => {
        assert(
            entryItem.sortRangeType === "DocumentNewCommentThreadsEntry" ||
                entryItem.sortRangeType === "DocumentCommentThreadEntry",
        );

        const [author, document, firstCommentAuthor, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            getDocumentPreview(context, event.documentId),
            entryItem.sortRangeType === "DocumentCommentThreadEntry" &&
            entryItem.firstCommentAuthorId !== accountId &&
            entryItem.firstCommentAuthorId !== event.authorId
                ? getAccount(context, event.spaceId, entryItem.firstCommentAuthorId)
                : null,
            printNotificationEventAlertContentBody(
                context,
                FileDocumentAuthorizer.bind({
                    type: "DocumentComments",
                    documentId: event.documentId,
                }),
                event,
            ),
        ]);

        const truncatedDocumentTitle = truncateDocumentTitleForNotification(document.getTitle());

        let subtitle = "";

        switch (entryItem.sortRangeType) {
            case "DocumentNewCommentThreadsEntry": {
                if (!event.mentionedAccountIds.has(accountId)) {
                    subtitle += truncatedDocumentTitle;
                } else {
                    subtitle += `mentioned you in their thread on ${truncatedDocumentTitle}`;
                }
                break;
            }
            case "DocumentCommentThreadEntry": {
                if (!event.mentionedAccountIds.has(accountId)) {
                    subtitle += "mentioned you in ";
                } else {
                    subtitle += "in ";
                }

                if (entryItem.firstCommentAuthorId === accountId) {
                    subtitle += "your";
                } else if (entryItem.firstCommentAuthorId === event.authorId) {
                    subtitle += "their";
                } else {
                    subtitle += `${getAccountShortNameWithoutFullNameTooltip(
                        // We should have loaded `firstCommentAuthor` under the same conditions as it
                        // took to reach this branch.
                        assertExists(firstCommentAuthor).initialData,
                    )}’s`;
                }

                subtitle += ` thread on ${truncatedDocumentTitle}`;
                break;
            }
            default:
                throw exhaustive(entryItem);
        }

        return {title: author.initialData.name, subtitle, body};
    },
});

const processNotificationCreateTaskCommentEvent = createNotificationEventProcessor<
    NotificationCreateTaskCommentEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        const {accountIds} = await getTaskNotificationSubscribers(context, event.taskId, {
            consistency: "StrongWithinCache",
        });

        return {
            info: {},
            accountIds,
        };
    },
    authorizeAccess: async (context, event) => {
        return assertExists(
            await authorizeTaskAccessIfPossible(context, event.taskId, "View", null, {
                consistency: "StrongWithinCache",
            }),
        );
    },
    updateInboxEntry: (context, event, {info: {}, accountId}) => {
        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "TaskEntry",
                spaceId: event.spaceId,
                accountId,
                taskId: event.taskId,
            },
            oldItem => {
                // When the user comments on a task we archive the corresponding inbox entry. Or
                // if the entry is already archived, we keep it archived. By sending a comment
                // the user implicitly marks their entry as done.
                //
                // If the events were received out-of-order we keep the last archive state
                // of the entry.
                const isArchived =
                    !oldItem?.latestComment ||
                    (event.commentIndex > oldItem.latestComment.index &&
                        (oldItem.latestArchivingCommentIndex === null ||
                            event.commentIndex > oldItem.latestArchivingCommentIndex))
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let isMention;
                let loudNotificationCount;
                if (isArchived) {
                    isMention = false;
                    loudNotificationCount = 0;
                } else {
                    isMention = event.mentionedAccountIds.has(accountId);

                    // We increment the loud notification count only if someone is explicitly
                    // trying to get your attention by mentioning your account. Otherwise, we
                    // expect users will respond to new post comments in their own time.
                    const shouldIncrementLoudNotificationCount = isMention;

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestComment: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                    isStickyMention: boolean;
                };
                let otherCommentAuthorId: AccountId | null;

                if (
                    oldItem?.latestComment &&
                    // Our events may arrive out-of-order. If we have an earlier message index then
                    // what's in the entry's latest message then don't bother updating the latest
                    // message.
                    (oldItem.latestComment.index >= event.commentIndex ||
                        // Or if the latest comment was a mention then we'll leave that in place even
                        // if there are further comments added.
                        (oldItem.latestComment.isStickyMention && !isMention && !isArchived) ||
                        // Or if the message from our event is from the same account as the inbox
                        // owner's then don't update the latest message. Leave the last message from an
                        // account other than our inbox's account in the entry.
                        accountId === event.authorId)
                ) {
                    latestComment = oldItem.latestComment;
                    otherCommentAuthorId = oldItem.otherCommentAuthorId;
                } else {
                    latestComment = {
                        index: event.commentIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
                        isStickyMention: isMention,
                    };

                    if (!oldItem) {
                        otherCommentAuthorId = null;
                    } else {
                        // If the `latestComment`'s author changed then move the old `latestComment`
                        // author into `otherCommentAuthorId`. But not if the old `latestComment`
                        // had our inbox's account as the author.
                        otherCommentAuthorId =
                            oldItem.latestComment &&
                            oldItem.latestComment.authorId !== latestComment.authorId &&
                            oldItem.latestComment.authorId !== accountId
                                ? oldItem.latestComment.authorId
                                : oldItem.otherCommentAuthorId;
                    }
                }

                return {
                    isArchived,
                    loudNotificationCount,
                    latestComment:
                        isArchived && latestComment.isStickyMention
                            ? {...latestComment, isStickyMention: false}
                            : latestComment,
                    latestArchivingCommentIndex:
                        isArchived && !oldItem?.isArchived
                            ? event.commentIndex
                            : oldItem?.latestArchivingCommentIndex ?? null,
                    otherCommentAuthorId,
                };
            },
        );
    },
    getAlertContent: async (context, event, {accountId}) => {
        const [author, taskOwnerResult, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            getTaskOwnerIfPossible(context, event.taskId),
            printNotificationEventAlertContentBody(
                context,
                FileTaskAuthorizer.bind({type: "TaskComments", taskId: event.taskId}),
                event,
            ),
        ]);

        const taskOwner = unwrapResult(taskOwnerResult);

        let subtitle = "";

        if (!event.mentionedAccountIds.has(accountId)) {
            subtitle += "on ";
        } else {
            subtitle += "mentioned you on ";
        }

        if (taskOwner.id === accountId) {
            subtitle += "your";
        } else if (taskOwner.id === event.authorId) {
            subtitle += "their";
        } else {
            subtitle += `${getAccountShortNameWithoutFullNameTooltip(taskOwner.initialData)}’s`;
        }

        subtitle += ` task`;

        return {title: author.initialData.name, subtitle, body};
    },
});

/**
 * Get the posts in a channel posts inbox entry. After you call this function,
 * you're guaranteed that the posts in the corresponding inbox entry will not
 * change anymore. This means you don't need to subscribe to realtime updates
 * of the post list for the entry.
 *
 * This has a side effect of observing the inbox if the inbox has not been
 * observed since the entry was created. By observing the inbox we freeze the
 * underlying channel posts inbox entry so it will accumulate no new posts.
 */
export async function getInboxChannelPostsEntryPosts(
    context: InboxSessionActionContextWithBroadcast,
    {
        spaceId,
        channelId,
        bucketGeneration,
        limit,
        commentLimit,
        afterPostId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        bucketGeneration: number;
        limit: number;
        commentLimit: number;
        afterPostId: PostId | null;
    },
): Promise<{
    totalPostCount: number;
    hasMorePosts: boolean;
    posts: Array<DynamoGeneralRealtimeItem<PostModel>>;
    initialCommentsByPostId: Map<
        PostId,
        {
            comments: ReadonlyArray<PostCommentModel>;
            otherReferencedComments: ReadonlyArray<PostCommentModel>;
        }
    >;
}> {
    await authorizeSpaceAccess(context, spaceId);

    if (afterPostId === null) {
        // If an inbox entry exists then the inbox attributes item should also exist.
        const inboxItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId: context.actor.getAccountId(),
            },
            {
                // Use a strong read consistency to make sure we get the up-to-date generation.
                consistency: "Strong",
            },
        );

        // If the bucket generation is equal to the current inbox generation then we
        // want to increment the inbox's generation. This means new channel posts will
        // create a new entry with a new bucket generation.
        if (bucketGeneration === inboxItem.generation) {
            await InboxTable.updateItem(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                item => {
                    // If the generation was updated concurrently, we don't need to update
                    // it again.
                    if (item.generation !== bucketGeneration) return item;

                    return observeInboxItem(item);
                },
                {initialItem: inboxItem},
            );
        }

        const inboxEntryItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId,
                accountId: context.actor.getAccountId(),
                channelId,
                bucketGeneration,
            },
            {
                // Use a strong read consistency when reading the entry since we don't want to
                // miss any posts.
                //
                // At this point the channel posts entry is frozen. So we don't subscribe to
                // realtime changes for `postIds`. If we get a stale read that's missing a
                // `PostId` the client will never see it.
                consistency: "Strong",
            },
        );

        // If there's only one post then we're going to render the new post post with
        // expanded comments instead of requiring the user to expand the comments on
        // the only post which is lame.
        if (inboxEntryItem.postIds.size === 1 && commentLimit > 0) {
            const postId = Array.from(inboxEntryItem.postIds)[0]!;

            const {post, initialComments, initialOtherReferencedComments} =
                await getPostAndInitialComments(await context.actor.authenticate(), {
                    postId,
                    commentLimit,
                });

            return {
                totalPostCount: 1,
                hasMorePosts: false,
                posts: [post],
                initialCommentsByPostId: new Map([
                    [
                        post.model.id,
                        {
                            comments: initialComments,
                            otherReferencedComments: initialOtherReferencedComments,
                        },
                    ],
                ]),
            };
        }

        const posts = await runAllPromises(
            mapIterable(
                sliceIterable(inboxEntryItem.postIds, 0, limit),
                async postId => await getPost(context, postId),
            ),
        );

        return {
            totalPostCount: inboxEntryItem.postIds.size,
            hasMorePosts: inboxEntryItem.postIds.size > limit,
            posts,
            initialCommentsByPostId: new Map(),
        };
    } else {
        // If we have an `afterPostId` we don't need to observe the inbox because new
        // posts are only added to the beginning of `postIds`. So loading posts after a
        // certain point is guaranteed to be frozen and not update in realtime.
        //
        // If we have an `afterPostId` that also probably means the client has already
        // called this function with `afterPostId` set to null. Which means the current
        // inbox generation should have advanced past our bucket generation.
        const inboxEntryItem = await InboxTable.getItem(context, {
            partitionType: "Inbox",
            sortRangeType: "ChannelPostsEntry",
            spaceId,
            accountId: context.actor.getAccountId(),
            channelId,
            bucketGeneration,
        });

        const postIds = Array.from(inboxEntryItem.postIds);

        const afterPostIndex = postIds.indexOf(afterPostId);
        if (afterPostIndex === -1)
            throw new NotFoundError("`PostId` not found in channel posts inbox entry");

        const posts = await runAllPromises(
            postIds
                .slice(afterPostIndex + 1, afterPostIndex + 1 + limit)
                .map(async postId => await getPost(context, postId)),
        );

        return {
            totalPostCount: inboxEntryItem.postIds.size,
            hasMorePosts: inboxEntryItem.postIds.size > limit + afterPostIndex + 1,
            posts,
            initialCommentsByPostId: new Map(),
        };
    }
}

/**
 * Get all the comment threads in the inbox entry and some initial comments for
 * those threads up to the provided comment limit. After you call this
 * function, you're guaranteed that the list of comment threads in the entry
 * will not change anymore. This means you don't need to subscribe to realtime
 * updates of the document comment thread list for the entry. You still need to
 * subscribe to realtime updates for new comments within threads.
 *
 * This has a side effect of observing the inbox if the inbox has not been
 * observed since the entry was created. By observing the inbox we freeze the
 * underlying document comment threads entry so it will accumulate no
 * new threads.
 */
export async function getInboxDocumentNewCommentThreadsEntryCommentThreads(
    context: InboxSessionActionContextWithBroadcast,
    {
        spaceId,
        documentId,
        bucketGeneration,
        commentLimit,
        commentThreadCountAgainstLimit,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        bucketGeneration: number;
        commentLimit: number;
        commentThreadCountAgainstLimit: number;
    },
): Promise<{
    document: DocumentModel;
    commentThreads: ReadonlyArray<DocumentCommentThreadModel>;
    initialCommentsByCommentThreadId: Map<
        DocumentCommentThreadId,
        {
            comments: Array<DocumentCommentModel>;
            otherReferencedComments: Array<DocumentCommentModel>;
        }
    >;
}> {
    const commentThreadIdsPromise = (async () => {
        await authorizeSpaceAccess(context, spaceId);

        // If an inbox entry exists then the inbox attributes item should also exist.
        const inboxItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId: context.actor.getAccountId(),
            },
            {
                // Use a strong read consistency to make sure we get the up-to-date generation.
                consistency: "Strong",
            },
        );

        // If the bucket generation is equal to the current inbox generation then we
        // want to increment the inbox's generation. This means new comment threads will
        // create a new entry with a new bucket generation.
        if (bucketGeneration === inboxItem.generation) {
            await InboxTable.updateItem(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                item => {
                    // If the generation was updated concurrently, we don't need to update
                    // it again.
                    if (item.generation !== bucketGeneration) return item;

                    return observeInboxItem(item);
                },
                {initialItem: inboxItem},
            );
        }

        const inboxEntryItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "DocumentNewCommentThreadsEntry",
                spaceId,
                accountId: context.actor.getAccountId(),
                documentId,
                bucketGeneration,
            },
            {
                // Use a strong read consistency when reading the entry since we don't want to
                // miss any comment threads.
                //
                // At this point the comment threads entry is frozen. So we don't subscribe to
                // realtime changes for `commentThreadIds`.
                consistency: "Strong",
            },
        );

        return inboxEntryItem.commentThreadIds;
    })();

    const [, {document, commentThreads, initialCommentsByCommentThreadId}] = await runAllPromises([
        commentThreadIdsPromise,
        getDocumentAndCommentThreadsWithInitialComments(context, {
            documentId,
            commentThreadIds: commentThreadIdsPromise,
            commentLimit,
            commentThreadCountAgainstLimit,
        }),
    ]);

    return {
        document,
        commentThreads,
        initialCommentsByCommentThreadId,
    };
}
