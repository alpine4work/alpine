import {differenceInMinutes} from "date-fns";
import {authorizeChatAccessForAccount, getChatAccountIds} from "~/server/chat/data/chat_table.js";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {printContentSingleLineTextSnippet} from "~/server/content/print_content_single_line_text_snippet.js";
import {
    ServerActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {
    getDocumentAndCommentThreadsWithInitialComments,
    getDocumentCommentAuthorId,
    getDocumentCommentThreadNotificationSubscribers,
    getDocumentPreview,
} from "~/server/documents/data/documents_table.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    DynamoGeneralRealtimeTableSchema,
    DynamoGeneralRealtimeTableSchemaGetTypes,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {
    getChannelPreview,
    getPost,
    getPostAuthorAndChannelPreview,
    getPostNotificationSubscribers,
} from "~/server/forum/data/forum_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {
    NotificationCreateChatMessageEvent,
    NotificationCreateDocumentCommentEvent,
    NotificationCreatePostCommentEvent,
    NotificationCreatePostEvent,
    NotificationEvent,
} from "~/server/notifications/core/notification_event.js";
import {NotificationsContextModuleBase} from "~/server/notifications/core/notifications_context_module_base.js";
import {
    authorizeSpaceAccess,
    expensivelyGetAllSpaceAccounts,
    getAccount,
    isAccountMemberOfSpace,
} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {NotFoundError} from "~/shared/error/error.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    ContentMentionAccountId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {MessageContent, MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/messaging/messaging_shared_styles.js";
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
} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * The initial generation of a new inbox.
 */
const initialInboxGeneration = 0;

const InboxTable = DynamoGeneralRealtimeTableSchema.new({
    name: "Inbox",
    partitions: [
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
                    name: "Attributes",
                    sortKeyAttributes: {},
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
                         * The last message in the chat. Will be used to render a preview of the chat
                         * on the entry before the user clicks in.
                         */
                        latestMessage: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                        }),

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
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                        }).nullable(),

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
                         */
                        latestComment: Schema.object({
                            index: Schema.integer,
                            authorId: Schema.id<AccountId>(),
                            createdTime: Schema.date,
                            contentSnippet: MessageContentSchema,
                        }),

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
            ],
        },
    ],
    modelSchema: InboxItemModelSchema,
    models: {
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
                            getContentReferencesForNode(
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
                        latestMessage: {
                            author,
                            createdTime: item.latestMessage.createdTime,
                            contentTextSnippet: printContentSingleLineTextSnippet({
                                doc: item.latestMessage.contentSnippet,
                                references,
                            }),
                        },
                        otherChatAccount,
                    });
                },
            },
            PostCommentsEntry: {
                async build(context, item) {
                    const [
                        {channel, author: postAuthor},
                        latestComment,
                        otherCommentAuthor,
                        postContentSnippetIfMentioned,
                    ] = await runAllPromises([
                        getPostAuthorAndChannelPreview(context, item.postId),
                        item.latestComment
                            ? runAllObjectPromises({
                                  comment: item.latestComment,
                                  author: getAccount(
                                      context,
                                      item.spaceId,
                                      item.latestComment.authorId,
                                  ),
                                  references: getContentReferencesForNode(
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
                        postCreatedTime: item.postCreatedTime,
                        postContentTextSnippetIfMentioned: postContentSnippetIfMentioned
                            ? printContentSingleLineTextSnippet(postContentSnippetIfMentioned)
                            : null,
                        latestComment: latestComment
                            ? {
                                  author: latestComment.author,
                                  createdTime: latestComment.comment.createdTime,
                                  contentTextSnippet: printContentSingleLineTextSnippet({
                                      doc: latestComment.comment.contentSnippet,
                                      references: latestComment.references,
                                  }),
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
                        channel,
                        latestPostAuthor,
                        latestPostContentSnippetReferences,
                        otherPostAuthor,
                    ] = await runAllPromises([
                        getChannelPreview(context, item.channelId),
                        getAccount(context, item.spaceId, item.latestPost.authorId),
                        getContentReferencesForNode(
                            context,
                            item.spaceId,
                            item.latestPost.contentSnippet,
                        ),
                        otherPostAuthorId
                            ? getAccount(context, item.spaceId, otherPostAuthorId)
                            : null,
                    ]);

                    return new InboxChannelPostsEntryModel({
                        spaceId: item.spaceId,
                        accountId: item.accountId,
                        loudNotificationCount: item.loudNotificationCount,
                        channel,
                        bucketGeneration: item.bucketGeneration,
                        postCount: item.postIds.size,
                        postAuthorCount: item.postAuthorIds.size,
                        latestPost: {
                            author: latestPostAuthor,
                            createdTime: item.latestPost.createdTime,
                            contentTextSnippet: printContentSingleLineTextSnippet({
                                doc: item.latestPost.contentSnippet,
                                references: latestPostContentSnippetReferences,
                            }),
                        },
                        otherPostAuthor,
                    });
                },
            },
            DocumentCommentThreadEntry: {
                async build(context, item) {
                    const [
                        document,
                        firstCommentAuthor,
                        latestCommentAuthor,
                        latestCommentContentSnippetReferences,
                        otherCommentAuthor,
                    ] = await runAllPromises([
                        getDocumentPreview(context, item.documentId),
                        getAccount(context, item.spaceId, item.firstCommentAuthorId),
                        getAccount(context, item.spaceId, item.latestComment.authorId),
                        getContentReferencesForNode(
                            context,
                            item.spaceId,
                            item.latestComment.contentSnippet,
                        ),
                        item.otherCommentAuthorId
                            ? getAccount(context, item.spaceId, item.otherCommentAuthorId)
                            : null,
                    ]);

                    return new InboxDocumentCommentThreadEntryModel({
                        spaceId: item.spaceId,
                        accountId: item.accountId,
                        loudNotificationCount: item.loudNotificationCount,
                        document,
                        commentThreadId: item.commentThreadId,
                        firstCommentAuthor,
                        latestComment: {
                            author: latestCommentAuthor,
                            createdTime: item.latestComment.createdTime,
                            contentTextSnippet: printContentSingleLineTextSnippet({
                                doc: item.latestComment.contentSnippet,
                                references: latestCommentContentSnippetReferences,
                            }),
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
                        document,
                        firstCommentAuthor,
                        firstCommentContentSnippetReferences,
                        otherCommentThreadAuthor,
                    ] = await runAllPromises([
                        getDocumentPreview(context, item.documentId),
                        getAccount(context, item.spaceId, item.firstComment.authorId),
                        getContentReferencesForNode(
                            context,
                            item.spaceId,
                            item.firstComment.contentSnippet,
                        ),
                        otherCommentThreadAuthorId
                            ? getAccount(context, item.spaceId, otherCommentThreadAuthorId)
                            : null,
                    ]);

                    return new InboxDocumentNewCommentThreadsEntryModel({
                        spaceId: item.spaceId,
                        accountId: item.accountId,
                        loudNotificationCount: item.loudNotificationCount,
                        document,
                        bucketGeneration: item.bucketGeneration,
                        commentThreadCount: item.commentThreadIds.size,
                        commentThreadAuthorCount: item.commentThreadAuthorIds.size,
                        firstComment: {
                            author: firstCommentAuthor,
                            createdTime: item.firstComment.createdTime,
                            contentTextSnippet: printContentSingleLineTextSnippet({
                                doc: item.firstComment.contentSnippet,
                                references: firstCommentContentSnippetReferences,
                            }),
                        },
                        otherCommentThreadAuthor,
                    });
                },
            },
        },
    },
    sendEventTransaction: (context, readTime, eventTransaction) =>
        context.notifications.sendInboxRealtimeEventTransaction(readTime, eventTransaction),
});

const inboxEntryItemTypes = [
    {partitionType: "Inbox", sortRangeType: "ChatEntry"},
    {partitionType: "Inbox", sortRangeType: "PostCommentsEntry"},
    {partitionType: "Inbox", sortRangeType: "ChannelPostsEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentCommentThreadEntry"},
    {partitionType: "Inbox", sortRangeType: "DocumentNewCommentThreadsEntry"},
] as const;

type InboxTableTypes = DynamoGeneralRealtimeTableSchemaGetTypes<typeof InboxTable>;

type InboxAttributesItem = MergeObjectIntersection<
    InboxTableTypes["Item"] & {
        readonly partitionType: "Inbox";
        readonly sortRangeType: "Attributes";
    }
>;

type InboxEntryItem = MergeObjectIntersection<
    InboxTableTypes["Item"] & (typeof inboxEntryItemTypes)[number]
>;

type InboxEntryItemKey = MergeObjectIntersection<
    InboxTableTypes["ItemKey"] & (typeof inboxEntryItemTypes)[number]
>;

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
        partitionType: "Inbox",
        sortRangeType: "Attributes",
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
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    {spaceId, consistency = "Eventual"}: {spaceId: SpaceId; consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<InboxModel>> {
    await authorizeSpaceAccess(context, spaceId);

    return context.dynamo.retryTransaction(async context => {
        const inbox = await InboxTable.getRealtimeItemIfExists(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId,
                accountId: context.actor.getAccountId(),
            },
            {consistency},
        );
        if (inbox) return inbox;

        // If the inbox item doesn't exist yet, let's create one.
        const {getRealtimeItem} = await InboxTable.createItem(
            context,
            getInitialInboxItem(spaceId, context.actor.getAccountId()),
        );
        return getRealtimeItem();
    });
}

/**
 * Get the entries for the current account's inbox.
 */
export async function getInboxEntries(
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
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
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
        });

        assert(
            (inboxItem?.entryCount ?? 0) === result.items.length,
            "Expected inbox item's `entryCount` to have the correct number of non-archived inbox entries",
        );

        assert(
            (inboxItem?.loudNotificationCount ?? 0) ===
                result.items.reduce(
                    (loudNotificationCount, item) =>
                        loudNotificationCount + item.model.loudNotificationCount,
                    0,
                ),
            "Expected inbox item's `loudNotificationCount` to be the sum of all non-archived inbox entry loud notification counts",
        );
    }

    return result;
}

/**
 * Backfill any inbox entry updates between now and `readTime`. Use when you
 * connect to realtime after reading data to make sure you haven't missed
 * any updates.
 *
 * This will backfill updates both for non-archived and archived entries.
 */
export async function backfillInboxEntries(
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    {spaceId, readTime}: {spaceId: SpaceId; readTime: Date},
) {
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
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    {spaceId}: {spaceId: SpaceId},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    await InboxTable.updateItem(
        context,
        {
            partitionType: "Inbox",
            sortRangeType: "Attributes",
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
        default:
            throw exhaustive(key);
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
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
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
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
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
    context: Context<ServerActionContextModules & {notifications: NotificationsContextModuleBase}>,
    itemKey: InboxEntryItemKey,
): Promise<{archiveTime: Date}> {
    await authorizeSpaceAccess(context, itemKey.spaceId);

    return context.dynamo.retryTransaction(async context => {
        const [inboxItem, inboxEntryItem] = await runAllPromises([
            InboxTable.getItemIfExists(context, {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
            }),
            InboxTable.getItemIfExists(context, itemKey),
        ]);

        if (!inboxEntryItem) throw new NotFoundError("Inbox entry not found");

        assert(
            inboxItem,
            "Can't have inbox entry item without corresponding inbox attributes item",
        );

        // If the inbox entry item is already archived, do nothing.
        if (inboxEntryItem.isArchived) return {archiveTime: inboxEntryItem.enteredTime};

        const archiveTime = new Date();

        const newInboxEntryItem = {
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

        // `Math.max` to protect against in case we under-counted the number of inbox
        // entries at some point.
        const newEntryCount = Math.max(0, inboxItem.entryCount - 1);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
            InboxTable.transactionDirectlyUpdateItem({
                ...inboxItem,
                loudNotificationCount:
                    inboxItem.loudNotificationCount - inboxEntryItem.loudNotificationCount,
                entryCount: newEntryCount,
                lastZeroEntryCountTime:
                    newEntryCount === 0 && inboxItem.entryCount !== 0
                        ? archiveTime
                        : inboxItem.lastZeroEntryCountTime,
            }),
            InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
        ]);

        return {archiveTime};
    });
}

async function unarchiveInboxEntryItemKey(
    context: Context<ServerActionContextModules & {notifications: NotificationsContextModuleBase}>,
    itemKey: InboxEntryItemKey,
): Promise<void> {
    await authorizeSpaceAccess(context, itemKey.spaceId);

    await context.dynamo.retryTransaction(async context => {
        const [inboxItem, inboxEntryItem] = await runAllPromises([
            InboxTable.getItemIfExists(context, {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
            }),
            InboxTable.getItemIfExists(context, itemKey),
        ]);

        if (!inboxEntryItem) throw new NotFoundError("Inbox entry not found");

        assert(
            inboxItem,
            "Can't have inbox entry item without corresponding inbox attributes item",
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

export const notificationEventBeforeProcessingTestCheckpoint = new TestCheckpoint<AccountId>();
export const notificationEventAfterProcessingTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Processes a notification generating event by fanning out to subscriber
 * inboxes and notification destinations (like email or mobile push
 * notifications).
 */
export async function processNotificationEvent(
    context: Context<
        ServerSystemActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    event: NotificationEvent,
): Promise<void> {
    await notificationEventBeforeProcessingTestCheckpoint.waitForTest(event.authorId);
    try {
        await actuallyProcessNotificationEvent(context, event);
    } finally {
        await notificationEventAfterProcessingTestCheckpoint.waitForTest(event.authorId);
    }
}

function actuallyProcessNotificationEvent(
    context: Context<
        ServerSystemActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    event: NotificationEvent,
): Promise<void> {
    switch (event.type) {
        case "CreateChatMessage":
            return processNotificationCreateChatMessageEvent(context, event);
        case "CreatePostComment":
            return processNotificationCreatePostCommentEvent(context, event);
        case "CreatePost":
            return processNotificationCreatePostEvent(context, event);
        case "CreateDocumentComment":
            return processNotificationCreateDocumentCommentEvent(context, event);
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
 */
function createNotificationEventProcessor<Event extends NotificationEvent, Info>({
    getSubscribers,
    updateInboxEntry,
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
        context: Context<
            ServerSystemActionContextModules & {notifications: NotificationsContextModuleBase}
        >,
        event: Event,
    ) => Promise<{
        info: Info;
        accountIds: Iterable<AccountId | ContentMentionAccountId>;
    }>;

    /**
     * Update the inbox entry for each subscriber. Called in parallel.
     */
    updateInboxEntry: (
        context: Context<
            ServerSystemActionContextModules & {notifications: NotificationsContextModuleBase}
        >,
        event: Event,
        options: {
            info: Info;
            accountId: AccountId;
        },
    ) => Promise<void>;
}): (
    context: Context<
        ServerSystemActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    event: Event,
) => Promise<void> {
    return async (context, event) => {
        await context.tracer.withSpan("Process notification event", async (context, span) => {
            span.addData({
                notifications: {
                    eventType: event.type,
                    eventId: event.id,
                    inbox: {spaceId: event.spaceId},
                },
            });

            const {info, accountIds} = await getSubscribers(context, event);

            await runAllPromises(
                mapIterable(accountIds, async accountOrMentionId => {
                    // Only update the inbox entry for accounts that are a member of the space the
                    // event is a part of.
                    if (
                        !(await isAccountMemberOfSpace(context, event.spaceId, accountOrMentionId))
                    ) {
                        return;
                    }

                    // This is a verified `AccountId` after the `isAccountMemberOfSpace()`
                    // check above.
                    const accountId = accountOrMentionId as AccountId;

                    await context.tracer.withSpan("Updating inbox entry", async (context, span) => {
                        span.addData({
                            notifications: {
                                eventType: event.type,
                                eventId: event.id,
                                inbox: {spaceId: event.spaceId, accountId: accountId},
                            },
                        });

                        return updateInboxEntry(context, event, {info, accountId});
                    });
                }),
            );
        });
    };
}

/**
 * Helper function for updating an inbox entry and the main inbox attributes
 * item along with it. Makes sure to keep everything consistent. For example,
 * updating the inbox total loud notification count when the entry loud
 * notification count updates.
 */
async function updateInboxEntry<ItemKey extends InboxEntryItemKey>(
    context: Context<
        ServerSystemActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    event: NotificationEvent,
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
): Promise<void> {
    let hasAttempted = false;

    await context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAttempted;
        hasAttempted = true;

        const [inboxItem, oldInboxEntryItem] = await runAllPromises([
            isInitialAttempt && initialInboxItemIfExists !== undefined
                ? initialInboxItemIfExists
                : InboxTable.getItemIfExists(context, {
                      partitionType: "Inbox",
                      sortRangeType: "Attributes",
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
            return;
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

        // Optimization: If the inbox item isn't changing don't run a transaction.
        if (inboxItem && loudNotificationCountDifference === 0 && entryCountDifference === 0) {
            await InboxTable.directlyUpdateItem(context, newInboxEntryItem);
        } else {
            const oldEntryCount = inboxItem?.entryCount ?? 0;

            // `Math.max` to protect against in case we under-counted the number of inbox
            // entries at some point.
            const newEntryCount = Math.max(0, oldEntryCount + entryCountDifference);

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                InboxTable.transactionDirectlyUpdateItem({
                    ...inboxItem,
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
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
                }),
                InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
            ]);
        }
    });
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
        default:
            throw exhaustive(entryItem);
    }
}

const processNotificationCreateChatMessageEvent = createNotificationEventProcessor<
    NotificationCreateChatMessageEvent,
    {spaceId: SpaceId; accountIds: ReadonlyArray<AccountId>}
>({
    getSubscribers: async (context, event) => {
        const {spaceId, accountIds} = await getChatAccountIds(context, event.chatId, {
            consistency: "Strong",
        });
        return {
            info: {spaceId, accountIds},
            accountIds,
        };
    },
    updateInboxEntry: async (
        context,
        event,
        {info: {spaceId, accountIds: chatAccountIds}, accountId},
    ) => {
        await updateInboxEntry(
            context,
            event,
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
                    !oldItem || event.messageIndex > oldItem.latestMessage.index
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let loudNotificationCount;
                if (isArchived) {
                    loudNotificationCount = 0;
                } else {
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
                    const shouldIncrementLoudNotificationCount =
                        event.mentionedAccountIds.has(accountId) ||
                        oldItem?.isArchived ||
                        !oldItem?.latestMessage ||
                        // Events might arrive out-of-order but if events 10min+ apart are arriving
                        // out-of-order we have a bigger problem so we don't worry about the
                        // out-of-order case when subtracting timestamps here.
                        differenceInMinutes(event.createdTime, oldItem.latestMessage.createdTime) >=
                            minMessageViewTimestampDividerElapsedMinutes;

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestMessage: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                };
                let otherAccountId: AccountId | null;

                // Our events may arrive out-of-order. If we have an earlier message index then
                // what's in the entry's latest message then don't bother updating the latest
                // message.
                if (oldItem && oldItem.latestMessage.index > event.messageIndex) {
                    latestMessage = oldItem.latestMessage;
                    otherAccountId = oldItem.otherAccountId;
                } else {
                    latestMessage = {
                        index: event.messageIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
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
                    latestMessage,
                    otherAccountId,
                };
            },
        );
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
            {consistency: "Strong"},
        );
        return {
            info: {postCreatedTime},
            accountIds,
        };
    },
    updateInboxEntry: async (context, event, {info: {postCreatedTime}, accountId}) => {
        await updateInboxEntry(
            context,
            event,
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
                    !oldItem?.latestComment || event.commentIndex > oldItem.latestComment.index
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let loudNotificationCount;
                if (isArchived) {
                    loudNotificationCount = 0;
                } else {
                    // We increment the loud notification count only if someone is explicitly
                    // trying to get your attention by mentioning your account. Otherwise, we
                    // expect users will respond to new post comments in their own time.
                    const shouldIncrementLoudNotificationCount =
                        event.mentionedAccountIds.has(accountId);

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestComment: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                };
                let otherCommentAuthorId: AccountId | null;

                // Our events may arrive out-of-order. If we have an earlier message index then
                // what's in the entry's latest message then don't bother updating the latest
                // message.
                if (oldItem?.latestComment && oldItem.latestComment.index > event.commentIndex) {
                    latestComment = oldItem.latestComment;
                    otherCommentAuthorId = oldItem.otherCommentAuthorId;
                } else {
                    latestComment = {
                        index: event.commentIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
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
                    latestComment,
                    otherCommentAuthorId,
                };
            },
        );
    },
});

const processNotificationCreatePostEvent = createNotificationEventProcessor<
    NotificationCreatePostEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        // TODO(calebmer): For now, until we implement channel subscriptions, every
        // account gets a notification for any new post in every channel. When we have
        // channel subscriptions, a mention should deliver a notification regardless of
        // whether the mentioned user is in the channel.
        const accounts = await expensivelyGetAllSpaceAccounts(context, event.spaceId);

        return {
            info: {},
            accountIds: accounts.map(account => account.id),
        };
    },
    updateInboxEntry: async (context, event, {info: {}, accountId}) => {
        // Don't update an entry for the account who created the post.
        if (event.authorId === accountId) return;

        // If the account was mentioned in the post, we create a separate entry with a
        // loud notification instead of merging into one channel post summary entry.
        if (event.mentionedAccountIds.has(accountId)) {
            await updateInboxEntry(
                context,
                event,
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
                        otherCommentAuthorId: null,
                    };
                },
            );
            return;
        }

        const inboxItem = await InboxTable.getItemIfExists(context, {
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId: event.spaceId,
            accountId,
        });

        await updateInboxEntry(
            context,
            event,
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
                    latestPost: {
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
                    },
                };
            },
            {initialInboxItemIfExists: inboxItem},
        );
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
            consistency: "Strong",
        });

        return {
            info: {},
            accountIds,
        };
    },
    updateInboxEntry: async (context, event, {info: {}, accountId}) => {
        const isFirstComment = event.commentIndex === 0;

        // The first comment in a thread (if it doesn't contain a mention of our user)
        // is batched into a "new comments" inbox entry. This makes it easier for the
        // document owner to browse new comments.
        if (isFirstComment && !event.mentionedAccountIds.has(accountId)) {
            // Don't update a new comment threads entry for the account who authored
            // the comment.
            if (event.authorId === accountId) return;

            const inboxItem = await InboxTable.getItemIfExists(context, {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: event.spaceId,
                accountId,
            });

            await updateInboxEntry(
                context,
                event,
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
                            authorId: event.authorId,
                            createdTime: event.createdTime,
                            contentSnippet: event.contentSnippet,
                        },
                        latestCommentThreadCreatedTime: event.createdTime,
                    };
                },
                {initialInboxItemIfExists: inboxItem},
            );
            return;
        }

        await updateInboxEntry(
            context,
            event,
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
                    !oldItem?.latestComment || event.commentIndex > oldItem.latestComment.index
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let loudNotificationCount;
                if (isArchived) {
                    loudNotificationCount = 0;
                } else {
                    // We increment the loud notification count only if someone is explicitly
                    // trying to get your attention by mentioning your account. Otherwise, we
                    // expect users will respond to new post comments in their own time.
                    const shouldIncrementLoudNotificationCount =
                        event.mentionedAccountIds.has(accountId);

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestComment: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    contentSnippet: MessageContent;
                };
                let otherCommentAuthorId: AccountId | null;

                // Our events may arrive out-of-order. If we have an earlier message index then
                // what's in the entry's latest message then don't bother updating the latest
                // message.
                if (oldItem?.latestComment && oldItem.latestComment.index > event.commentIndex) {
                    latestComment = oldItem.latestComment;
                    otherCommentAuthorId = oldItem.otherCommentAuthorId;
                } else {
                    latestComment = {
                        index: event.commentIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        contentSnippet: event.contentSnippet,
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
                    latestComment,
                    otherCommentAuthorId,
                };
            },
        );
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
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
    {
        spaceId,
        channelId,
        bucketGeneration,
        limit,
        afterPostId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        bucketGeneration: number;
        limit: number;
        afterPostId: PostId | null;
    },
): Promise<{
    hasMorePosts: boolean;
    posts: Array<PostModel>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    if (afterPostId === null) {
        // If an inbox entry exists then the inbox attributes item should also exist.
        const inboxItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
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
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                item => {
                    assert(item);

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

        const posts = await runAllPromises(
            mapIterable(sliceIterable(inboxEntryItem.postIds, 0, limit), postId =>
                getPost(context, postId),
            ),
        );

        return {
            hasMorePosts: inboxEntryItem.postIds.size > limit,
            posts,
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
                .map(postId => getPost(context, postId)),
        );

        return {
            hasMorePosts: inboxEntryItem.postIds.size > limit + afterPostIndex + 1,
            posts,
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
    context: Context<
        ServerSessionActionContextModules & {notifications: NotificationsContextModuleBase}
    >,
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
    commentThreads: Array<DocumentCommentThreadModel>;
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
                partitionType: "Inbox",
                sortRangeType: "Attributes",
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
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                item => {
                    assert(item);

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
