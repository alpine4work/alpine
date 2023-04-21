import {addMinutes, differenceInMinutes} from "date-fns";
import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/dynamo/accounts_table";
import {getChat} from "~/server/dynamo/chat_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {SystemContext} from "~/server/dynamo/context/system_context";
import {getPostNotificationSubscribers} from "~/server/dynamo/forum_table";
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
import {CancelledError, NotFoundError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
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
import {emptyContentReferences} from "~/shared/models/content_references";
import {
    InboxChatEntryModel,
    InboxEntryKey,
    InboxEntryModel,
    InboxModel,
    InboxPostCommentsEntryModel,
} from "~/shared/models/inbox_model";
import {Schema} from "~/shared/schema/schema";

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
                    }),
                },
            ],
        },
    ],
    models: {
        Inbox: {
            Attributes: {
                async build(context, item) {
                    return new InboxModel({
                        loudNotificationCount: item.loudNotificationCount,
                    });
                },
            },
            ChatEntry: {
                async build(context, item) {
                    const [author] = await runAllPromises([
                        dangerouslyGetAccountIfExistsWithoutAuthorization(
                            context,
                            item.latestMessage.authorId,
                        ),
                        // NOCOMMIT
                        // getContentReferencesForNode(
                        //     context,
                        //     item.spaceId,
                        //     item.latestMessage.contentSnippet,
                        // ),
                    ]);

                    const references = emptyContentReferences;

                    return new InboxChatEntryModel({
                        chatId: item.chatId,
                        loudNotificationCount: item.loudNotificationCount,
                        latestMessage: {
                            author,
                            createdTime: item.latestMessage.createdTime,
                            contentSnippet: {doc: item.latestMessage.contentSnippet, references},
                        },
                    });
                },
            },
            PostCommentsEntry: {
                async build(context, item) {
                    const [author] = await runAllPromises([
                        dangerouslyGetAccountIfExistsWithoutAuthorization(
                            context,
                            item.latestComment.authorId,
                        ),
                        // NOCOMMIT:
                        // getContentReferencesForNode(
                        //     context,
                        //     item.spaceId,
                        //     item.latestComment.contentSnippet,
                        // ),
                    ]);

                    const references = emptyContentReferences;

                    return new InboxPostCommentsEntryModel({
                        postId: item.postId,
                        loudNotificationCount: item.loudNotificationCount,
                        latestComment: {
                            author,
                            createdTime: item.latestComment.createdTime,
                            contentSnippet: {doc: item.latestComment.contentSnippet, references},
                        },
                    });
                },
            },
        },
    },
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
 * Get the entries for the current account's inbox.
 */
export async function getInboxEntries(
    context: RequestContext,
    {
        spaceId,
        limit,
    }: {
        spaceId: SpaceId;
        limit: number;
    },
): Promise<{
    entries: ReadonlyArray<InboxEntryModel>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const entries = await InboxEntriesIndex.query(context, {
        partitionKey: {
            spaceId,
            accountId: context.auth.getAccountId(),
        },
        endSortKey: {
            isArchived: false,
            generation: InboxEntriesIndex.sortKeyAttributes.generation.maxValue,
            enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
        },
        limit,
    });

    // NOCOMMIT: Return all the realtime stuffs
    return {entries: entries.items.map(item => item.model)};
}

/**
 * Mark the current account's inbox as observed. Any loud notifications will
 * freeze in place at this point.
 */
export async function observeInbox(
    context: RequestContext,
    {spaceId}: {spaceId: SpaceId},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    await InboxTable.updateItem(
        context,
        {
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.auth.getAccountId(),
        },
        item => ({
            ...item,
            partitionType: "Inbox",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.auth.getAccountId(),
            generation:
                (item?.generation ?? initialInboxGeneration) + observeInboxGenerationIncrement,
            loudNotificationCount: item?.loudNotificationCount ?? 0,
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
 */
export function archiveInboxEntry(
    context: RequestContext,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<void> {
    return archiveInboxEntryItemKey(
        context,
        getInboxEntryItemKey({
            spaceId,
            accountId: context.auth.getAccountId(),
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
    context: RequestContext,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<void> {
    return unarchiveInboxEntryItemKey(
        context,
        getInboxEntryItemKey({
            spaceId,
            accountId: context.auth.getAccountId(),
            key,
        }),
    );
}

async function archiveInboxEntryItemKey(
    context: RequestContext,
    itemKey: InboxEntryItemKey,
): Promise<void> {
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

        // If the inbox entry item is already archived, do nothing.
        if (inboxEntryItem.isArchived) return;

        const newInboxEntryItem = {
            ...inboxEntryItem,
            isArchived: true,
            // Archiving an entry clears all of its loud notifications.
            loudNotificationCount: 0,
        };

        // Optimization: If we don't need to update the inbox item, save some write
        // capacity units.
        if (inboxEntryItem.loudNotificationCount === 0) {
            await InboxTable.directlyUpdateItem(context, newInboxEntryItem);
        } else {
            await DynamoTableSchema.executeTransaction(context, [
                InboxTable.transactionDirectlyUpdateItem({
                    ...inboxItem,
                    loudNotificationCount:
                        inboxItem.loudNotificationCount - inboxEntryItem.loudNotificationCount,
                }),
                InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
            ]);
        }
    });
}

async function unarchiveInboxEntryItemKey(
    context: RequestContext,
    itemKey: InboxEntryItemKey,
): Promise<void> {
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

        await InboxTable.directlyUpdateItem(context, {
            ...inboxEntryItem,
            isArchived: false,
            // When unarchiving, move the unarchived entry to the top of the inbox so it's
            // easier to find. Unarchiving is a clear signal from the user that they care
            // about this entry.
            generation: inboxItem.generation + unarchivedInboxEntryGenerationIncrement,
            enteredTime: new Date(),
        });
    });
}

// TODO(calebmer): Add message and comment update events in case they add a mention.
export type NotificationEvent =
    | NotificationCreateChatMessageEvent
    | NotificationCreatePostCommentEvent;

export type NotificationCreateChatMessageEvent = {
    readonly type: "CreateChatMessage";
    readonly id: NotificationEventId;
    readonly chatId: ChatId;
    readonly messageIndex: number;
    readonly createdTime: Date;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlySet<ContentMentionAccountId>;
    readonly contentSnippet: MessageContent;
};

export type NotificationCreatePostCommentEvent = {
    readonly type: "CreatePostComment";
    readonly id: NotificationEventId;
    readonly postId: PostId;
    readonly commentIndex: number;
    readonly createdTime: Date;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlySet<ContentMentionAccountId>;
    readonly contentSnippet: MessageContent;
};

/**
 * Get the content snippet for `MessageContent` for a notification event.
 */
export function getNotificationMessageContentSnippet(content: MessageContent): MessageContent {
    return assertMessageContent(
        getContentSnippet(content.resolve(0), {linesAbove: 0, linesBelow: 3}),
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
    context: SystemContext,
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
    context: SystemContext,
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
        context: SystemContext,
        event: Event,
    ) => Promise<{
        info: Info;
        accounts: ReadonlyArray<AccountModel>;
    }>;

    /**
     * Update the inbox entry for each subscriber. Called in parallel.
     */
    updateInboxEntry: (
        context: SystemContext,
        event: Event,
        options: {
            info: Info;
            account: AccountModel;
        },
    ) => Promise<void>;
}): (context: SystemContext, event: Event) => Promise<void> {
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
    context: SystemContext,
    event: NotificationEvent,
    itemKey: ItemKey,
    update: (
        item: (InboxEntryItem & ItemKey) | null,
    ) => DistributiveOmit<
        InboxEntryItem & ItemKey,
        DistributiveKeyOf<InboxEntryItemKey> | "isArchived" | "generation" | "enteredTime"
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

        const loudNotificationCountDifference =
            newInboxEntryItemPartial1.loudNotificationCount -
            (oldInboxEntryItem?.loudNotificationCount ?? 0);

        const inboxGeneration = inboxItem?.generation ?? initialInboxGeneration;

        const newInboxEntryItemPartial2 = {
            ...newInboxEntryItemPartial1,
            ...itemKey,
            updateLockVersion: oldInboxEntryItem?.updateLockVersion,
        } as DistributiveOmit<
            InboxEntryItem & ItemKey,
            "isArchived" | "generation" | "enteredTime"
        >;

        // Unarchive the inbox entry after a notification.
        let isArchived = false;

        // If the notification event author is the owner of this inbox then we have a
        // "silent" notification. A silent notification updates the inbox entry so it's
        // recent but does not deliver a push notification to the user or update any
        // notification indicator.
        //
        // An edge case is when a notification event creates a loud notification for
        // the event author. Usually we defend against this in our notification event
        // implementations.
        //
        // - If there is no existing inbox entry, don't create one
        // - If there is an existing archived inbox entry then keep it in the archive
        if (event.authorId === itemKey.accountId && loudNotificationCountDifference === 0) {
            if (!oldInboxEntryItem) {
                return;
            } else {
                isArchived = oldInboxEntryItem.isArchived;
            }
        }

        // Move the entry to the top of the inbox if:
        //
        // - The entry is newly created; OR
        // - The entry is revived from the archive; OR
        // - The entry has a loud notification
        const shouldMoveToTop =
            !oldInboxEntryItem ||
            (!isArchived && oldInboxEntryItem.isArchived) ||
            loudNotificationCountDifference > 0;

        await DynamoTableSchema.executeTransaction(context, [
            InboxTable.transactionDirectlyUpdateItem({
                ...inboxItem,
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
                generation: inboxGeneration,
                loudNotificationCount:
                    (inboxItem?.loudNotificationCount ?? 0) + loudNotificationCountDifference,
            }),
            InboxTable.transactionDirectlyUpdateItem({
                ...newInboxEntryItemPartial2,
                isArchived,

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
                    : oldInboxEntryItem.generation,

                enteredTime: shouldMoveToTop
                    ? getInboxEntryLatestUpdateTime(newInboxEntryItemPartial2)
                    : oldInboxEntryItem.enteredTime,
            }),
        ]);
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
    {spaceId: SpaceId}
>({
    getSubscribers: async (context, event) => {
        const chat = await getChat(context.system.impersonateAccount(event.authorId), event.chatId);
        return {
            info: {spaceId: chat.spaceId},
            accounts: chat.accounts,
        };
    },
    updateInboxEntry: async (context, event, {info: {spaceId}, account}) => {
        await updateInboxEntry(
            context,
            event,
            {
                partitionType: "Inbox",
                sortRangeType: "ChatEntry",
                spaceId,
                accountId: account.id,
                chatId: event.chatId,
            },
            item => {
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
                    account.id !== event.authorId &&
                    (event.mentionedAccountIds.has(account.id) ||
                        item?.isArchived ||
                        !item?.latestMessage ||
                        // Events might arrive out-of-order but if events 10min+ apart are arriving
                        // out-of-order we have a bigger problem so we don't worry about the
                        // out-of-order case when subtracting timestamps here.
                        differenceInMinutes(event.createdTime, item.latestMessage.createdTime) >=
                            minMessageViewTimestampDividerElapsedMinutes);

                return {
                    loudNotificationCount:
                        (item?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0),

                    // Events may arrive out-of-order so double check that the message index in
                    // the event is actually the latest message.
                    latestMessage:
                        item && item.latestMessage.index > event.messageIndex
                            ? item.latestMessage
                            : {
                                  index: event.messageIndex,
                                  authorId: event.authorId,
                                  createdTime: event.createdTime,
                                  contentSnippet: event.contentSnippet,
                              },
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
            item => {
                // We increment the loud notification count only if someone is explicitly
                // trying to get your attention by mentioning your account. Otherwise, we
                // expect users will respond to new post comments in their own time.
                const shouldIncrementLoudNotificationCount =
                    account.id !== event.authorId && event.mentionedAccountIds.has(account.id);

                return {
                    loudNotificationCount:
                        (item?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0),

                    // Events may arrive out-of-order so double check that the comment index in
                    // the event is actually the latest comment.
                    latestComment:
                        item && item.latestComment.index > event.commentIndex
                            ? item.latestComment
                            : {
                                  index: event.commentIndex,
                                  authorId: event.authorId,
                                  createdTime: event.createdTime,
                                  contentSnippet: event.contentSnippet,
                              },
                };
            },
        );
    },
});
