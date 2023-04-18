import {compareDesc as compareDatesDesc, differenceInMinutes} from "date-fns";
import {getAccount} from "~/server/dynamo/accounts_table";
import {getChat} from "~/server/dynamo/chat_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getPostNotificationSubscribers} from "~/server/dynamo/forum_table";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {
    DynamoTableIndexItemType,
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/internal/dynamo_table_schema";
import {MessageContent, MessageContentSchema} from "~/shared/content/message_content_schema";
import {InternalError, NotFoundError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array";
import {filterMapAsyncIterableIterator} from "~/shared/helpers/iterable/filter_map_async_iterable_iterator";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {OrderKey, generateOrderKeysBetween, initialOrderKey} from "~/shared/helpers/sort/order_key";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {AccountId, ChatId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/messaging/messaging_shared_styles";
import {AccountModel} from "~/shared/models/account_model";
import {Cursor} from "~/shared/models/cursor";
import {
    InboxChatEntryModel,
    InboxEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/models/inbox_entry_model";
import {OrderKeySchema} from "~/shared/schema/order_key_schema";
import {Schema} from "~/shared/schema/schema";

const initialInboxGeneration = 0;

const NotificationsTable = DynamoTableSchema.new({
    name: "Notifications",
    partitions: [
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

                        // We want our inbox attributes item to exist in `InboxEntriesIndex` as the
                        // first item. This way we can do strongly consistent reads from
                        // `InboxEntriesIndex` by first reading from the index, then do a strongly
                        // consistent read of this item and compare.
                        //
                        // So for all the fields required by `InboxEntriesIndex` we have constant
                        // values that unambiguously put this item first. The most important being
                        // `unobservedLoudNotificationGeneration`. We have a value one less than the
                        // minimum generation number. There will never be a valid generation before
                        // this item so this item should always come first.
                        isArchived: Schema.value(false),
                        unobservedLoudNotificationGeneration: Schema.value(
                            initialInboxGeneration - 1,
                        ),
                        enteredTime: Schema.value(null),
                        tiebreakerOrderKey: Schema.value(null),
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
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /** See the documentation on `tiebreakerOrderKey` in `InboxEntriesIndex`. */
                        tiebreakerOrderKey: OrderKeySchema.nullable(),
                        /** See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item. */
                        loudNotificationCount: Schema.integer.min(0),
                        /** See the documentation on `unobservedLoudNotificationGeneration` in `InboxEntriesIndex`. */
                        unobservedLoudNotificationGeneration: Schema.integer
                            .min(initialInboxGeneration)
                            .nullable(),

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
                        /** See the documentation on `enteredTime` in `InboxEntriesIndex`. */
                        enteredTime: Schema.date,
                        /** See the documentation on `tiebreakerOrderKey` in `InboxEntriesIndex`. */
                        tiebreakerOrderKey: OrderKeySchema.nullable(),
                        /** See the documentation on `loudNotificationCount` in the `Inbox` partition's `Attributes` item. */
                        loudNotificationCount: Schema.integer.min(0),
                        /** See the documentation on `unobservedLoudNotificationGeneration` in `InboxEntriesIndex`. */
                        unobservedLoudNotificationGeneration: Schema.integer
                            .min(initialInboxGeneration)
                            .nullable(),

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
                // {
                //     name: "DocumentCommentThreadsEntry",
                //     sortKeyAttributes: {
                //         documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                //     },
                //     attributes: Schema.object({
                //         isArchived: Schema.boolean,
                //         // sortTime: Schema.date,
                //         loudNotificationCount: Schema.integer.min(0),
                //         // TODO(calebmer): What content do we show? Do we show the latest comment? Do
                //         // we show N new threads have messages?
                //     }),
                // },
                // {
                //     name: "ChannelPostsEntry",
                //     sortKeyAttributes: {
                //         channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
                //         // generation: DynamoKeyAttributeSchema.integer,
                //     },
                //     attributes: Schema.object({
                //         isArchived: Schema.boolean,
                //         // sortTime: Schema.date,
                //         loudNotificationCount: Schema.integer.min(0),
                //     }),
                // },
            ],
        },
    ],
});

type InboxAttributesItem = DynamoTableItemType<typeof NotificationsTable, "Inbox", "Attributes">;

type InboxEntryItem = Exclude<
    DynamoTableIndexItemType<typeof InboxEntriesIndex>,
    {partitionType: "Inbox"; sortRangeType: "Attributes"}
>;

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
        {partitionType: "Inbox", sortRangeType: "Attributes"},
        {partitionType: "Inbox", sortRangeType: "ChatEntry"},
        {partitionType: "Inbox", sortRangeType: "PostCommentsEntry"},
        // {partitionType: "Inbox", sortRangeType: "DocumentCommentThreadsEntry"},
        // {partitionType: "Inbox", sortRangeType: "ChannelPostsEntry"},
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

        /**
         * When there's a loud notification in an inbox entry we want the entry to
         * display at the top of the inbox when the inbox is next observed. Then freeze
         * in that position.
         *
         * So when an entry receives a new loud notification then we will set this to
         * the current inbox generation. By setting this from null to an integer value
         * the item moves up to the top of the index. Then when the inbox is observed
         * we set this back to null and update the entered time so it should still
         * occupy the same position in the inbox.
         *
         * An extra wrinkle is the inbox attributes item exists in this index and we
         * assign it a value for this attribute that is not a valid inbox generation
         * but is smaller than other inbox generations so it's always sorted first.
         */
        unobservedLoudNotificationGeneration: DynamoKeyAttributeSchema.integer.nullable({
            nullsOrder: "Last",
        }),

        /**
         * When did this entry enter the inbox? This will determine sort order in the
         * inbox. Entries tend to stay at the position they entered the inbox unless a
         * loud notification occurred which will cause us to move the entry up to the
         * top of the inbox.
         */
        enteredTime: DynamoKeyAttributeSchema.date.nullable().reverse(),

        /**
         * When the inbox is observed we re-rank inbox entries. To move inbox entries
         * to the top we will update their `enteredTime` to the current time (which we
         * call the observation time). Then to maintain a sort order between these
         * items with the same `enteredTime` we assign `tiebreakerOrderKey`s.
         */
        tiebreakerOrderKey: DynamoKeyAttributeSchema.orderKey.nullable(),
    },
});

async function getInboxEntryItems(
    context: RequestContext,
    {
        spaceId,
        limit,
    }: {
        spaceId: SpaceId;
        limit: number;
    },
): Promise<{
    attributesItem: InboxAttributesItem | null;
    entryItems: ReadonlyArray<InboxEntryItem>;
    entryItemsIncludingAllUnobservedEntries: ReadonlyArray<InboxEntryItem>;
}> {
    // NOCOMMIT: No loading while observing!

    const accountId = context.auth.getAccountId();

    const mixedAttributesItemAndEntryItems = await arrayFromAsyncIterable(
        InboxEntriesIndex.query(context, {
            partitionKey: {
                spaceId,
                accountId,
            },
            startSortKey: {
                isArchived: false,
                unobservedLoudNotificationGeneration: initialInboxGeneration - 1,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.minValue,
                tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.minValue,
            },
            endSortKey: {
                isArchived: false,
                unobservedLoudNotificationGeneration: null,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
                tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.maxValue,
            },
            limit,
        }),
    );

    let attributesItem: InboxAttributesItem | null = null;

    const entryItems = filterMapArray(
        mixedAttributesItemAndEntryItems,
        (item): InboxEntryItem | null => {
            if (item.sortRangeType !== "Attributes") return item;
            attributesItem = item;
            return null;
        },
    );

    if (entryItems.length > 0 && !attributesItem) {
        throw new InternalError(
            "Found some inbox entry items but did not find a corresponding attributes item",
        );
    }

    const lastEntryItem = entryItems.length > 0 ? entryItems[entryItems.length - 1] : undefined;

    // If there are more unobserved items after our query, go fetch them. We need
    // to sort all unobserved items in memory.
    if (typeof lastEntryItem?.unobservedLoudNotificationGeneration === "number") {
        for await (const entryItem of InboxEntriesIndex.query(context, {
            partitionKey: {
                spaceId,
                accountId,
            },
            endSortKey: {
                isArchived: false,
                unobservedLoudNotificationGeneration:
                    InboxEntriesIndex.sortKeyAttributes.unobservedLoudNotificationGeneration
                        .maxValue,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
                tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.maxValue,
            },
            afterItemKey: lastEntryItem,
            limit: "All",
        })) {
            // We used a cursor to an entry item which should always be after the
            // attributes item.
            assert(entryItem.sortRangeType !== "Attributes");

            entryItems.push(entryItem);
        }
    }

    entryItems.sort((entryItem1, entryItem2) => {
        const isEntryUnobserved1 =
            typeof entryItem1.unobservedLoudNotificationGeneration === "number";
        const isEntryUnobserved2 =
            typeof entryItem2.unobservedLoudNotificationGeneration === "number";

        // Unobserved entries go first...
        if (isEntryUnobserved1 && !isEntryUnobserved2) return -1;
        if (!isEntryUnobserved1 && isEntryUnobserved2) return 1;

        // Observed entries are compared using their position in the index...
        if (!isEntryUnobserved1 && !isEntryUnobserved2) {
            return InboxEntriesIndex.compare(entryItem1, entryItem2);
        }

        return (
            compareDatesDesc(entryItem1.enteredTime, entryItem2.enteredTime) ||
            defaultCompareStrings(
                entryItem1.tiebreakerOrderKey ?? "",
                entryItem2.tiebreakerOrderKey ?? "",
            )
        );
    });

    return {
        attributesItem,
        entryItems: entryItems.slice(0, limit),
        entryItemsIncludingAllUnobservedEntries: entryItems,
    };
}

async function getAndObserveInboxEntries(
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
    lastCursor: Cursor | null;
}> {}

async function getArchivedInboxEntries(
    context: RequestContext,
    {
        spaceId,
        limit,
        afterCursor,
    }: {
        spaceId: SpaceId;
        limit: number;
        afterCursor: Cursor | null;
    },
): Promise<{
    entries: ReadonlyArray<InboxEntryModel>;
    lastCursor: Cursor | null;
}> {
    const accountId = context.auth.getAccountId();

    const entries = await parallelMapAsyncIterableToArray(
        InboxEntriesIndex.query(context, {
            partitionKey: {
                spaceId,
                accountId,
            },
            startSortKey: {
                isArchived: true,
                unobservedLoudNotificationGeneration: null,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.minValue,
                tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.minValue,
            },
            endSortKey: {
                isArchived: true,
                unobservedLoudNotificationGeneration: null,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
                tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.maxValue,
            },
            afterItemKey:
                typeof afterCursor === "string"
                    ? InboxEntriesIndex.deserializeCursor(afterCursor)
                    : undefined,
            limit,
        }),
        async item => {
            // Should never see attributes in the archive section of our inbox.
            assert(item.sortRangeType !== "Attributes");

            return {item, model: await createInboxEntryModelFromItem(context, spaceId, item)};
        },
    );

    return {
        entries: entries.map(({model}) => model),
        lastCursor:
            entries.length > 0
                ? InboxEntriesIndex.serializeCursor(entries[entries.length - 1]!.item)
                : null,
    };
}

async function createInboxEntryModelFromItem(
    context: RequestContext,
    spaceId: SpaceId,
    item: InboxEntryItem,
) {
    switch (item.sortRangeType) {
        case "ChatEntry": {
            return new InboxChatEntryModel({
                type: "Chat",
                loudNotificationCount: item.loudNotificationCount,
                latestMessage: {
                    author: await getAccount(context, spaceId, item.latestMessage.authorId),
                    createdTime: item.latestMessage.createdTime,
                    contentSnippet: item.latestMessage.contentSnippet,
                },
            });
        }
        case "PostCommentsEntry": {
            return new InboxPostCommentsEntryModel({
                type: "PostComments",
                loudNotificationCount: item.loudNotificationCount,
                latestComment: {
                    author: await getAccount(context, spaceId, item.latestComment.authorId),
                    createdTime: item.latestComment.createdTime,
                    contentSnippet: item.latestComment.contentSnippet,
                },
            });
        }
        default:
            throw exhaustive(item);
    }
}

// /**
//  * Gets the current account's inbox entries. Uses cursor based pagination to
//  * avoid loading all inbox entries at once.
//  *
//  * This function doesn't just read the account's inbox entries, it also
//  * internally marks the inbox as "observed". The inbox is designed such that
//  * while the user is not actively looking at it, the order of items is up in
//  * the air. Then when the user opens their inbox we freeze items in the
//  * position they saw. We use this quantum superposition behavior to:
//  *
//  * - Put loud notifications at the top of the inbox
//  * - Algorithmically rank notifications by relevance (not implemented yet)
//  */
// export async function getAndObserveInboxEntries(
//     context: RequestContext,
//     {
//         spaceId,
//         limit,
//         afterCursor,
//     }: {
//         spaceId: SpaceId;
//         limit: number;
//         afterCursor: Cursor | null;
//     },
// ): Promise<{
//     readonly entries: ReadonlyArray<InboxEntryModel>;
//     readonly lastCursor: Cursor | null;
// }> {
//     const accountId = context.auth.getAccountId();

//     const itemsPromise = arrayFromAsyncIterable(
//         InboxEntriesIndex.query(context, {
//             partitionKey: {
//                 spaceId,
//                 accountId,
//             },
//             startSortKey: {
//                 isArchived: false,
//                 unobservedLoudNotificationGeneration: initialInboxGeneration,
//                 enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.minValue,
//                 tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.minValue,
//             },
//             endSortKey: {
//                 isArchived: false,
//                 unobservedLoudNotificationGeneration: null,
//                 enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
//                 tiebreakerOrderKey: InboxEntriesIndex.sortKeyAttributes.tiebreakerOrderKey.maxValue,
//             },
//             afterCursor: afterCursor ?? undefined,
//             limit,
//         }),
//     );

//     // Don't observe entries if we aren't fetching the first page (where all the
//     // unobserved entries are).
//     const shouldObserveEntries = typeof afterCursor !== "string";

//     if (shouldObserveEntries) {
//         context.process.waitUntil(async () => {
//             let _newGeneration: number | undefined;

//             // We increment our inbox generation number whenever the user observes their
//             // inbox. This has the effect of freezing the inbox as the user last saw it.
//             await NotificationsTable.updateItem(
//                 context,
//                 {partitionType: "Inbox", sortRangeType: "Attributes", spaceId, accountId},
//                 inboxItem => {
//                     _newGeneration = (inboxItem?.generation ?? initialInboxGeneration) + 1;

//                     return {
//                         ...inboxItem,
//                         partitionType: "Inbox",
//                         sortRangeType: "Attributes",
//                         spaceId,
//                         accountId,
//                         generation: _newGeneration,
//                         loudNotificationCount: inboxItem?.loudNotificationCount ?? 0,
//                     };
//                 },
//             );

//             const newGeneration = assertExists(_newGeneration);

//             // Lock all our unobserved loud notification entries into position at the
//             // current time. New notifications will be added above. We use a tie-breaking
//             // `OrderKey` to make sure we preserve the order between individual entries.
//             const observationTime = new Date();

//             // NOCOMMIT: How do we prevent the inbox from being read while we are updating it?
//             const observeEntry = async (item: InboxEntryItem, tiebreakerOrderKey: OrderKey) => {
//                 await NotificationsTable.updateItem(
//                     context,
//                     item,
//                     item => {
//                         // Don't update the entry if:
//                         if (
//                             // 1. The entry was deleted
//                             !item ||
//                             // 2. The entry was already observed
//                             typeof item.unobservedLoudNotificationGeneration !== "number" ||
//                             // 3. The entry received a loud notification in a later generation
//                             // NOCOMMIT: Test this ^
//                             item.unobservedLoudNotificationGeneration >= newGeneration
//                         ) {
//                             return item;
//                         }

//                         return {
//                             ...item,
//                             enteredTime: observationTime,
//                             tiebreakerOrderKey,
//                             unobservedLoudNotificationGeneration: null,
//                         };
//                     },
//                     // Optimization: We already loaded the item so we don't need to reload it
//                     // during the first update item run.
//                     {initialItem: item},
//                 );
//             };

//             // We want to observe all unobserved inbox entries even if they were not
//             // included in the page of entries we're fetching for the user. So if there may
//             // be more unobserved entries (the last item in our fetched page is
//             // unobserved), issue a new query.
//             const remainingUnobservedItemsPromise = (async () => {
//                 const items = await itemsPromise;
//                 const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
//                 if (typeof lastItem?.unobservedLoudNotificationGeneration !== "number") return [];

//                 return arrayFromAsyncIterable(
//                     InboxEntriesIndex.query(context, {
//                         partitionKey: {
//                             spaceId,
//                             accountId,
//                         },
//                         endSortKey: {
//                             isArchived: false,
//                             unobservedLoudNotificationGeneration:
//                                 DynamoKeyAttributeSchema.integer.maxValue,
//                             enteredTime: DynamoKeyAttributeSchema.date.reverse().maxValue,
//                             tiebreakerOrderKey:
//                                 DynamoKeyAttributeSchema.orderKey.nullable().maxValue,
//                         },
//                         afterCursor: InboxEntriesIndex.getCursor(lastItem),
//                         limit: "All",
//                     }),
//                 );
//             })();

//             const midOrderKey = initialOrderKey;

//             await runAllPromises([
//                 itemsPromise.then(items => {
//                     const orderKeys = generateOrderKeysBetween(null, midOrderKey, items.length);
//                     return runAllPromises(
//                         items.map((item, i) => observeEntry(item, orderKeys[i]!)),
//                     );
//                 }),
//                 remainingUnobservedItemsPromise.then(items => {
//                     const orderKeys = generateOrderKeysBetween(midOrderKey, null, items.length);
//                     return runAllPromises(
//                         items.map((item, i) => observeEntry(item, orderKeys[i]!)),
//                     );
//                 }),
//             ]);
//         });
//     }

//     // Transform our items into entries for the client.
//     const entriesPromise = itemsPromise.then(items =>
//         runAllPromises(
//             items.map(async item => {
//                 switch (item.sortRangeType) {
//                     case "ChatEntry": {
//                         return new InboxChatEntryModel({
//                             type: "Chat",
//                             loudNotificationCount: item.loudNotificationCount,
//                             latestMessage: {
//                                 author: await getAccount(
//                                     context,
//                                     spaceId,
//                                     item.latestMessage.authorId,
//                                 ),
//                                 createdTime: item.latestMessage.createdTime,
//                                 contentSnippet: item.latestMessage.contentSnippet,
//                             },
//                         });
//                     }
//                     case "PostCommentsEntry": {
//                         return new InboxPostCommentsEntryModel({
//                             type: "PostComments",
//                             loudNotificationCount: item.loudNotificationCount,
//                             latestComment: {
//                                 author: await getAccount(
//                                     context,
//                                     spaceId,
//                                     item.latestComment.authorId,
//                                 ),
//                                 createdTime: item.latestComment.createdTime,
//                                 contentSnippet: item.latestComment.contentSnippet,
//                             },
//                         });
//                     }
//                     default:
//                         throw exhaustive(item);
//                 }
//             }),
//         ),
//     );

//     const [entries, items] = await runAllPromises([entriesPromise, itemsPromise]);

//     return {
//         entries,
//         lastCursor: items.length > 0 ? InboxEntriesIndex.getCursor(items[items.length - 1]!) : null,
//     };
// }

// TODO(calebmer): Add message and comment update events in case they add a mention.
export type NotificationEvent =
    | NotificationCreateChatMessageEvent
    | NotificationCreatePostCommentEvent;
// | NotificationCreateDocumentCommentEvent
// | NotificationCreatePostEvent;

export type NotificationCreateChatMessageEvent = {
    readonly type: "CreateChatMessage";
    readonly chatId: ChatId;
    readonly messageIndex: number;
    readonly createdTime: Date;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlySet<AccountId>;
    readonly contentSnippet: MessageContent;
};

export type NotificationCreatePostCommentEvent = {
    readonly type: "CreatePostComment";
    readonly postId: PostId;
    readonly commentIndex: number;
    readonly createdTime: Date;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlySet<AccountId>;
    readonly contentSnippet: MessageContent;
};

// export type NotificationCreateDocumentCommentEvent = {
//     readonly type: "CreateDocumentComment";
//     readonly documentId: DocumentId;
//     readonly commentThreadId: DocumentCommentThreadId;
//     readonly commentIndex: number;
//     readonly createdTime: Date;
//     readonly authorId: AccountId;
//     readonly mentionedAccountIds: ReadonlySet<AccountId>;
//     readonly contentSnippet: MessageContent;
// };

// export type NotificationCreatePostEvent = {
//     readonly type: "CreatePost";
//     readonly createdTime: Date;
//     readonly postId: PostId;
//     readonly authorId: AccountId;
//     readonly mentionedAccountIds: ReadonlySet<AccountId>;
// };

/**
 * Processes a notification generating event by fanning out to subscriber
 * inboxes and notification destinations (like email or mobile push
 * notifications).
 */
export async function processNotificationEvent(
    context: RequestContext,
    event: NotificationEvent,
): Promise<void> {
    await actuallyProcessNotificationEvent(context, event);

    // In development and test environments, process each notification event twice.
    // We use queues that guarantee at-least once delivery which means on occasion
    // we may see an event twice. By running events twice outside of production,
    // developers are forced to make their processor idempotent.
    if (process.env.NODE_ENV !== "production") {
        await actuallyProcessNotificationEvent(context, event);
    }
}

function actuallyProcessNotificationEvent(
    context: RequestContext,
    event: NotificationEvent,
): Promise<void> {
    switch (event.type) {
        case "CreateChatMessage":
            return processNotificationCreateChatMessageEvent(context, event);
        case "CreatePostComment":
            return processNotificationCreatePostCommentEvent(context, event);
        // case "CreateDocumentComment":
        //     return processNotificationCreateDocumentCommentEvent(context, event);
        // case "CreatePost":
        //     return processNotificationCreatePostEvent(context, event);
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
        context: RequestContext,
        event: Event,
    ) => Promise<{
        info: Info;
        accounts: ReadonlyArray<AccountModel>;
    }>;

    /**
     * Update the inbox entry for each subscriber. Called in parallel.
     */
    updateInboxEntry: (
        context: RequestContext,
        event: Event,
        info: Info,
        account: AccountModel,
    ) => Promise<void>;
}): (context: RequestContext, event: Event) => Promise<void> {
    return (context, event) => {
        return context.tracer.withSpan("Processing notification event", async (context, span) => {
            span.addData({notifications: {event: event.type}});

            const {info, accounts} = await getSubscribers(
                // Use a strong read consistency when getting subscribers so we don't miss
                // any subscribers added as a part of the notification event.
                context.dynamo.setDefaultReadConsistency("Strong"),
                event,
            );

            span.addData({notifications: {inbox: {spaceId: info.spaceId}}});

            await runAllPromises(
                accounts.map(async account => {
                    // Don't send the message author a notification.
                    if (account.id === event.authorId) return;

                    await context.tracer.withSpan("Updating inbox entry", async (context, span) => {
                        span.addData({
                            notifications: {
                                event: event.type,
                                inbox: {spaceId: info.spaceId, accountId: account.id},
                            },
                        });
                        return updateInboxEntry(context, event, info, account);
                    });
                }),
            );
        });
    };
}

const processNotificationCreateChatMessageEvent = createNotificationEventProcessor<
    NotificationCreateChatMessageEvent,
    {spaceId: SpaceId}
>({
    getSubscribers: async (context, event) => {
        const chat = await getChat(context, event.chatId);
        return {
            info: {spaceId: chat.spaceId},
            accounts: chat.accounts,
        };
    },
    updateInboxEntry: async (context, event, {spaceId}, account) => {
        await context.dynamo.retryTransaction(async context => {
            const [inboxItem, inboxEntryItem] = await runAllPromises([
                NotificationsTable.getItemIfExists(context, {
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId: account.id,
                }),
                NotificationsTable.getItemIfExists(context, {
                    partitionType: "Inbox",
                    sortRangeType: "ChatEntry",
                    spaceId,
                    accountId: account.id,
                    chatId: event.chatId,
                }),
            ]);

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
                inboxEntryItem?.isArchived ||
                !inboxEntryItem?.latestMessage ||
                // Events might arrive out-of-order but if events 10min+ apart are arriving
                // out-of-order we have a bigger problem so we don't worry about the
                // out-of-order case when subtracting timestamps here.
                differenceInMinutes(event.createdTime, inboxEntryItem.latestMessage.createdTime) >=
                    minMessageViewTimestampDividerElapsedMinutes;

            // Events may arrive out-of-order so double check that the message index in
            // the event is actually the latest message.
            const latestMessage =
                inboxEntryItem && inboxEntryItem.latestMessage.index > event.messageIndex
                    ? inboxEntryItem.latestMessage
                    : {
                          index: event.messageIndex,
                          authorId: event.authorId,
                          createdTime: event.createdTime,
                          contentSnippet: event.contentSnippet,
                      };

            const generation = inboxItem?.generation ?? initialInboxGeneration;

            await DynamoTableSchema.executeTransaction(context, [
                NotificationsTable.transactionDirectlyUpdateItem({
                    ...inboxItem,
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId: account.id,
                    generation,
                    loudNotificationCount:
                        (inboxItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0),

                    // Constant properties required for index.
                    isArchived: false,
                    unobservedLoudNotificationGeneration: initialInboxGeneration - 1,
                    enteredTime: null,
                    tiebreakerOrderKey: null,
                }),
                NotificationsTable.transactionDirectlyUpdateItem({
                    ...inboxEntryItem,
                    partitionType: "Inbox",
                    sortRangeType: "ChatEntry",
                    spaceId,
                    accountId: account.id,
                    chatId: event.chatId,
                    isArchived: false,
                    enteredTime:
                        shouldIncrementLoudNotificationCount ||
                        !inboxEntryItem ||
                        inboxEntryItem.isArchived
                            ? latestMessage.createdTime
                            : inboxEntryItem.enteredTime,
                    tiebreakerOrderKey: inboxEntryItem?.tiebreakerOrderKey ?? null,
                    loudNotificationCount:
                        (inboxEntryItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0),
                    // NOCOMMIT: If the user is actively observing in realtime we shouldn't be
                    // marking this notification as unobserved.
                    unobservedLoudNotificationGeneration: shouldIncrementLoudNotificationCount
                        ? generation
                        : null,
                    latestMessage,
                }),
            ]);
        });
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
    updateInboxEntry: async (context, event, {spaceId}, account) => {
        await context.dynamo.retryTransaction(async context => {
            const [inboxItem, inboxEntryItem] = await runAllPromises([
                NotificationsTable.getItemIfExists(context, {
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId: account.id,
                }),
                NotificationsTable.getItemIfExists(context, {
                    partitionType: "Inbox",
                    sortRangeType: "PostCommentsEntry",
                    spaceId,
                    accountId: account.id,
                    postId: event.postId,
                }),
            ]);

            // We increment the loud notification count only if someone is explicitly
            // trying to get your attention by mentioning your account. Otherwise, we
            // expect users will respond to new post comments in their own time.
            const shouldIncrementLoudNotificationCount = event.mentionedAccountIds.has(account.id);

            // Events may arrive out-of-order so double check that the message index in
            // the event is actually the latest message.
            const latestComment =
                inboxEntryItem && inboxEntryItem.latestComment.index > event.commentIndex
                    ? inboxEntryItem.latestComment
                    : {
                          index: event.commentIndex,
                          authorId: event.authorId,
                          createdTime: event.createdTime,
                          contentSnippet: event.contentSnippet,
                      };

            const generation = inboxItem?.generation ?? initialInboxGeneration;

            await DynamoTableSchema.executeTransaction(context, [
                NotificationsTable.transactionDirectlyUpdateItem({
                    ...inboxItem,
                    partitionType: "Inbox",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId: account.id,
                    generation,
                    loudNotificationCount:
                        (inboxItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0),

                    // Constant properties required for index.
                    isArchived: false,
                    unobservedLoudNotificationGeneration: initialInboxGeneration - 1,
                    enteredTime: null,
                    tiebreakerOrderKey: null,
                }),
                NotificationsTable.transactionDirectlyUpdateItem({
                    ...inboxEntryItem,
                    partitionType: "Inbox",
                    sortRangeType: "PostCommentsEntry",
                    spaceId,
                    accountId: account.id,
                    postId: event.postId,
                    isArchived: false,
                    enteredTime:
                        shouldIncrementLoudNotificationCount ||
                        !inboxEntryItem ||
                        inboxEntryItem.isArchived
                            ? latestComment.createdTime
                            : inboxEntryItem.enteredTime,
                    tiebreakerOrderKey: inboxEntryItem?.tiebreakerOrderKey ?? null,
                    loudNotificationCount:
                        (inboxEntryItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0),
                    unobservedLoudNotificationGeneration: shouldIncrementLoudNotificationCount
                        ? generation
                        : null,
                    latestComment,
                }),
            ]);
        });
    },
});

// const processNotificationCreateDocumentCommentEvent = createNotificationEventProcessor<
//     NotificationCreateDocumentCommentEvent,
//     {spaceId: SpaceId}
// >({
//     getSubscribers: async (context, event) => {
//         const {spaceId, accounts} = await getDocumentCommentThreadNotificationSubscribers(context, {
//             documentId: event.documentId,
//             commentThreadId: event.commentThreadId,
//             isFirstComment: event.commentIndex === 0,
//         });
//         return {
//             info: {spaceId},
//             accounts,
//         };
//     },
//     updateInboxEntry: async (context, event, {spaceId}, account) => {
//         await context.dynamo.retryTransaction(async context => {
//             const [inboxItem, inboxEntryItem] = await runAllPromises([
//                 NotificationsTable.getItemIfExists(context, {
//                     partitionType: "Inbox",
//                     sortRangeType: "Attributes",
//                     spaceId,
//                     accountId: account.id,
//                 }),
//                 NotificationsTable.getItemIfExists(context, {
//                     partitionType: "Inbox",
//                     sortRangeType: "DocumentCommentThreadsEntry",
//                     spaceId,
//                     accountId: account.id,
//                     documentId: event.documentId,
//                 }),
//             ]);

//             // We increment the loud notification count only if someone is explicitly
//             // trying to get your attention by mentioning your account. Otherwise, we
//             // expect users will respond to new document comments in their own time.
//             const shouldIncrementLoudNotificationCount = event.mentionedAccountIds.has(account.id);

//             const generation = inboxItem?.generation ?? initialInboxGeneration;

//             await DynamoTableSchema.executeTransaction(context, [
//                 NotificationsTable.transactionDirectlyUpdateItem({
//                     ...inboxItem,
//                     partitionType: "Inbox",
//                     sortRangeType: "Attributes",
//                     spaceId,
//                     accountId: account.id,
//                     generation,
//                     loudNotificationCount:
//                         (inboxItem?.loudNotificationCount ?? 0) +
//                         (shouldIncrementLoudNotificationCount ? 1 : 0),
//                 }),
//                 NotificationsTable.transactionDirectlyUpdateItem({
//                     ...inboxEntryItem,
//                     partitionType: "Inbox",
//                     sortRangeType: "DocumentCommentThreadsEntry",
//                     spaceId,
//                     accountId: account.id,
//                     documentId: event.documentId,
//                     isArchived: false,
//                     loudNotificationCount:
//                         (inboxEntryItem?.loudNotificationCount ?? 0) +
//                         (shouldIncrementLoudNotificationCount ? 1 : 0),
//                 }),
//             ]);
//         });
//     },
// });

// const processNotificationCreatePostEvent = createNotificationEventProcessor<
//     NotificationCreatePostEvent,
//     {spaceId: SpaceId; channelId: ChannelId}
// >({
//     getSubscribers: async (context, event) => {
//         const {spaceId, channelId} = await getPostChannel(context, event.postId);

//         // NOTE(calebmer): Currently we deliver a notification for a new post to every
//         // account in the space! Since we don't have a notion of post subscribers yet
//         // or a notion of private channels. This will change (hopefully soon) but this
//         // is a reasonable alpha behavior.
//         //
//         // When we make this change we should make sure that `mentionedAccountIds` get
//         // a notification even if they are not in the channel.
//         const accounts = await expensivelyGetAllSpaceAccounts(context, spaceId);

//         return {
//             info: {spaceId, channelId},
//             accounts,
//         };
//     },
//     updateInboxEntry: async (context, event, {spaceId, channelId}, account) => {
//         await context.dynamo.retryTransaction(async context => {
//             const [inboxItem, inboxEntryItem] = await runAllPromises([
//                 NotificationsTable.getItemIfExists(context, {
//                     partitionType: "Inbox",
//                     sortRangeType: "Attributes",
//                     spaceId,
//                     accountId: account.id,
//                 }),
//                 NotificationsTable.getItemIfExists(context, {
//                     partitionType: "Inbox",
//                     sortRangeType: "ChannelPostsEntry",
//                     spaceId,
//                     accountId: account.id,
//                     channelId,
//                 }),
//             ]);

//             // We increment the loud notification count only if someone is explicitly
//             // trying to get your attention by mentioning your account. Otherwise, we
//             // expect users will respond to new post comments in their own time.
//             const shouldIncrementLoudNotificationCount = event.mentionedAccountIds.has(account.id);

//             const generation = inboxItem?.generation ?? initialInboxGeneration;

//             await DynamoTableSchema.executeTransaction(context, [
//                 NotificationsTable.transactionDirectlyUpdateItem({
//                     ...inboxItem,
//                     partitionType: "Inbox",
//                     sortRangeType: "Attributes",
//                     spaceId,
//                     accountId: account.id,
//                     generation,
//                     loudNotificationCount:
//                         (inboxItem?.loudNotificationCount ?? 0) +
//                         (shouldIncrementLoudNotificationCount ? 1 : 0),
//                 }),
//                 NotificationsTable.transactionDirectlyUpdateItem({
//                     ...inboxEntryItem,
//                     partitionType: "Inbox",
//                     sortRangeType: "ChannelPostsEntry",
//                     spaceId,
//                     accountId: account.id,
//                     channelId,
//                     isArchived: false,
//                     loudNotificationCount:
//                         (inboxEntryItem?.loudNotificationCount ?? 0) +
//                         (shouldIncrementLoudNotificationCount ? 1 : 0),
//                 }),
//             ]);
//         });
//     },
// });
