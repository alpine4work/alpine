import {addMinutes, differenceInMinutes} from "date-fns";
import {getAccount} from "~/server/dynamo/accounts_table";
import {authorizeChatAccessForAccount, getChat} from "~/server/dynamo/chat_table";
import {
    ActionContext,
    SessionActionContext,
    SystemActionContext,
} from "~/server/dynamo/context/action_context";
import {
    getPostAuthorAndChannelPreview,
    getPostNotificationSubscribers,
} from "~/server/dynamo/forum_table";
import {getContentReferencesForNode} from "~/server/dynamo/helpers/get_content_references";
import {
    DynamoGeneralRealtimeTableSchema,
    DynamoGeneralRealtimeTableSchemaGetTypes,
} from "~/server/dynamo/internal/dynamo_general_realtime_table_schema";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {getContentSnippet} from "~/shared/content/get_content_snippet";
import {
    MessageContent,
    MessageContentSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings";
import {CancelledError, NotFoundError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {randomInteger} from "~/shared/helpers/number/random_integer";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {
    AccountId,
    ChatId,
    ContentMentionAccountId,
    NotificationEventId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/messaging/messaging_shared_styles";
import {AccountModel} from "~/shared/models/account_model";
import {ChatModel} from "~/shared/models/chat_model";
import {
    InboxChatEntryModel,
    InboxEntryKey,
    InboxEntryModel,
    InboxItemModelSchema,
    InboxModel,
    InboxPostCommentsEntryModel,
} from "~/shared/models/inbox_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

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
                         * The last comment on the post. Will be used to render a preview of the post
                         * on the entry before the user clicks in.
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
                        otherCommentAuthorId: Schema.id<AccountId>().nullable().default(null),
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
                            contentSnippet: {doc: item.latestMessage.contentSnippet, references},
                        },
                        otherChatAccount,
                    });
                },
            },
            PostCommentsEntry: {
                async build(context, item) {
                    const [
                        {channel, author: postAuthor},
                        latestCommentAuthor,
                        latestCommentReferences,
                        otherCommentAuthor,
                    ] = await runAllPromises([
                        getPostAuthorAndChannelPreview(context, item.postId),
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

                    return new InboxPostCommentsEntryModel({
                        spaceId: item.spaceId,
                        accountId: item.accountId,
                        postId: item.postId,
                        channel,
                        postAuthor,
                        loudNotificationCount: item.loudNotificationCount,
                        latestComment: {
                            author: latestCommentAuthor,
                            createdTime: item.latestComment.createdTime,
                            contentSnippet: {
                                doc: item.latestComment.contentSnippet,
                                references: latestCommentReferences,
                            },
                        },
                        otherCommentAuthor,
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
] as const;

type InboxTableTypes = DynamoGeneralRealtimeTableSchemaGetTypes<typeof InboxTable>;

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

const NotificationsTable = DynamoTableSchema.new({
    name: "Notifications",
    partitions: [
        /**
         * For every notification event we record a receipt when we start processing it
         * so we only process it once.
         *
         * Receipts eventually expire so we don't have unbounded storage growth.
         */
        {
            name: "NotificationEvent",
            partitionKeyAttributes: {
                eventId: DynamoKeyAttributeSchema.id<NotificationEventId>(),
            },
            sortRanges: [
                {
                    name: "Receipt",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },
            ],
        },
    ],
});

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

/**
 * Get the session account's inbox in the provided space.
 */
export async function getInbox(
    context: SessionActionContext,
    {spaceId}: {spaceId: SpaceId},
): Promise<DynamoGeneralRealtimeItem<InboxModel>> {
    await authorizeSpaceAccess(context, spaceId);

    return context.dynamo.retryTransaction(async context => {
        const inbox = await InboxTable.getRealtimeItemIfExists(context, {
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
        });
        if (inbox) return inbox;

        // If the inbox item doesn't exist yet, let's create one.
        const {getRealtimeItem} = await InboxTable.createItem(context, {
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            generation: initialInboxGeneration,
            loudNotificationCount: 0,
            entryCount: 0,
            lastZeroEntryCountTime: null,
        });
        return getRealtimeItem();
    });
}

/**
 * Get the entries for the current account's inbox.
 */
export async function getInboxEntries(
    context: SessionActionContext,
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
    context: SessionActionContext,
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
export async function observeInbox(
    context: SessionActionContext,
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
        item => ({
            ...item,
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            generation:
                (item?.generation ?? initialInboxGeneration) + observeInboxGenerationIncrement,
            loudNotificationCount: item?.loudNotificationCount ?? 0,
            entryCount: item?.entryCount ?? 0,
            lastZeroEntryCountTime: item?.lastZeroEntryCountTime ?? null,
        }),
    );
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
    context: SessionActionContext,
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
    context: SessionActionContext,
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
    context: ActionContext,
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
    context: ActionContext,
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

export type NotificationCreateChatMessageEvent = SchemaType<
    typeof NotificationCreateChatMessageEventSchema
>;

const NotificationCreateChatMessageEventSchema = Schema.object({
    type: Schema.value("CreateChatMessage"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    chatId: Schema.id<ChatId>(),
    messageIndex: Schema.integer,
    createdTime: Schema.date,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<ContentMentionAccountId>()),
    contentSnippet: MessageContentSchema,
});

export type NotificationCreatePostCommentEvent = SchemaType<
    typeof NotificationCreatePostCommentEventSchema
>;

const NotificationCreatePostCommentEventSchema = Schema.object({
    type: Schema.value("CreatePostComment"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    postId: Schema.id<PostId>(),
    commentIndex: Schema.integer,
    createdTime: Schema.date,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<ContentMentionAccountId>()),
    contentSnippet: MessageContentSchema,
});

// TODO(calebmer): Add message and comment update events in case they add a mention.
export type NotificationEvent = SchemaType<typeof NotificationEventSchema>;

export const NotificationEventSchema = Schema.union({
    CreateChatMessage: NotificationCreateChatMessageEventSchema,
    CreatePostComment: NotificationCreatePostCommentEventSchema,
});

/**
 * Get the content snippet for `MessageContent` for a notification event.
 */
export function getNotificationMessageContentSnippet(content: MessageContent): MessageContent {
    return assertMessageContent(
        getContentSnippet(content.resolve(0), {linesAbove: 0, linesBelow: 1}),
    );
}

export const notificationEventBeforeProcessingTestCheckpoint = new TestCheckpoint<AccountId>();
export const notificationEventAfterProcessingTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Processes a notification generating event by fanning out to subscriber
 * inboxes and notification destinations (like email or mobile push
 * notifications).
 *
 * This function is idempotent. You can call it many times for the same
 * notification event. Important since the function is used in at-least-once
 * delivery queues.
 */
export async function processNotificationEvent(
    context: SystemActionContext,
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
    context: SystemActionContext,
    event: NotificationEvent,
): Promise<void> {
    switch (event.type) {
        case "CreateChatMessage":
            return processNotificationCreateChatMessageEvent(context, event);
        case "CreatePostComment":
            return processNotificationCreatePostCommentEvent(context, event);
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
function createNotificationEventProcessor<
    Event extends NotificationEvent,
    Info extends {spaceId: SpaceId},
>({
    getSubscribers,
    updateInboxEntry,
}: {
    /**
     * Get the accounts subscribed to notifications for this event.
     */
    getSubscribers: (
        context: SystemActionContext,
        event: Event,
    ) => Promise<{
        info: Info;
        accounts: ReadonlyArray<AccountModel>;
    }>;

    /**
     * Update the inbox entry for each subscriber. Called in parallel.
     */
    updateInboxEntry: (
        context: SystemActionContext,
        event: Event,
        options: {
            info: Info;
            account: AccountModel;
        },
    ) => Promise<void>;
}): (context: SystemActionContext, event: Event) => Promise<void> {
    return async (context, event) => {
        await context.tracer.withSpan("Processing notification event", async (context, span) => {
            span.addData({
                notifications: {
                    eventType: event.type,
                    eventId: event.id,
                },
            });

            const [{hasReceiptAlready}, {info, accounts}] = await runAllPromises([
                (async () => {
                    try {
                        await NotificationsTable.createItem(context, {
                            partitionType: "NotificationEvent",
                            sortRangeType: "Receipt",
                            eventId: event.id,
                            // Expire receipts after 10 minutes. This is the [same expiration as DynamoDB
                            // idempotent transactions][1].
                            //
                            // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html#API_TransactWriteItems_RequestSyntax
                            expirationTime: addMinutes(new Date(), 10),
                        });

                        return {hasReceiptAlready: false};
                    } catch (error) {
                        // If the receipt already exists then we already started processing this event.
                        if (isDynamoConditionCheckError(error)) return {hasReceiptAlready: true};

                        throw error;
                    }
                })(),
                getSubscribers(
                    // Use a strong read consistency when getting subscribers so we don't miss
                    // any subscribers added as a part of the notification event.
                    context.dynamo.setDefaultReadConsistency("Strong"),
                    event,
                ),
            ]);

            span.addData({notifications: {inbox: {spaceId: info.spaceId}}});

            // If a receipt exists for this notification then it is being double processed.
            // To make sure this function is idempotent, cancel further execution. Mark our
            // span with an error so it's easy to tell something abnormal happened here.
            if (hasReceiptAlready) {
                span.addException(new CancelledError("Notification has already been processed"));
                return;
            }

            await runAllPromises(
                accounts.map(async account => {
                    await context.tracer.withSpan("Updating inbox entry", async (context, span) => {
                        span.addData({
                            notifications: {
                                eventType: event.type,
                                eventId: event.id,
                                inbox: {spaceId: info.spaceId, accountId: account.id},
                            },
                        });
                        return updateInboxEntry(context, event, {info, account});
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
    context: SystemActionContext,
    event: NotificationEvent,
    itemKey: ItemKey,
    update: (
        item: (InboxEntryItem & ItemKey) | null,
    ) => DistributiveOmit<
        InboxEntryItem & ItemKey,
        DistributiveKeyOf<InboxEntryItemKey> | "generation" | "enteredTime"
    >,
): Promise<void> {
    await context.dynamo.retryTransaction(async context => {
        const [inboxItem, oldInboxEntryItem] = await runAllPromises([
            InboxTable.getItemIfExists(context, {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
            }),
            InboxTable.getItemIfExists(context, itemKey),
        ]);

        const newInboxEntryItemPartial1 = update(oldInboxEntryItem);

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
            return entryItem.latestComment.createdTime;
        default:
            throw exhaustive(entryItem);
    }
}

const processNotificationCreateChatMessageEvent = createNotificationEventProcessor<
    NotificationCreateChatMessageEvent,
    ChatModel
>({
    getSubscribers: async (context, event) => {
        const chat = await getChat(context, event.chatId);
        return {
            info: chat,
            accounts: chat.accounts,
        };
    },
    updateInboxEntry: async (context, event, {info: chat, account}) => {
        await updateInboxEntry(
            context,
            event,
            {
                partitionType: "Inbox",
                sortRangeType: "ChatEntry",
                spaceId: chat.spaceId,
                accountId: account.id,
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
                        ? account.id === event.authorId
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
                        event.mentionedAccountIds.has(account.id) ||
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
                        const eligibleOtherAccounts = chat.accounts.filter(
                            chatAccount =>
                                chatAccount.id !== latestMessageAuthorId &&
                                chatAccount.id !== account.id,
                        );

                        otherAccountId =
                            eligibleOtherAccounts.length > 0
                                ? eligibleOtherAccounts[
                                      randomInteger(0, eligibleOtherAccounts.length)
                                  ]!.id
                                : null;
                    } else {
                        // If the `latestMessage`'s author changed then move the old `latestMessage`
                        // author into `otherAccountId`. But not if the old `latestMessage` had our
                        // inbox's account as the author.
                        otherAccountId =
                            oldItem.latestMessage.authorId !== latestMessage.authorId &&
                            oldItem.latestMessage.authorId !== account.id
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
    {spaceId: SpaceId}
>({
    getSubscribers: async (context, event) => {
        const {spaceId, accounts} = await getPostNotificationSubscribers(context, event.postId);
        return {
            info: {spaceId},
            accounts,
        };
    },
    updateInboxEntry: async (context, event, {info: {spaceId}, account}) => {
        await updateInboxEntry(
            context,
            event,
            {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId,
                accountId: account.id,
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
                    !oldItem || event.commentIndex > oldItem.latestComment.index
                        ? account.id === event.authorId
                        : oldItem.isArchived;

                let loudNotificationCount;
                if (isArchived) {
                    loudNotificationCount = 0;
                } else {
                    // We increment the loud notification count only if someone is explicitly
                    // trying to get your attention by mentioning your account. Otherwise, we
                    // expect users will respond to new post comments in their own time.
                    const shouldIncrementLoudNotificationCount = event.mentionedAccountIds.has(
                        account.id,
                    );

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
                if (oldItem && oldItem.latestComment.index > event.commentIndex) {
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
                            oldItem.latestComment.authorId !== latestComment.authorId &&
                            oldItem.latestComment.authorId !== account.id
                                ? oldItem.latestComment.authorId
                                : oldItem.otherCommentAuthorId;
                    }
                }

                return {
                    isArchived,
                    loudNotificationCount,
                    latestComment,
                    otherCommentAuthorId,
                };
            },
        );
    },
});
