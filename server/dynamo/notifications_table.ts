import {addMinutes, differenceInMinutes} from "date-fns";
import {getChat} from "~/server/dynamo/chat_table";
import {SystemContext} from "~/server/dynamo/context/system_context";
import {getPostNotificationSubscribers} from "~/server/dynamo/forum_table";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {
    DynamoTableIndexItemType,
    DynamoTableSchema,
    DynamoTableSchemaGetTypes,
} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {getContentSnippet} from "~/shared/content/get_content_snippet";
import {
    MessageContent,
    MessageContentSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema";
import {CancelledError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {DistributivePick} from "~/shared/helpers/types/distributive_pick";
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
import {Schema} from "~/shared/schema/schema";

const initialInboxGeneration = 0;

const NotificationsTable = DynamoTableSchema.new({
    name: "Notifications",
    partitions: [
        // NOCOMMIT: Revise documentation
        /**
         * Users receive a lot of notifications from our product. Mentions in document
         * comment threads, new posts in channels, chat messages, and more. These
         * notifications can be overwhelming to manage so we provide the inbox. A
         * unified home for all notifications the user may care about.
         *
         * The inbox is intelligent. It's designed to leverage a computer, which is
         * good at crunching numbers, to distill and summarize all the information the
         * user needs to process. It doesn't blindly add every notification event to
         * the inbox. Instead the inbox groups and sorts entries for the user.
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
         *   the count gives you a sense of scope to how much your work will be
         *   to address these notifications. We want zero loud notifications to be a
         *   practical state for the user to achieve daily. The count should be
         *   meaningful to a human (unlike when Slack tells you 143 unreads). Counting
         *   individual messages often is not meaningful to a human since your
         *   conversation partner may be using messages like sentences, or you may be
         *   in a group chat where a conversation is happening you're uninterested in.
         *
         *   We will sometimes get it wrong and mark unimportant notifications as loud.
         *   If the user doesn't address a loud notification we think it should decay
         *   over time (fall in order in the inbox or even remove the loud count
         *   completely).
         *
         * - Inbox observation: When a user opens their inbox and continues to look at
         *   it we say the inbox is "observed". We don't know the order of entries in
         *   the inbox until it is observed! While the inbox is unobserved we collect
         *   notification events and group them. Then when the user observes their
         *   inbox we rank the entries, save our ranking, and present the entries.
         *
         *   The inbox is in a "quantum superposition" state while unobserved. It's
         *   unclear what order the entries are in.
         *
         *   While this is how the inbox is designed in theory, as of 2023-04-17 we
         *   don't do any interesting ranking of inbox entries. They are ranked
         *   chronologically by the time they entered the inbox. (So first update time
         *   for the batch vs last update time for the batch.) With the exception of
         *   loud notifications. Loud notifications are put at the top of the inbox
         *   when the inbox is observed and are freezed there.
         *
         * - Inbox generation: We implement inbox observed/unobserved states with the
         *   generation counter. Whenever the inbox is observed we increment the
         *   generation counter. Other pieces of data stored about an inbox store
         *   generation numbers and compare it against the current generation number.
         *
         *   An example is when we get a loud notification in a chat we store the
         *   current inbox generation number. When the inbox is observed, the inbox
         *   generation number moves forward, and we "freeze" the position of all chat
         *   entries at the top of the inbox.
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
         * for the entire inbox and individual, grouped, inbox entries. The inbox
         * entries are not sorted within this partition. The table is designed to have
         * unique, accessible, keys for each inbox entry. So when a notification event
         * happens it can be added to the appropriate entry.
         *
         * Then we have an index which provides the inbox entries in the correct sort
         * order. The index (called `InboxEntriesIndex`) copies the entire item into
         * the index. While this does double storage requirements for the inbox it's
         * necessary to both be able to uniquely address inbox entries and to fetch the
         * full inbox entry items without multiple partition hops. We have more
         * documentation on the `InboxEntriesIndex`.
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
                         * observed, signifying any unobserved entries need to find their place
                         * and freeze.
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

type NotificationTableTypes = DynamoTableSchemaGetTypes<typeof NotificationsTable>;

type InboxEntryItem = DynamoTableIndexItemType<typeof InboxEntriesIndex>;

type InboxEntryItemKey = NotificationTableTypes["ItemKey"] &
    DistributivePick<InboxEntryItem, "partitionType" | "sortRangeType">;

// NOCOMMIT: Revise documentation
/**
 * First, see the documentation on the `Inbox` partition of `NotificationsTable`
 * to help understand the purpose of this index. In short, inbox entries are
 * not ordered in `Inbox` partitions of the notifications table. Inbox entries
 * need to be uniquely addressable so we can add to them when a notification
 * event occurs. However, when the user views their inbox they only see
 * unarchived entries in a meaningful sort order. So this index copies inbox
 * entries for efficient access of an account's inbox.
 *
 * ## DynamoDB implementation notes
 *
 * The index is backed by a [DynamoDB global secondary index][1]. This global
 * secondary index has the same partition key as our `Inbox` partition! That
 * means it could be using a [local secondary index][2]. However, a local
 * secondary index puts a size constraint on the `Inbox` partition which needs
 * to grow unbounded. Constantly moving data out of the `Inbox` partition to
 * keep it within the partition bounds would complicate our implementation.
 *
 * The main advantage of a local secondary index is it allows for strongly
 * consistent reads. This is appealing since we need to maintain the inbox in
 * realtime so strongly consistent reads can be helpful for ensuring we don't
 * miss realtime updates. What we do instead is we include the inbox attributes
 * item in our index. That way we can put a realtime version in that item and
 * read the attributes item with strong consistency to compare with our read of
 * the attributes item with eventual consistency. If they don't match then we
 * throw away the eventually consistent read and keep trying until we see the
 * latest inbox.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html
 * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html
 */
const InboxEntriesIndex = NotificationsTable.addExpensiveFullIndex({
    name: "InboxEntries",
    itemTypes: [
        {partitionType: "Inbox", sortRangeType: "ChatEntry"},
        {partitionType: "Inbox", sortRangeType: "PostCommentsEntry"},
    ],
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

        // NOCOMMIT: Revise documentation
        generation: DynamoKeyAttributeSchema.integer.reverse(),

        /**
         * When did this entry enter the inbox? This will determine sort order in the
         * inbox. Entries tend to stay at the position they entered the inbox unless a
         * loud notification occurred which will cause us to move the entry up to the
         * top of the inbox.
         */
        // NOCOMMIT: Revise documentation
        enteredTime: DynamoKeyAttributeSchema.date.reverse(),
    },
});

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
    // In development and test environments, process each notification event twice
    // 1% of the time. We use queues that guarantee at-least once delivery which
    // means on occasion we may see an event twice. By running events twice outside
    // of production, developers are forced to make their processor idempotent.
    if (process.env.NODE_ENV !== "production" && Math.random() < 0.01) {
        await runAllPromises([
            actuallyProcessNotificationEvent(context, event),
            actuallyProcessNotificationEvent(context, event),
        ]);
    } else {
        await actuallyProcessNotificationEvent(context, event);
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
                    // Don't send the message author a notification.
                    if (account.id === event.authorId) return;

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
            NotificationsTable.getItemIfExists(context, {
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
            }),
            NotificationsTable.getItemIfExists(context, itemKey),
        ]);

        const newInboxEntryItemPartial1 = update(oldInboxEntryItem);

        const loudNotificationCountDifference =
            newInboxEntryItemPartial1.loudNotificationCount -
            (oldInboxEntryItem?.loudNotificationCount ?? 0);

        const generation = inboxItem?.generation ?? initialInboxGeneration;

        const newInboxEntryItemPartial2 = {
            ...newInboxEntryItemPartial1,
            ...itemKey,
            updateLockVersion: oldInboxEntryItem?.updateLockVersion,
        } as DistributiveOmit<
            InboxEntryItem & ItemKey,
            "isArchived" | "generation" | "enteredTime"
        >;

        // Move the entry to the top of the inbox if:
        //
        // - The entry is newly created; OR
        // - The entry is revived from the archive; OR
        // - The entry has a loud notification
        const shouldMaintainPlace =
            oldInboxEntryItem &&
            !oldInboxEntryItem.isArchived &&
            loudNotificationCountDifference <= 0;

        await DynamoTableSchema.executeTransaction(context, [
            NotificationsTable.transactionDirectlyUpdateItem({
                ...inboxItem,
                partitionType: "Inbox",
                sortRangeType: "Attributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
                generation,
                loudNotificationCount:
                    (inboxItem?.loudNotificationCount ?? 0) + loudNotificationCountDifference,
            }),
            NotificationsTable.transactionDirectlyUpdateItem({
                ...newInboxEntryItemPartial2,
                isArchived: false,
                generation: shouldMaintainPlace ? oldInboxEntryItem.generation : generation,
                enteredTime: shouldMaintainPlace
                    ? oldInboxEntryItem.enteredTime
                    : getInboxEntryLatestUpdateTime(newInboxEntryItemPartial2),
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
                    event.mentionedAccountIds.has(account.id) ||
                    item?.isArchived ||
                    !item?.latestMessage ||
                    // Events might arrive out-of-order but if events 10min+ apart are arriving
                    // out-of-order we have a bigger problem so we don't worry about the
                    // out-of-order case when subtracting timestamps here.
                    differenceInMinutes(event.createdTime, item.latestMessage.createdTime) >=
                        minMessageViewTimestampDividerElapsedMinutes;

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
                const shouldIncrementLoudNotificationCount = event.mentionedAccountIds.has(
                    account.id,
                );

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
