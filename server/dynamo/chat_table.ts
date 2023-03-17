import murmurhash from "murmurhash";
import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getContentReferencesFromNode} from "~/server/dynamo/helpers/get_content_references";
import {createMessagePayloadModel} from "~/server/dynamo/helpers/messaging/create_message_payload_model";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/dynamo/helpers/messaging/get_message_change_log_expiration_time_from_change_time";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/internal/is_dynamo_idempotent_parameter_mismatch_error";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {MessageContent, MessageContentSchema} from "~/shared/content/message_content_schema";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error";
import {compareArrays} from "~/shared/helpers/array/compare_arrays";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {isObject} from "~/shared/helpers/object/is_object";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {decodeIdInto, encodeId, generateId} from "~/shared/id/id";
import {AccountId, ChatId, SessionId, SpaceId} from "~/shared/id/types/id_types";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema";
import {AccountModel} from "~/shared/models/account_model";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {MessagePayloadSchema} from "~/shared/models/message_model";
import {Schema} from "~/shared/schema/schema";

const ChatTable = DynamoTableSchema.new({
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
                },

                /**
                 * We keep a log of changes to messages so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in `messagesSummary`.
                 *
                 * This log does not include new messages. Because message indexes are dense we
                 * can take the last seen message index and load messages after that to
                 * backfill.
                 *
                 * Log items will expire after a certain amount of time.
                 */
                {
                    name: "MessageChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        messageIndex: Schema.integer,
                        // The `contentUpdatedTime` or `deletedTime` is the `changeTime`.
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

const AccountChatsIndex = ChatTable.addIndex({
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

type ChatAttributesItem = DynamoTableItemType<typeof ChatTable, "Chat", "Attributes">;
type ChatAccountItem = DynamoTableItemType<typeof ChatTable, "Chat", "Account">;
type ChatMessageItem = DynamoTableItemType<typeof ChatTable, "Chat", "Messages">;

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in test environments.
 */
export function getChatTableForTest() {
    assert(process.env.NODE_ENV === "test");
    return ChatTable;
}

export const sendChatMessageToAccountsBeforeCreateChatTestCheckpoint =
    new TestCheckpoint<SessionId>();

/**
 * Create a new chat with the provided accounts and no messages but only in
 * test environments. In other the app we use `sendChatMessageToAccounts()`
 * to create chats.
 */
export async function createChatForTest(
    context: RequestContext,
    {
        id = generateId<ChatId>(),
        spaceId,
        otherAccountIds,
    }: {
        id?: ChatId;
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
    },
): Promise<{
    id: ChatId;
    createdTime: Date;
}> {
    assert(process.env.NODE_ENV === "test");

    const accountIds = Array.from(
        new Set([...otherAccountIds, context.auth.getAccountId()]),
    ).sort();

    // Make sure all accounts are members of the space the chat is being
    // created in.
    await runAllPromises(
        accountIds.map(accountId => getAccountOrThrow(context, spaceId, accountId)),
    );

    // NOTE(calebmer): Our tests override `Date.now()` to mock a fake time. So use
    // this slightly awkward form to let tests mock different times for chat
    // creation.
    const createdTime = new Date(Date.now());

    await DynamoTableSchema.executeTransaction(context, [
        ChatTable.transactionCreateItem({
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId: id,
            spaceId,
            createdTime,
            messagesSummary: {
                nextMessageIndex: 0,
                lastChangeTime: null,
                messageCount: 0,
            },
        }),
        ...Array.from(accountIds, accountId =>
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "Account",
                spaceId,
                chatId: id,
                accountId,
                joinedTime: createdTime,
                chatAccountCount: accountIds.length,
            }),
        ),
    ]);

    return {
        id,
        createdTime,
    };
}

/**
 * When sending a message to a set of accounts but we don't know the `ChatId`
 * for the conversation, we guess an optimistic `ChatId` which is a hash of the
 * accounts and the space. If this chat exists and has only the provided
 * members then great! We use it. If this chat does not exist then we create it.
 * If the chat does exist but has different members or is in a different space
 * then we need to create a new chat.
 */
export async function getOptimisticChatId(
    spaceId: SpaceId,
    accountIds: ReadonlyArray<AccountId>,
): Promise<ChatId> {
    assert(accountIds.length > 0);

    let isAlreadySorted = true;
    let lastAccountId: AccountId | undefined;
    for (const accountId of accountIds) {
        if (lastAccountId !== undefined && accountId <= lastAccountId) {
            isAlreadySorted = false;
            break;
        }
        lastAccountId = accountId;
    }

    const allSortedAccountIds = isAlreadySorted
        ? accountIds
        : Array.from(new Set(accountIds)).sort();

    const optimisticChatIdHashKey = new ArrayBuffer(16 * (allSortedAccountIds.length + 1));
    decodeIdInto(spaceId, new Uint8Array(optimisticChatIdHashKey, 0, 16));
    for (let i = 0; i < allSortedAccountIds.length; i++) {
        const accountId = allSortedAccountIds[i]!;
        decodeIdInto(accountId, new Uint8Array(optimisticChatIdHashKey, 16 * (i + 1), 16));
    }

    // Our optimistic `ChatId` is an MD5 hash of all the accounts we want to
    // message and the space we want to message in. MD5 is not suitable for secure
    // applications! However, we do not need security guarantees here, this is a
    // performance optimization. We use MD5 since it is fast and it outputs as
    // 128-bit value. Our `Id`s our 128-bit so this aligns quite well.
    return encodeId(new Uint8Array(await hashMd5(optimisticChatIdHashKey))) as ChatId;
}

let webCryptoSupportsMd5Hash = true;

async function hashMd5(data: ArrayBuffer): Promise<ArrayBuffer> {
    if (!webCryptoSupportsMd5Hash) {
        return hashMd5WithNodeModule(data);
    }

    try {
        // MD5 is supported by the Cloudflare WebCrypto implementation but is
        // non-standard because it is insecure.
        // https://developers.cloudflare.com/workers/runtime-apis/web-crypto#supported-algorithms
        return await crypto.subtle.digest("MD5", data);
    } catch (error) {
        if (
            isObject(error) &&
            typeof error.message === "string" &&
            error.message.includes("Unrecognized name")
        ) {
            webCryptoSupportsMd5Hash = false;
            return hashMd5WithNodeModule(data);
        }
        throw error;
    }
}

function hashMd5WithNodeModule(data: ArrayBuffer): ArrayBuffer {
    // We don't have `@types/node` for this package so TypeScript doesn't know
    // about the `require()` function. We can't expect the error since when type
    // checking globally TypeScript does know about the `require()` function.
    // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
    // @ts-ignore
    const crypto = require("crypto");
    return crypto.createHash("md5").update(new Uint8Array(data)).digest().buffer;
}

/**
 * Sends a chat message to the provided accounts without knowing a `ChatId`
 * that includes all the relevant accounts. If a chat already exists with all
 * the relevant accounts (and no one else) then we will send the message to
 * that chat. If no chat exists between the relevant accounts then we will
 * create a new chat and send a message to that chat.
 *
 * This is less efficient then `sendChatMessage()` so if you know the `ChatId`
 * use that instead. In the happy path for this function we can guess the right
 * `ChatId` by producing a hash of accounts in the chat and use that as the
 * `ChatId`. If a different chat lives at that hash then we have to search
 * through the shared chats between accounts we're trying to send a message to.
 */
export function sendChatMessageToAccounts(
    context: RequestContext,
    {
        spaceId,
        otherAccountIds: _otherAccountIds,
        parentMessageIndex,
        content,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
        parentMessageIndex: number | null;
        content: MessageContent;
    },
) {
    return retryWithExponentialBackoff(async retry => {
        // Make sure `accountIds` is unique and doesn't include our
        // authenticated account.
        const otherAccountIds = new Set(
            _otherAccountIds.filter(accountId => accountId !== context.auth.getAccountId()),
        );

        const allSortedAccountIds = [...otherAccountIds, context.auth.getAccountId()].sort();

        const getChatAndAccounts = async (
            chatId: ChatId,
        ): Promise<{
            chatItem: ChatAttributesItem;
            chatAccountItems: Array<ChatAccountItem>;
        } | null> => {
            let chatItem: ChatAttributesItem | undefined;
            const chatAccountItems: Array<ChatAccountItem> = [];

            for await (const item of ChatTable.query(context, {
                partitionKey: {
                    partitionType: "Chat",
                    chatId,
                },
                startSortKey: {
                    sortRangeType: "Attributes",
                },
                endSortKey: {
                    sortRangeType: "Account",
                    accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
                },
                limit: "All",
            })) {
                switch (item.sortRangeType) {
                    case "Attributes": {
                        assert(!chatItem);
                        chatItem = item;
                        break;
                    }
                    case "Account": {
                        assert(chatItem);
                        chatAccountItems.push(item);
                        break;
                    }
                    default:
                        throw exhaustive(item);
                }
            }

            if (!chatItem) return null;

            return {
                chatItem,
                chatAccountItems,
            };
        };

        const createChatForAccounts = async (chatId: ChatId) => {
            await sendChatMessageToAccountsBeforeCreateChatTestCheckpoint.waitForTest(
                context.auth.getSessionId(),
            );

            try {
                const createdTime = new Date();

                const chatItem: ChatAttributesItem = {
                    partitionType: "Chat",
                    sortRangeType: "Attributes",
                    chatId,
                    spaceId,
                    createdTime,
                    messagesSummary: {
                        nextMessageIndex: 0,
                        lastChangeTime: null,
                        messageCount: 0,
                    },
                };

                await DynamoTableSchema.executeTransaction(
                    context,
                    [
                        ChatTable.transactionCreateItem(chatItem),
                        ...Array.from(allSortedAccountIds, accountId =>
                            ChatTable.transactionCreateOrReplaceItem({
                                partitionType: "Chat",
                                sortRangeType: "Account",
                                spaceId,
                                chatId,
                                accountId,
                                joinedTime: createdTime,
                                chatAccountCount: allSortedAccountIds.length,
                            }),
                        ),
                    ],
                    {
                        // If two processes try to create a chat at the same time for the same
                        // accounts, we want to treat this transaction as idempotent.
                        clientRequestToken: `sendMessageToAccounts:${murmurhash
                            .v3(`${spaceId}:${allSortedAccountIds.join("-")}`)
                            .toString(16)
                            .padStart(8, "0")}`,
                    },
                );

                return chatItem;
            } catch (error) {
                // If we have a race condition where some other process created this chat
                // before us then retry our action. Retrying should load the chat created by
                // the other process.
                if (
                    isDynamoConditionCheckError(error) ||
                    isDynamoIdempotentParameterMismatchError(error)
                ) {
                    retry();
                }

                throw error;
            }
        };

        const [{optimisticChatId, optimisticChatAndAccounts}] = await runAllPromises([
            (async () => {
                const optimisticChatId = await getOptimisticChatId(spaceId, allSortedAccountIds);
                const optimisticChatAndAccounts = await getChatAndAccounts(optimisticChatId);
                return {optimisticChatId, optimisticChatAndAccounts};
            })(),

            // Make sure the authenticated account has access to the space.
            authorizeSpaceAccess(context, spaceId),

            // Make sure all accounts we are sending a message to are a part of the
            // provided space.
            runAllPromises(
                Array.from(otherAccountIds, accountId =>
                    getAccountOrThrow(context, spaceId, accountId),
                ),
            ),
        ]);

        // If the optimistic `ChatId` does not exist then create a new chat with the
        // optimistic `ChatId` and send a message there.
        if (!optimisticChatAndAccounts) {
            const optimisticChatItem = await createChatForAccounts(optimisticChatId);

            return actuallySendChatMessage(context, {
                chatId: optimisticChatId,
                parentMessageIndex,
                content,
                initialAuthorizedChatItem: optimisticChatItem,
            });
        }

        // If the optimistic `ChatId` exists then we need to double check it matches
        // our expected space and accounts. If it does then hooray! We can send a chat
        // message here.
        if (
            optimisticChatAndAccounts.chatItem.spaceId === spaceId &&
            isDeepEqual(
                allSortedAccountIds,
                // Chat account items should be sorted by DynamoDB.
                optimisticChatAndAccounts.chatAccountItems.map(item => item.accountId),
            )
        ) {
            return actuallySendChatMessage(context, {
                chatId: optimisticChatId,
                parentMessageIndex,
                content,
                initialAuthorizedChatItem: optimisticChatAndAccounts.chatItem,
            });
        }

        const sharedChats = await getSharedChats(context, {
            spaceId,
            otherAccountIds,
        });

        const firstSharedChat = sharedChats[0];

        // We found a chat that exactly matches the accounts we want to message! Send a
        // message to that chat.
        if (
            firstSharedChat?.includedOtherAccountIds.length === otherAccountIds.size &&
            firstSharedChat.accountCount === otherAccountIds.size + 1
        ) {
            return actuallySendChatMessage(context, {
                chatId: firstSharedChat.id,
                parentMessageIndex,
                content,
            });
        }

        const chatItem = await createChatForAccounts(generateId());

        return actuallySendChatMessage(context, {
            chatId: chatItem.chatId,
            parentMessageIndex,
            content,
            initialAuthorizedChatItem: chatItem,
        });
    });
}

/**
 * Send a message to to the provided chat.
 */
export function sendChatMessage(
    context: RequestContext,
    {
        chatId,
        parentMessageIndex,
        content,
    }: {
        chatId: ChatId;
        parentMessageIndex: number | null;
        content: MessageContent;
    },
): Promise<{
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    return actuallySendChatMessage(context, {
        chatId,
        parentMessageIndex,
        content,
    });
}

function actuallySendChatMessage(
    context: RequestContext,
    {
        chatId,
        parentMessageIndex,
        content,
        initialAuthorizedChatItem,
    }: {
        chatId: ChatId;
        parentMessageIndex: number | null;
        content: MessageContent;
        initialAuthorizedChatItem?: ChatAttributesItem;
    },
): Promise<{
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    let hasMadeInitialAttempt = false;

    return retryDynamoConditionCheckErrors(async () => {
        const isInitialAttempt = !hasMadeInitialAttempt;
        hasMadeInitialAttempt = true;

        const [chatItem] = await runAllPromiseThunks(
            async () => {
                const chatItem =
                    (isInitialAttempt ? initialAuthorizedChatItem : null) ??
                    (await ChatTable.getItem(context, {
                        partitionType: "Chat",
                        sortRangeType: "Attributes",
                        chatId,
                    }));
                if (!chatItem) throw new NotFoundError("Chat not found");

                if (chatItem !== initialAuthorizedChatItem) {
                    await authorizeChatAccessWithItem(context, chatItem);
                }

                return chatItem;
            },
            async () => {
                if (typeof parentMessageIndex !== "number") return;

                const parentMessageItem = await ChatTable.getPartialItem(
                    context,
                    {
                        partitionType: "Chat",
                        sortRangeType: "Messages",
                        chatId,
                        messageIndex: parentMessageIndex,
                    },
                    {
                        attributes: [],
                    },
                );
                if (!parentMessageItem) throw new NotFoundError("Post parent comment not found");
            },
        );

        const messageIndex = chatItem.messagesSummary.nextMessageIndex;
        const createdTime = new Date();
        const authorId = context.auth.getAccountId();

        await DynamoTableSchema.executeTransaction(context, [
            ChatTable.transactionCreateItem({
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
                authorId,
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex,
                    content,
                    contentUpdatedTime: null,
                },
            }),
            ChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                "messagesSummary",
                {
                    nextMessageIndex: chatItem.messagesSummary.nextMessageIndex + 1,
                    lastChangeTime: chatItem.messagesSummary.lastChangeTime,
                    messageCount: chatItem.messagesSummary.messageCount + 1,
                },
                {updateLockVersion: chatItem.updateLockVersion},
            ),
        ]);

        return {
            chatId,
            index: messageIndex,
            createdTime,
        };
    });
}

async function authorizeChatAccess(
    context: RequestContext,
    chatId: ChatId,
): Promise<{spaceId: SpaceId}> {
    const [chatItem, chatAccountItem] = await runAllPromises([
        (async () => {
            const chatItem = await ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Attributes",
                chatId,
            });
            if (!chatItem) throw new NotFoundError("Chat not found");

            await authorizeSpaceAccess(context, chatItem.spaceId);
            return chatItem;
        })(),
        ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Account",
            chatId,
            accountId: context.auth.getAccountId(),
        }),
    ]);

    if (!chatAccountItem) throw new PermissionDeniedError("Account does not have access to chat");

    return {spaceId: chatItem.spaceId};
}

async function authorizeChatAccessWithItem(
    context: RequestContext,
    chatItem: Pick<ChatAttributesItem, "chatId" | "spaceId">,
) {
    const [, chatAccountItem] = await runAllPromises([
        authorizeSpaceAccess(context, chatItem.spaceId),
        ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Account",
            chatId: chatItem.chatId,
            accountId: context.auth.getAccountId(),
        }),
    ]);

    if (!chatAccountItem) throw new PermissionDeniedError("Account does not have access to chat");
}

/**
 * Get chats shared between the authenticated account and provided accounts in
 * the provided space.
 *
 * Returns an array of chats and the accounts we provided to this function
 * which are included in the chat. Chats with the most number of requested
 * accounts and least number of non-requested accounts come first in the
 * resulting array. If we find an exact match between our account and the
 * accounts we're searching it will be first in the list.
 *
 * The current implementation isn't optimized. It loads all chats for each
 * account and finds intersecting chats.
 *
 * Idea for an optimized implementation: For every pair of accounts in a space
 * (key: `{spaceId, account1Id, account2Id}`) maintain a list of `ChatId`s they
 * are both in. Then to implement this function load all pairs between the
 * authenticated account and other accounts (should be O(otherAccounts)) and
 * intersect those chat IDs. This would eliminate a lot of the search space of
 * this function.
 *
 * Decided that the search space is small enough (~100 * number of accounts)
 * and the items are small enough it's not worth prematurely optimizing this
 * function.
 */
export function getSharedChats(
    context: RequestContext,
    {
        spaceId,
        otherAccountIds: _otherAccountIds,
    }: {
        spaceId: SpaceId;
        otherAccountIds: Iterable<AccountId>;
    },
): Promise<
    Array<{
        id: ChatId;
        accountCount: number;
        /**
         * The chat includes these accounts that were provided when you called the
         * function. The chat may include more accounts! This is not the exclusive list
         * of accounts in the chat.
         */
        includedOtherAccountIds: ReadonlyArray<AccountId>;
    }>
> {
    return context.tracer.withSpan("getSharedChats", async context => {
        const otherAccountIds = new Set(
            filterIterable(
                _otherAccountIds,
                accountId => accountId !== context.auth.getAccountId(),
            ),
        );

        const chatById = new Map<
            ChatId,
            {accountCount: number; includedAccountIds: Set<AccountId>}
        >();

        await runAllPromiseThunks(
            async () => {
                const ourAccountChats = await arrayFromAsyncIterable(
                    AccountChatsIndex.query(context, {
                        partitionKey: {spaceId, accountId: context.auth.getAccountId()},
                        limit: "All",
                    }),
                );

                for (const accountChat of ourAccountChats) {
                    const chat = getOrSetDefaultMapValue(chatById, accountChat.chatId, () => ({
                        accountCount: accountChat.chatAccountCount,
                        includedAccountIds: new Set<AccountId>(),
                    }));

                    chat.includedAccountIds.add(context.auth.getAccountId());
                }
            },
            async () => {
                const otherAccountChatsByAccountId = await runAllPromises(
                    Array.from(otherAccountIds, async accountId => {
                        const otherAccountChats = await arrayFromAsyncIterable(
                            AccountChatsIndex.query(context, {
                                partitionKey: {spaceId, accountId},
                                limit: "All",
                            }),
                        );
                        return [accountId, otherAccountChats] as const;
                    }),
                );

                for (const [accountId, otherAccountChats] of otherAccountChatsByAccountId) {
                    for (const accountChat of otherAccountChats) {
                        const chat = getOrSetDefaultMapValue(chatById, accountChat.chatId, () => ({
                            accountCount: accountChat.chatAccountCount,
                            includedAccountIds: new Set<AccountId>(),
                        }));

                        chat.includedAccountIds.add(accountId);
                    }
                }
            },
        );

        const chatsByIncludedOtherAccountIds = new Map<
            string,
            {
                readonly includedOtherAccountIds: ReadonlyArray<AccountId>;
                chats: Array<{id: ChatId; accountCount: number}>;
            }
        >();

        for (const [chatId, chat] of chatById) {
            // We only want to include chats that are shared between multiple users in our
            // final result.
            if (otherAccountIds.size > 0 && chat.includedAccountIds.size <= 1) continue;

            // Do not include chats that do not include the authenticated account! You are
            // not allowed to see what chats other accounts are members of.
            if (!chat.includedAccountIds.has(context.auth.getAccountId())) continue;

            const includedOtherAccountIds = Array.from(
                filterIterable(
                    chat.includedAccountIds,
                    accountId => accountId !== context.auth.getAccountId(),
                ),
            ).sort(defaultCompareStrings);

            getOrSetDefaultMapValue(
                chatsByIncludedOtherAccountIds,
                includedOtherAccountIds.join("-"),
                () => ({
                    includedOtherAccountIds,
                    chats: [],
                }),
            ).chats.push({
                id: chatId,
                accountCount: chat.accountCount,
            });
        }

        return Array.from(
            flatMapIterable(
                chatsByIncludedOtherAccountIds.values(),
                ({includedOtherAccountIds, chats}) =>
                    chats.map(chat => ({
                        id: chat.id,
                        accountCount: chat.accountCount,
                        includedOtherAccountIds,
                    })),
            ),
        ).sort(
            (a, b) =>
                // Put shared chats with more accounts in common first
                (a.includedOtherAccountIds.length - b.includedOtherAccountIds.length) * -1 ||
                // Then sort by accounts with fewer members (an exact matching chat should be first!)
                a.accountCount - b.accountCount ||
                // Then sort by account id order to be deterministic
                compareArrays(
                    a.includedOtherAccountIds,
                    b.includedOtherAccountIds,
                    defaultCompareStrings,
                ) ||
                // Sort by `ChatId` if the `AccountId` array is equal.
                defaultCompareStrings(a.id, b.id),
        );
    });
}

/**
 * Get the provided chat by ID. Returning null if the chat does not exist.
 */
export async function getChat(context: RequestContext, chatId: ChatId): Promise<ChatModel | null> {
    let chatItem: ChatAttributesItem | undefined;
    const accountPromises: Array<Promise<AccountModel>> = [];

    for await (const item of ChatTable.query(context, {
        partitionKey: {
            partitionType: "Chat",
            chatId,
        },
        startSortKey: {
            sortRangeType: "Attributes",
        },
        endSortKey: {
            sortRangeType: "Account",
            accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
        },
        limit: "All",
    })) {
        switch (item.sortRangeType) {
            case "Attributes": {
                assert(!chatItem);
                chatItem = item;
                break;
            }
            case "Account": {
                assert(chatItem);

                if (item.spaceId !== chatItem.spaceId)
                    throw new DataLossError(
                        "Expected chat account item to have same space ID as chat item",
                    );

                accountPromises.push(getAccountOrThrow(context, chatItem.spaceId, item.accountId));
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (!chatItem) return null;

    const [accounts] = await runAllPromises([
        runAllPromises(accountPromises),
        authorizeSpaceAccess(context, chatItem.spaceId),
    ]);

    if (!accounts.some(account => account.id === context.auth.getAccountId()))
        throw new PermissionDeniedError("Account does not have access to chat");

    return new ChatModel({
        id: chatItem.chatId,
        spaceId: chatItem.spaceId,
        createdTime: chatItem.createdTime,
        messageCount: chatItem.messagesSummary.messageCount,
        lastMessageChangeTime: chatItem.messagesSummary.lastChangeTime,
        accounts,
    });
}

/**
 * Get a single chat message comment.
 */
export async function getChatMessage(
    context: RequestContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<ChatMessageModel | null> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId),
        ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Messages",
            chatId,
            messageIndex,
        }),
    ]);

    if (!item) return null;
    return createChatMessageModelFromItem(context, spaceId, item);
}

async function createChatMessageModelFromItem(
    context: RequestContext,
    spaceId: SpaceId,
    item: ChatMessageItem,
): Promise<ChatMessageModel> {
    const [author, payload] = await runAllPromises([
        getAccountOrThrow(context, spaceId, item.authorId),
        createMessagePayloadModel(context, spaceId, item.payload),
    ]);

    return new ChatMessageModel({
        chatId: item.chatId,
        index: item.messageIndex,
        author,
        createdTime: item.createdTime,
        payload,
    });
}

/**
 * Update the contents of a chat message.
 */
export function updateChatMessageContent(
    context: RequestContext,
    {
        chatId,
        messageIndex,
        content,
    }: {
        chatId: ChatId;
        messageIndex: number;
        content: MessageContent;
    },
): Promise<{
    contentUpdatedTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [chatItem, chatMessageItem] = await runAllPromises([
            ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Attributes",
                chatId,
            }),
            ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            }),
        ]);

        if (!chatItem) throw new NotFoundError("Chat not found");
        if (!chatMessageItem) throw new NotFoundError("Chat message not found");

        await authorizeChatAccessWithItem(context, chatItem);

        if (chatMessageItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only update chat messages you authored");

        if (chatMessageItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not chat messages with a non-content payload");

        const contentUpdatedTime = new Date(
            Math.max(
                (chatItem.messagesSummary.lastChangeTime ?? chatItem.createdTime).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `contentUpdatedTime`.
        assert(
            !chatMessageItem.payload.contentUpdatedTime ||
                contentUpdatedTime > chatMessageItem.payload.contentUpdatedTime,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ChatTable.transactionDirectlyUpdateItem({
                ...chatMessageItem,
                payload: {
                    ...chatMessageItem.payload,
                    content,
                    contentUpdatedTime,
                },
            }),
            ChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                "messagesSummary",
                {
                    nextMessageIndex: chatItem.messagesSummary.nextMessageIndex,
                    lastChangeTime: contentUpdatedTime,
                    messageCount: chatItem.messagesSummary.messageCount,
                },
                {updateLockVersion: chatItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageChangeLog",
                chatId,
                changeTime: contentUpdatedTime,
                messageIndex: chatMessageItem.messageIndex,
                change: {
                    type: "UpdateContent",
                    content,
                },
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(contentUpdatedTime),
            }),
        ]);

        return {contentUpdatedTime};
    });
}

/**
 * Delete a single chat message.
 */
export function deleteChatMessage(
    context: RequestContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<{deletedTime: Date}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [chatItem, chatMessageItem] = await runAllPromises([
            ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Attributes",
                chatId,
            }),
            ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            }),
        ]);

        if (!chatItem) throw new NotFoundError("Chat not found");
        if (!chatMessageItem) throw new NotFoundError("Chat message not found");

        await authorizeChatAccessWithItem(context, chatItem);

        if (chatMessageItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only delete chat messages you authored");

        if (chatMessageItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not delete messages with a non-content payload");

        const deletedTime = new Date(
            Math.max(
                (chatItem.messagesSummary.lastChangeTime ?? chatItem.createdTime).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `deletedTime`.
        assert(
            !chatMessageItem.payload.contentUpdatedTime ||
                deletedTime > chatMessageItem.payload.contentUpdatedTime,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ChatTable.transactionDirectlyUpdateItem({
                ...chatMessageItem,
                payload: {type: "Deleted", deletedTime},
            }),
            ChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                "messagesSummary",
                {
                    nextMessageIndex: chatItem.messagesSummary.nextMessageIndex,
                    lastChangeTime: deletedTime,
                    messageCount: chatItem.messagesSummary.messageCount,
                },
                {updateLockVersion: chatItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageChangeLog",
                chatId,
                changeTime: deletedTime,
                messageIndex: chatMessageItem.messageIndex,
                change: {type: "Delete"},
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(deletedTime),
            }),
        ]);

        return {deletedTime};
    });
}

/**
 * Paginate through chat messages from start to finish.
 */
export async function getChatMessagesFromStart(
    context: RequestContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messageCount: number;
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
    lastMessageChangeTime: Date | null;
}> {
    const chatItemPromise = (async () => {
        const chatItem = await ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId,
        });
        if (!chatItem) throw new NotFoundError("Chat not found");
        return chatItem;
    })();

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        getChatMessagesFromStartAssumingAuthorizedChat(context, {
            chatId,
            getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        }),
        chatItemPromise.then(chatItem => authorizeChatAccessWithItem(context, chatItem)),
    ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        messageCount: Math.max(
            chatItem.messagesSummary.messageCount,
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages,
        otherReferencedMessages,
        lastMessageChangeTime: chatItem.messagesSummary.lastChangeTime,
    };
}

async function getChatMessagesFromStartAssumingAuthorizedChat(
    context: RequestContext,
    {
        chatId,
        getSpaceId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    const messageIndexes = new Set<number>();
    const parentMessageIndexes = new Set<number>();

    // Don't wait for `getSpaceId` to start our comment query.
    let spaceIdPromise: Promise<SpaceId> | null = null;
    let spaceId: SpaceId | null = null;

    const messagePromises = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            ChatTable.query(context, {
                partitionKey: {
                    partitionType: "Chat",
                    chatId,
                },
                startSortKey: {
                    sortRangeType: "Messages",
                    messageIndex: typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
                },
                endSortKey: {
                    sortRangeType: "Messages",
                    messageIndex:
                        typeof beforeMessageIndex === "number"
                            ? beforeMessageIndex - 1
                            : Number.MAX_SAFE_INTEGER,
                },
                limit,
            }),
            async item => {
                messageIndexes.add(item.messageIndex);

                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
                    parentMessageIndexes.add(item.payload.parentMessageIndex);

                if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                if (spaceId === null) spaceId = await spaceIdPromise;
                return createChatMessageModelFromItem(context, spaceId, item);
            },
        ),
    );

    const [messages, otherReferencedMessages] = await runAllPromises([
        runAllPromises(messagePromises),
        runAllPromises(
            filterMapIterable(parentMessageIndexes, parentMessageIndex => {
                if (messageIndexes.has(parentMessageIndex)) return null;

                return (async () => {
                    const messageItem = await ChatTable.getItem(context, {
                        partitionType: "Chat",
                        sortRangeType: "Messages",
                        chatId,
                        messageIndex: parentMessageIndex,
                    });
                    if (!messageItem) throw new InternalError("Parent message not found");

                    if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                    if (spaceId === null) spaceId = await spaceIdPromise;
                    return createChatMessageModelFromItem(context, spaceId, messageItem);
                })();
            }),
        ),
    ]);

    return {
        messages,
        otherReferencedMessages,
    };
}

/**
 * Paginate through chat messages from finish to start.
 */
export async function getChatMessagesFromEnd(
    context: RequestContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messageCount: number;
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
    lastMessageChangeTime: Date | null;
}> {
    const chatItemPromise = (async () => {
        const chatItem = await ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId,
        });
        if (!chatItem) throw new NotFoundError("Post not found");
        return chatItem;
    })();

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        getChatMessagesFromEndAssumingAuthorizedPost(context, {
            chatId,
            getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        }),
        chatItemPromise.then(chatItem => authorizeChatAccessWithItem(context, chatItem)),
    ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        messageCount: Math.max(
            chatItem.messagesSummary.messageCount,
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages,
        otherReferencedMessages,
        lastMessageChangeTime: chatItem.messagesSummary.lastChangeTime,
    };
}

async function getChatMessagesFromEndAssumingAuthorizedPost(
    context: RequestContext,
    {
        chatId,
        getSpaceId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    const messageIndexes = new Set<number>();
    const parentMessageIndexes = new Set<number>();

    // Don't wait for `getSpaceId` to start our comment query.
    let spaceIdPromise: Promise<SpaceId> | null = null;
    let spaceId: SpaceId | null = null;

    const messagePromises = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            typeof beforeMessageIndex !== "number" || beforeMessageIndex > 0
                ? ChatTable.query(context, {
                      partitionKey: {
                          partitionType: "Chat",
                          chatId,
                      },
                      startSortKey: {
                          sortRangeType: "Messages",
                          messageIndex:
                              typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
                      },
                      endSortKey: {
                          sortRangeType: "Messages",
                          messageIndex:
                              typeof beforeMessageIndex === "number"
                                  ? beforeMessageIndex - 1
                                  : Number.MAX_SAFE_INTEGER,
                      },
                      limit,
                      // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                      // at the end instead of start.
                      descending: true,
                  })
                : (async function* () {})(),
            async item => {
                messageIndexes.add(item.messageIndex);

                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
                    parentMessageIndexes.add(item.payload.parentMessageIndex);

                if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                if (spaceId === null) spaceId = await spaceIdPromise;
                return createChatMessageModelFromItem(context, spaceId, item);
            },
        ),
    );

    const [messages, otherReferencedMessages] = await runAllPromises([
        runAllPromises(messagePromises),
        runAllPromises(
            filterMapIterable(parentMessageIndexes, parentMessageIndex => {
                if (messageIndexes.has(parentMessageIndex)) return null;

                return (async () => {
                    const messageItem = await ChatTable.getItem(context, {
                        partitionType: "Chat",
                        sortRangeType: "Messages",
                        chatId,
                        messageIndex: parentMessageIndex,
                    });
                    if (!messageItem) throw new InternalError("Parent message not found");

                    if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                    if (spaceId === null) spaceId = await spaceIdPromise;
                    return createChatMessageModelFromItem(context, spaceId, messageItem);
                })();
            }),
        ),
    ]);

    // We queried in descending order so put comments back in the right order.
    messages.reverse();
    otherReferencedMessages.reverse();

    return {
        messages,
        otherReferencedMessages,
    };
}

export type ChatMessageChangesResult =
    | {
          type: "Available";
          changes: Array<MessageChange>;
      }
    | {
          type: "Unavailable";
      };

/**
 * Backfills any missing messages or message updates for a client. The client
 * provides what it knows to be the message count and last change time then we
 * return any new messages or changes since then.
 *
 * We run this when the client establishes a new realtime connection to catch
 * the client up between their last data load and the time the realtime
 * connection was established.
 *
 * `newMessageLimit` allows you to load some new comments that the client
 * may be missing but only up to the limit.
 *
 * We do not keep a log of chat message changes around forever, so it's
 * possible that you get an `Unavailable` result for
 * `messageChangesResult`. When this happens you should throw away all data
 * your client has loaded and try loading the data again.
 */
export async function backfillChatMessages(
    context: RequestContext,
    {
        chatId,
        clientMessageCount,
        clientLastMessageChangeTime,
        newMessageLimit,
    }: {
        chatId: ChatId;
        clientMessageCount: number;
        clientLastMessageChangeTime: Date | null;
        newMessageLimit: number;
    },
): Promise<{
    messageCount: number;
    lastMessageChangeTime: Date | null;
    newMessages: Array<ChatMessageModel>;
    newOtherReferencedMessages: Array<ChatMessageModel>;
    messageChangesResult: ChatMessageChangesResult;
}> {
    const chatItemPromise = (async () => {
        const chatItem = await ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId,
        });
        if (!chatItem) throw new NotFoundError("Chat not found");
        return chatItem;
    })();

    const [chatItem, {messages, otherReferencedMessages}, messageChangesResult] =
        await runAllPromises([
            chatItemPromise,
            getChatMessagesFromStartAssumingAuthorizedChat(context, {
                chatId,
                getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
                limit: newMessageLimit,
                afterMessageIndex: clientMessageCount - 1,
                beforeMessageIndex: null,
            }),
            chatItemPromise.then(chatItem =>
                queryChatMessageChangeLogAssumingAuthorizedPost(context, {
                    chatItem,
                    lastMessageChangeTime: clientLastMessageChangeTime,
                }),
            ),
            chatItemPromise.then(chatItem => authorizeChatAccessWithItem(context, chatItem)),
        ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    const lastMessageChangeTime =
        messageChangesResult.type === "Available" && messageChangesResult.changes.length > 0
            ? getMessageChangeTime(
                  messageChangesResult.changes[messageChangesResult.changes.length - 1]!,
              )
            : null;

    return {
        messageCount: Math.max(
            chatItem.messagesSummary.messageCount,
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        lastMessageChangeTime:
            lastMessageChangeTime &&
            // Make sure `lastMessageChangeTime` is consistent with
            // `messageChangesResult` in case of eventual consistency race conditions.
            (!chatItem.messagesSummary.lastChangeTime ||
                lastMessageChangeTime > chatItem.messagesSummary.lastChangeTime)
                ? lastMessageChangeTime
                : chatItem.messagesSummary.lastChangeTime,
        newMessages: messages,
        newOtherReferencedMessages: otherReferencedMessages,
        messageChangesResult,
    };
}

async function queryChatMessageChangeLogAssumingAuthorizedPost(
    context: RequestContext,
    {
        chatItem,
        lastMessageChangeTime,
    }: {
        chatItem: ChatAttributesItem;
        lastMessageChangeTime: Date | null;
    },
): Promise<ChatMessageChangesResult> {
    // No changes occurred during the backfill period, there is nothing we need
    // to query.
    if (chatItem.messagesSummary.lastChangeTime?.getTime() === lastMessageChangeTime?.getTime())
        return {type: "Available", changes: []};

    const lastMessageChangeExpirationTime = getMessageChangeLogExpirationTimeFromChangeTime(
        lastMessageChangeTime ?? chatItem.createdTime,
    );

    // If our last change item has expired then other relevant changelog entries
    // may have also expired. The client will need to fully reset its state since
    // we don't have the data necessary to backfill.
    //
    // We subtract one day from the expiration time in this check in case our clock
    // disagrees with DynamoDB's time-to-live clock (clock skew). If our clock is
    // ahead and we believe an item exists that DynamoDB has in fact deleted that
    // would be sad. One day feels like sufficient clock skew buffer.
    if (lastMessageChangeExpirationTime.getTime() - 1000 * 60 * 60 * 24 < Date.now())
        return {type: "Unavailable"};

    const changes = await parallelMapAsyncIterableToArray(
        ChatTable.query(context, {
            partitionKey: {
                partitionType: "Chat",
                chatId: chatItem.chatId,
            },
            startSortKey: {
                sortRangeType: "MessageChangeLog",
                changeTime: new Date((lastMessageChangeTime ?? chatItem.createdTime).getTime() + 1),
            },
            endSortKey: {
                sortRangeType: "MessageChangeLog",
                changeTime: DynamoKeyAttributeSchema.date.maxValue,
            },
            limit: "All",
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.messageIndex,
                        content: {
                            doc: item.change.content,
                            references: await getContentReferencesFromNode(
                                context,
                                chatItem.spaceId,
                                item.change.content,
                            ),
                        },
                        contentUpdatedTime: item.changeTime,
                    };
                }
                case "Delete": {
                    return {
                        type: "Delete",
                        index: item.messageIndex,
                        deletedTime: item.changeTime,
                    };
                }
                default:
                    throw exhaustive(item.change);
            }
        },
    );

    return {type: "Available", changes};
}
