import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {
    MessageStreamAttributesSchema,
    MessageStreamPartSchema,
} from "~/server/messaging/helpers/message_stream_schema.js";
import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessagePayloadSchema} from "~/shared/messaging/message_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const ChatTable = DynamoTableSchema.new({
    name: "Chat",
    partitions: [
        /**
         * A chat is a long series of messages over time. It conforms to our messaging
         * implementation so we can render consistent messaging UI across the product.
         */
        {
            name: "Chat",
            partitionKeyAttributes: {
                chatId: DynamoKeyAttributeSchema.id<ChatId>(),
            },
            sortRanges: [
                /**
                 * Information about the chat itself.
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /** The space a chat lives in. */
                        spaceId: Schema.id<SpaceId>(),

                        /** The time at which the chat was created. */
                        createdTime: Schema.date,

                        /**
                         * Is this a room chat or a direct chat between accounts? Influences how the chat
                         * is displayed and how permissions are calculated.
                         */
                        definition: Schema.union({
                            Direct: Schema.object({
                                type: Schema.value("Direct"),
                            }),
                            Room: Schema.object({
                                type: Schema.value("Room"),

                                /**
                                 * The chat's name.
                                 */
                                name: LabelStringSchema,

                                /**
                                 * Who's allowed to read/write to this chat. For direct chats only accounts within
                                 * the chat are allowed. For room chats, anyone is allowed!
                                 */
                                accessPolicy: AccessPolicySchema,

                                /**
                                 * Account that created the chat room. Mostly for record keeping. The creator can
                                 * lose access if they're removed from the `accessPolicy`.
                                 */
                                creatorId: Schema.id<AccountId>(),

                                /**
                                 * Have we added a feed candidate entry for the chat room? We add an entry when the
                                 * chat room is shared with some `defaultGrant`. But if you revoke the
                                 * `defaultGrant` then add it again we don't want to add another feed candidate
                                 * entry.
                                 */
                                hasAddedFeedCandidateEntry: Schema.boolean.default(false),
                            }),
                        }).default({type: "Direct"}),

                        /**
                         * If this is a 1:1 chat between two accounts, we include the two accounts in the
                         * attributes item as an optimization.
                         *
                         * You can't depend on `accountIdsForDirectOneOnOne` existing for a chat with two
                         * accounts! 1:1 chats created before 2023-12-20 will have this set to null.
                         *
                         * Should only be present for direct chats and null otherwise.
                         */
                        accountIdsForDirectOneOnOne: Schema.array(Schema.id<AccountId>())
                            .minLength(2)
                            .maxLength(2)
                            .nullable()
                            .default(null)
                            .originalPropertyKey("accountIdsForOneOnOne"),

                        /**
                         * Information regarding the chat's messages. Nested in an object so we can update
                         * it at once.
                         */
                        messagesSummary: Schema.object({
                            /**
                             * Backwards compatibility: older items stored a total message count under the
                             * `messageCount` key without author attribution.
                             */
                            unknownAuthorMessageCount: Schema.integer
                                .min(0)
                                .originalPropertyKey("messageCount"),

                            /**
                             * All the accounts which have sent messages in this chat and how many messages
                             * they have sent.
                             *
                             * This map can grow unbounded. When a user deletes a message it leaves a
                             * gravestone so message counts should never be decremented.
                             */
                            messageCountByAuthorId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(1),
                            ).default(emptyMap),

                            /**
                             * All the accounts which have been mentioned at some point in this chat.
                             *
                             * Accounts that exist in the map with a mention count of zero have a special
                             * meaning:
                             *
                             * - If an account exists in the map they were mentioned at some point
                             * - If an account exists in the map with a mention count of zero then they were
                             *   mentioned at some point but all mentions have been removed by updates
                             * - If an account does not exist in the map they were never mentioned in the chat
                             */
                            mentionCountByAccountId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(0),
                            ).default(emptyMap),
                        }),
                    }).validation(
                        "Only direct chats should have the `accountIdsForDirectOneOnOne` property",
                        value => {
                            if (value.definition.type !== "Direct") {
                                return value.accountIdsForDirectOneOnOne === null;
                            }

                            return true;
                        },
                    ),
                },

                /**
                 * Accounts that are members of the chat. We have a reverse index of accounts to
                 * chats the account is a member of.
                 *
                 * Only direct chats have account items. We remove account items when converting
                 * from a direct chat to a room chat.
                 *
                 * It's possible due to race condition or some failure edge cases (`AppService`
                 * dies before `convertDirectChatToRoomChat()` finishes) that you observe `Account`
                 * items for a `Room` chat. Ignore them in this case. We should eventually cleanup
                 * all `Account` items for `Room` chats.
                 */
                {
                    name: "Account",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * This is a copy of the `spaceId` in a chat's attributes so we can include it in
                         * the account to chats index.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /** The time at which the account joined the chat. */
                        joinedTime: Schema.date,

                        /**
                         * The number of accounts total in the chat.
                         *
                         * While you could get this by querying account items in the chat partition, it's
                         * really convenient to duplicate that number here so it's present in
                         * `AccountChatsIndex`. This does mean we have to take care to update this property
                         * whenever the number of accounts in a chat changes!
                         */
                        chatAccountCount: Schema.integer,
                    }),
                },

                /**
                 * Accounts subscribed to notifications for a chat room.
                 *
                 * Only room chats should have subscriptions. All accounts in a direct chat are
                 * subscribed.
                 *
                 * It's possible due to race condition or some failure edge cases (`AppService`
                 * dies before `convertDirectChatToRoomChat()` finishes) that you observe
                 * `Subscription` items for a `Direct` chat. Ignore them in this case. We should
                 * eventually cleanup all `Subscription` items for `Direct` chats.
                 */
                {
                    name: "Subscription",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        isSubscribed: Schema.boolean,
                    }),
                },

                /**
                 * All the messages in our chat.
                 */
                {
                    name: "Messages",
                    sortKeyAttributes: {
                        messageIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        createdTimeZone: TimeZoneSchema.default(defaultTimeZone),
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: MessageStreamAttributesSchema,
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: MessageStreamPartSchema,
                        },
                    ],
                },

                /**
                 * Whenever a message is updated we add a `MessageUpdates` item. So when clients
                 * need to backfill realtime events they missed while disconnected from a WebSocket
                 * server they can query this sort range to catch up.
                 *
                 * The event includes the `messageIndex` and the new `version` of the message.
                 * During backfill we load the new version of the item.
                 *
                 * This sort range has a similar design to the `Events` sort range in
                 * `DynamoGeneralRealtimeTableSchema`.
                 *
                 * IMPORTANT: This does not include realtime events for streaming messages!
                 * Streaming messages are updated with a different realtime system that's more
                 * efficient for the streaming use case.
                 */
                {
                    name: "MessageUpdates",
                    sortKeyAttributes: {
                        // NOTE(calebmer): Reversed so if we ever wanted to backfill in one query we could.
                        // Through a query that starts at the client's last `messageIndex` and ends at the
                        // checkpoint's `eventTime`.
                        eventTime: DynamoKeyAttributeSchema.date.reverse(),
                        // All the data is in the key so we can safely use create-or-replace to add items
                        // to the table without worrying we're overriding some other data.
                        messageIndex: DynamoKeyAttributeSchema.integer,
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },

                // NOTE(calebmer, 2025-10-13): We changed the format for messaging realtime events
                // to a new sort range: `MessageUpdates`. Leaving this around until all old
                // `MessageChangeLog` items expire. At which point we can remove this from the
                // DynamoDB schema.
                {
                    name: "MessageChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        messageIndex: Schema.integer,
                        change: Schema.unknown(),
                    }),
                },
            ],
        },
    ],
});

export type ChatAttributesItem = DynamoTableItemType<typeof ChatTable, "Chat", "Attributes">;
export type ChatAccountItem = DynamoTableItemType<typeof ChatTable, "Chat", "Account">;
export type ChatSubscriptionItem = DynamoTableItemType<typeof ChatTable, "Chat", "Subscription">;

export type ChatItem = {
    readonly attributesItem: ChatAttributesItem;
    readonly accountItems: ReadonlyArray<ChatAccountItem>;
};

export const AccountChatsIndex = ChatTable.addIndex({
    name: "AccountChats",
    itemTypes: [{partitionType: "Chat", sortRangeType: "Account"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {
        chatAccountCount: DynamoKeyAttributeSchema.integer,
        chatId: DynamoKeyAttributeSchema.id<ChatId>(),
    },
});

// Authorizers must be declared next to their respective Tables
const FileChatAuthorizer = FileAuthorizer.new(
    ChatTable,
    "Chat",
    (context, target, expectedAccessLevel) =>
        authorizeChatAccess(context, target.chatId, expectedAccessLevel),
);

export {FileChatAuthorizer as InternalFileChatAuthorizer};
