import {authorizeChatAccess} from "~/server/chat/data/chat_actions.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessagePayloadSchema,
    MessageStreamPartPayloadSchema,
} from "~/shared/messaging/message_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const ChatTable = DynamoTableSchema.new({
    name: "Chat",
    partitions: [
        /**
         * A chat is a long series of messages over time. It conforms to our
         * messaging implementation so we can render consistent messaging UI across
         * the product.
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
                         * If this is a 1:1 chat between two accounts, we include the two accounts in
                         * the attributes item as an optimization.
                         *
                         * You can't depend on `accountIdsForOneOnOne` existing for a chat with two
                         * accounts! 1:1 chats created before 2023-12-20 will have this set to null.
                         */
                        accountIdsForOneOnOne: Schema.array(Schema.id<AccountId>())
                            .minLength(2)
                            .maxLength(2)
                            .nullable()
                            .default(null),

                        /**
                         * Information regarding the chat's messages. Nested in an object so we can
                         * update it at once.
                         */
                        messagesSummary: Schema.object({
                            /**
                             * The index of the next message.
                             */
                            nextMessageIndex: Schema.integer.min(0),

                            /**
                             * The last time a message was changed. This should equal the `changeTime` of
                             * the highest item in `MessageChangeLog`.
                             */
                            lastChangeTime: Schema.date.nullable().default(null),

                            /**
                             * The total number of messages in the chat.
                             */
                            messageCount: Schema.integer.min(0),
                        }),
                    }),
                },

                /**
                 * Accounts that are members of the chat. We have a reverse index of accounts
                 * to chats the account is a member of.
                 */
                {
                    name: "Account",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * This is a copy of the `spaceId` in a chat's attributes so we can include it
                         * in the account to chats index.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /** The time at which the account joined the chat. */
                        joinedTime: Schema.date,

                        /**
                         * The number of accounts total in the chat.
                         *
                         * While you could get this by querying account items in the chat partition,
                         * it's really convenient to duplicate that number here so it's present in
                         * `AccountChatsIndex`. This does mean we have to take care to update this
                         * property whenever the number of accounts in a chat changes!
                         */
                        chatAccountCount: Schema.integer,
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
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: Schema.object({
                                // We duplicate `authorId` here to easily check if the bot is allowed to update
                                // the stream.
                                authorId: Schema.id<AccountId>(),

                                /**
                                 * When the stream was completed. If null then the stream hasn’t been
                                 * finished so we should expect more updates!
                                 *
                                 * If a stream hasn't completed for some period of time since creation (a
                                 * couple hours) then we consider the stream to be completed whether or not
                                 * it actually has been completed.
                                 */
                                completedTime: Schema.date.nullable(),

                                /**
                                 * The number of parts in the stream so far. A bot can only ever create
                                 * new parts or update the last part in the stream.
                                 */
                                partCount: Schema.integer.min(0),

                                /**
                                 * The current `updateLockVersion` of the last part in the stream.
                                 */
                                lastPartUpdateLockVersion: Schema.integer.min(0).nullable(),

                                /**
                                 * The last `IndexSearchEntity` job that was sent for this stream. We send an
                                 * `IndexSearchEntity` job once every 10 seconds.
                                 */
                                lastIndexSearchEntityJob: Schema.object({
                                    sendTime: Schema.date,
                                    delaySeconds: Schema.integer.min(0),
                                }),
                            }),
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                payload: MessageStreamPartPayloadSchema,
                            }),
                        },
                    ],
                },

                /**
                 * We keep a log of changes to messages so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in `messagesSummary`.
                 *
                 * This log does not include when messages are created, only updated or
                 * deleted. Because message indexes are dense we can take the last seen message
                 * index and load messages after that to backfill.
                 *
                 * Log items will expire after a certain amount of time. If a client hasn't
                 * backfilled in a long time it will need to fully reload since we won't know
                 * what changed.
                 */
                {
                    name: "MessageChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        messageIndex: Schema.integer,
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                                // `contentUpdatedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                                // `deletedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

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
const FileChatAuthorizer = FileAuthorizer.new(ChatTable, "Chat", (context, target) =>
    authorizeChatAccess(context, target.chatId),
);

export {FileChatAuthorizer as InternalFileChatAuthorizer};
