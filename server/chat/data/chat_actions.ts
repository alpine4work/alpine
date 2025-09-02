import murmurhash from "murmurhash";
import {
    AccountChatsIndex,
    ChatTable,
    InternalFileChatAuthorizer,
} from "~/server/chat/data/internal/chat_table.js";
import {getMessageContentReferencesForNode} from "~/server/content/get_content_references.js";
import {getMentionedAccountIdsInContent} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {dynamoClientRequestTokenMaxLength} from "~/server/dynamo/core/dynamo_max_client_request_token_length.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {hashMd5} from "~/server/helpers/node/hash_md5.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_table.js";
import {
    authorizeOwnAccountAccess,
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
    getAccount,
    isAccountMemberOfSpace,
} from "~/server/spaces/spaces_table.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {
    DataLossError,
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {asyncIterableFromIterable} from "~/shared/helpers/iterable/async_iterable_from_iterable.js";
import {parallelFilterMapLimitAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_filter_map_limit_async_iterable_to_array.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {Id, decodeIdInto, encodeId, generateId, isId} from "~/shared/id/id.js";
import {AccountId, ChatId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadClerical, MessagePayload} from "~/shared/messaging/message_model.js";
import {SearchAffinityEntityInteraction} from "~/shared/search/search_affinity_entity_interaction.js";

// Authorizers must be declared next to their respective Tables, so we must
// re-export from this accessible module.
export const FileChatAuthorizer = InternalFileChatAuthorizer;

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more methods here.
 */

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

/**
 * Scan every document and document comment in our database. Use when
 * migrating data.
 */
export async function* expensiveScanEveryChatAndChatMessageForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Chat"; spaceId: SpaceId; chatId: ChatId}
    | {
          type: "ChatMessage";
          getSpaceId: () => Promise<SpaceId>;
          chatId: ChatId;
          messageIndex: number;
      }
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    const spaceIdByChatId = new Map<ChatId, Promise<SpaceId>>();

    for await (const item of ChatTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Chat", sortRangeType: "Attributes"},
            {partitionType: "Chat", sortRangeType: "Messages"},
        ],
    })) {
        if (item.sortRangeType === "Attributes") {
            yield {type: "Chat", spaceId: item.spaceId, chatId: item.chatId};
        } else if (item.sortRangeType === "Messages") {
            yield {
                type: "ChatMessage",
                getSpaceId: () =>
                    getOrSetDefaultMapValue(spaceIdByChatId, item.chatId, async () => {
                        const chatItem = await ChatTable.getPartialItem(
                            context,
                            {
                                partitionType: "Chat",
                                sortRangeType: "Attributes",
                                chatId: item.chatId,
                            },
                            {attributes: ["spaceId"]},
                        );
                        return chatItem.spaceId;
                    }),
                chatId: item.chatId,
                messageIndex: item.messageIndex,
            };
        }
    }
}

export const sendChatMessageToAccountsBeforeCreateChatTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * Create a new chat with the provided accounts and no messages but only in
 * test environments. In the app we use `sendChatMessageToAccounts()` to create
 * chats.
 */
export async function createChatForTest(
    context: ServerSessionActionContext,
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
        new Set([...otherAccountIds, context.actor.getAccountId()]),
    ).sort();

    // Make sure all accounts are members of the space the chat is being
    // created in.
    await runAllPromises(accountIds.map(accountId => getAccount(context, spaceId, accountId)));

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
            accountIdsForOneOnOne: accountIds.length === 2 ? accountIds : null,
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
export function getOptimisticChatId(
    spaceId: SpaceId,
    accountIds: ReadonlyArray<AccountId>,
): ChatId {
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
    return encodeId<ChatId>(new Uint8Array(hashMd5(optimisticChatIdHashKey)));
}

/**
 * Gets the chat shared by the authorized account and the other provided
 * accounts and no one else. If an account does not exist yet for these
 * accounts then we will create one.
 *
 * This function is idempotent. You may call it multiple times in short
 * succession and get the same result.
 */
export async function getOrCreateChatForAccounts(
    context: ServerSessionActionContext,
    {
        spaceId,
        otherAccountIds,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
    },
): Promise<ChatId> {
    const {chatId} = await actuallyGetOrCreateChatForAccounts(context, {
        spaceId,
        actorAccountId: context.actor.getAccountId(),
        otherAccountIds,
        initialSharedChatsPromise: null,
    });

    return chatId;
}

/**
 * Called by the chat account picker component after the user has selected some
 * accounts to send a message to. Tells us what the shared chat between those
 * accounts is (and creates an empty chat for those accounts if one does not
 * exist). Also returns some suggested accounts we will show in the chat
 * account picker's autocomplete list.
 *
 * We only suggest chats that:
 *
 * - Have all the provided accounts
 * - Have at least one message
 *
 * This function is very influenced by the needs of the chat account picker
 * component. To understand it's implementation you need to understand that
 * component's UX.
 */
export function selectChatForAccounts(
    context: ServerSessionActionContext,
    {
        spaceId,
        otherAccountIds,
        messagesLimit,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
        messagesLimit: number;
    },
): Promise<{
    selectedChat: {
        chat: ChatModel;
        initialMessages: ReadonlyArray<ChatMessageModel>;
        initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    };
    suggestedChats: ReadonlyArray<ChatModel>;
}> {
    return context.tracer.withSpan("Select chat or suggest chats", async context => {
        // Make sure `otherAccountIds` is unique and doesn't include our
        // authenticated account.
        otherAccountIds = Array.from(new Set(otherAccountIds)).filter(
            accountId => accountId !== context.actor.getAccountId(),
        );

        const sharedChatsPromise = getSharedChats(context, {
            spaceId,
            actorAccountId: context.actor.getAccountId(),
            otherAccountIds,
        });

        const [selectedChat, suggestedChats] = await runAllPromises([
            (async () => {
                const result = await actuallyGetOrCreateChatForAccounts(context, {
                    spaceId,
                    actorAccountId: context.actor.getAccountId(),
                    otherAccountIds,
                    initialSharedChatsPromise: sharedChatsPromise,
                });

                return actuallyGetChatAndInitialMessages(context, {
                    result,
                    messagesLimit,
                });
            })(),
            (async () => {
                const sharedChats = await sharedChatsPromise;

                // Don't suggest chats if we are selecting the chat with ourself.
                if (otherAccountIds.length === 0) return [];

                // Limit the number of chats we return since we need to load the full chat
                // object. We sort shared chats by some heuristics to put more relevant chats
                // first but the heuristics don't consider user activity. Ideally we would also
                // sort with our affinity system. (I (@calebmer) have a rough idea of an
                // affinity system I'd like to build.)
                const suggestedChatLimit = 5;

                return parallelFilterMapLimitAsyncIterableToArray(
                    asyncIterableFromIterable(sharedChats),
                    suggestedChatLimit,
                    async sharedChat => {
                        // We only suggest chats with additional accounts on top of the ones
                        // we requested.
                        if (sharedChat.accountCount <= otherAccountIds.length + 1) return null;

                        const chat = await getChat(context, sharedChat.id);

                        // Only suggest chats with some messages.
                        if (chat.messageCount === 0) return null;

                        return chat;
                    },
                );
            })(),
        ]);

        return {selectedChat, suggestedChats};
    });
}

type ChatForAccountsResult =
    | {
          type: "FoundIdOnly";
          chatId: ChatId;
      }
    | {
          type: "FoundItems";
          chatId: ChatId;
          chatItem: ChatAttributesItem;
          chatAccountItems: Array<ChatAccountItem>;
      };

function actuallyGetOrCreateChatForAccounts(
    context: ServerActionContext,
    {
        spaceId,
        actorAccountId,
        otherAccountIds,
        initialSharedChatsPromise,
    }: {
        spaceId: SpaceId;
        actorAccountId: AccountId;
        otherAccountIds: ReadonlyArray<AccountId>;
        initialSharedChatsPromise: ReturnType<typeof getSharedChats> | null;
    },
): Promise<ChatForAccountsResult> {
    return context.tracer.withSpan("Get or create chat", async context => {
        // Make sure we're either a system actor or a session actor for this account.
        await authorizeOwnAccountAccess(context, actorAccountId);

        let hasAlreadyAttempted = false;

        return retryWithExponentialBackoff(async (retry): Promise<ChatForAccountsResult> => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            // Make sure `otherAccountIds` is unique and doesn't include our
            // authenticated account.
            otherAccountIds = Array.from(new Set(otherAccountIds)).filter(
                accountId => accountId !== actorAccountId,
            );

            const allSortedAccountIds = [...otherAccountIds, actorAccountId].sort();

            const getChatAndAccounts = async (
                chatId: ChatId,
            ): Promise<{
                chatItem: ChatAttributesItem;
                chatAccountItems: Array<ChatAccountItem>;
            } | null> => {
                const queryConsistency: DynamoReadConsistency = "Eventual";
                let chatItem: ChatAttributesItem | undefined;
                const chatAccountItems: Array<ChatAccountItem> = [];

                for await (const item of ChatTable.query(context, {
                    limit: "All",
                    consistency: queryConsistency,
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
                })) {
                    switch (item.sortRangeType) {
                        case "Attributes": {
                            assert(!chatItem);
                            chatItem = item;

                            // Once we've loaded the chat item, we can add it to our authorization cache so
                            // we don't need to make future network requests.
                            ChatItemAuthorizationCache.set(
                                context,
                                queryConsistency,
                                item.chatId,
                                item,
                            );
                            break;
                        }
                        case "Account": {
                            assert(chatItem);
                            chatAccountItems.push(item);

                            // Once we've loaded the chat account items, we can add it to our authorization
                            // cache so we don't need to make future network requests.
                            ChatAccountItemAuthorizationCache.set(
                                context,
                                queryConsistency,
                                `${item.chatId}:${item.accountId}`,
                                item,
                            );
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

            const createChatForAccounts = async (
                chatId: ChatId,
            ): Promise<ChatForAccountsResult> => {
                await sendChatMessageToAccountsBeforeCreateChatTestCheckpoint.waitForTest(
                    actorAccountId,
                );

                try {
                    const createdTime = new Date();

                    const chatItem: ChatAttributesItem = {
                        partitionType: "Chat",
                        sortRangeType: "Attributes",
                        chatId,
                        spaceId,
                        createdTime,
                        accountIdsForOneOnOne:
                            allSortedAccountIds.length === 2 ? allSortedAccountIds : null,
                        messagesSummary: {
                            nextMessageIndex: 0,
                            lastChangeTime: null,
                            messageCount: 0,
                        },
                    };

                    const chatAccountItems = Array.from(
                        allSortedAccountIds,
                        (accountId): ChatAccountItem => ({
                            partitionType: "Chat",
                            sortRangeType: "Account",
                            spaceId,
                            chatId,
                            accountId,
                            joinedTime: createdTime,
                            chatAccountCount: allSortedAccountIds.length,
                        }),
                    );

                    await DynamoTableSchema.executeTransaction(
                        context,
                        [
                            ChatTable.transactionCreateItem(chatItem),
                            ...chatAccountItems.map(chatAccountItem =>
                                ChatTable.transactionCreateOrReplaceItem(chatAccountItem),
                            ),
                        ],
                        {
                            // If two processes try to create a chat at the same time for the same
                            // accounts, we want to treat this transaction as idempotent.
                            //
                            // We need to hash the request token because DynamoDB imposes a maximum
                            // length on tokens.
                            clientRequestToken: `${spaceId}:${murmurhash
                                .v3(allSortedAccountIds.join("-"))
                                .toString(16)
                                .padStart(8, "0")}`,
                        },
                    );

                    // NOTE(calebmer): We don't send an `IndexSearchEntity` job for chats until the
                    // first message is sent to that chat.

                    return {
                        type: "FoundItems",
                        chatId: chatItem.chatId,
                        chatItem,
                        chatAccountItems,
                    };
                } catch (error) {
                    // If we have a race condition where some other process created this chat
                    // before us then retry our action. Retrying should load the chat created by
                    // the other process.
                    if (
                        isDynamoConditionCheckError(error) ||
                        isDynamoIdempotentParameterMismatchError(error)
                    ) {
                        retry(error);
                    }

                    throw error;
                }
            };

            const [{optimisticChatId, optimisticChatAndAccounts}] = await runAllPromises([
                (async () => {
                    const optimisticChatId = getOptimisticChatId(spaceId, allSortedAccountIds);
                    const optimisticChatAndAccounts = await getChatAndAccounts(optimisticChatId);
                    return {optimisticChatId, optimisticChatAndAccounts};
                })(),

                // Make sure the authenticated account has access to the space.
                authorizeSpaceAccess(context, spaceId),

                // Make sure all accounts we are sending a message to are a part of the
                // provided space.
                runAllPromises(
                    Array.from(otherAccountIds, accountId =>
                        getAccount(context, spaceId, accountId),
                    ),
                ),
            ]);

            // If the optimistic `ChatId` does not exist then create a new chat with the
            // optimistic `ChatId` and send a message there.
            if (!optimisticChatAndAccounts) {
                return createChatForAccounts(optimisticChatId);
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
                return {
                    type: "FoundItems",
                    chatId: optimisticChatAndAccounts.chatItem.chatId,
                    ...optimisticChatAndAccounts,
                };
            }

            const sharedChats = await ((isInitialAttempt ? initialSharedChatsPromise : null) ??
                getSharedChats(context, {spaceId, actorAccountId, otherAccountIds}));

            const firstSharedChat = sharedChats[0];

            // We found a chat that exactly matches the accounts we want to message! Send a
            // message to that chat.
            if (firstSharedChat?.accountCount === otherAccountIds.length + 1) {
                return {
                    type: "FoundIdOnly",
                    chatId: firstSharedChat.id,
                };
            }

            return createChatForAccounts(generateId());
        });
    });
}

/**
 * Send a message to to the provided chat.
 */
export function sendChatMessage(
    context: ServerSessionActionContext,
    {
        chatId,
        parentMessageIndex,
        content,
        fileIds,
    }: {
        chatId: ChatId;
        parentMessageIndex: number | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    },
): Promise<{
    spaceId: SpaceId;
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    return sendChatMessageForAccount(context, {
        chatId,
        authorId: context.actor.getAccountId(),
        parentMessageIndex,
        content,
        fileIds,
    });
}

// IMPORTANT: Don't export this function! It allows our system actor to
// impersonate a user and send a message on their behalf. Only write code to
// send chat messages on behalf of another account in this file.
function sendChatMessageForAccount(
    context: ServerActionContext,
    {
        chatId,
        authorId,
        parentMessageIndex,
        content,
        fileIds,
        clerical,
        clientRequestToken,
    }: {
        chatId: ChatId;
        authorId: AccountId;
        parentMessageIndex: number | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        clerical?: MessageContentPayloadClerical;
        clientRequestToken?: string;
    },
): Promise<{
    spaceId: SpaceId;
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        // Make sure we're either a system actor or a session actor for this account.
        await authorizeOwnAccountAccess(context, authorId);

        const [{chatItem, chatAccountItem}] = await runAllPromises([
            (async () => {
                const result = await authorizeChatAccessForAccountAndReturnItems(
                    context,
                    chatId,
                    authorId,
                );

                // Make sure all the provided files exist.
                await runAllPromises(
                    fileIds.map(fileId =>
                        isId<FileId>(fileId)
                            ? getFileFromAttachment(
                                  context,
                                  result.chatItem.spaceId,
                                  fileId,
                                  FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
                              )
                            : null,
                    ),
                );

                return result;
            })(),
            (async () => {
                if (typeof parentMessageIndex !== "number") return;

                const parentMessageItem = await ChatTable.getPartialItemIfExists(
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
            })(),
        ]);

        if (clerical && context.actor.type !== "System")
            throw new PermissionDeniedError("Only system actors can send clerical messages");

        const messageIndex = chatItem.messagesSummary.nextMessageIndex;
        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock
        // `Date.now()` and override the time that is returned.
        const createdTime = new Date(Date.now());

        await DynamoTableSchema.executeTransaction(
            context,
            [
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
                        fileIds,
                        clerical,
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
            ],
            {clientRequestToken},
        );

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);
        const contentSnippet = getNotificationMessageContentSnippet(content);

        context.jobs.send({
            type: "NotificationEvent",
            event: {
                type: "CreateChatMessage",
                id: generateChronologicalId(),
                spaceId: chatItem.spaceId,
                chatId,
                messageIndex,
                createdTime,
                authorId,
                mentionedAccountIds,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
                clerical,
            },
        });

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: chatItem.spaceId,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex,
                // Nothing depends on this entity when it's created. Don't bother trying to
                // reindex dependencies.
                updatedTraits: {type: "None"},
            },
        });

        // We don't index a chat for search until the first message is sent to
        // the chat.
        if (messageIndex === 0) {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId: chatItem.spaceId,
                update: {
                    type: "Chat",
                    chatId,
                    updatedTraits: {type: "Any"},
                },
            });
        }

        // Only increase affinity score if we have a session actor. Don't increase
        // affinity score if this is a system actor sending a message on behalf of an
        // account.
        if (context.actor.type === "Session") {
            const sessionContext = context.actor.authorizeSession();

            // Add affinity points to chat. Unless this is a 1:1 chat. For 1:1 chats we
            // want to add affinity points to the account we're messaging. That way we
            // build affinity with the account directly.
            context.process.waitUntil(async () => {
                // Small messages are considered low intent updates. This defends against
                // spamming where a user is sending small one word messages to make a point.
                const interaction: SearchAffinityEntityInteraction =
                    content.nodeSize < 50
                        ? {type: "LowIntentUpdate"}
                        : {type: "MediumIntentUpdate"};

                if (chatAccountItem.chatAccountCount !== 2) {
                    await markSearchAffinityEntityInteraction(sessionContext, {
                        spaceId: chatItem.spaceId,
                        entityId: `Chat:${chatItem.chatId}`,
                        interaction,
                    });
                } else {
                    const chatAccountIds =
                        // If `accountIdsForOneOnOne` is available we can use it, otherwise we need to
                        // query chat accounts to get our partner's `AccountId`.
                        chatItem.accountIdsForOneOnOne ??
                        (
                            await arrayFromAsyncIterable(
                                ChatTable.query(context, {
                                    partitionKey: {
                                        partitionType: "Chat",
                                        chatId,
                                    },
                                    startSortKey: {
                                        sortRangeType: "Account",
                                        accountId:
                                            DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
                                    },
                                    endSortKey: {
                                        sortRangeType: "Account",
                                        accountId:
                                            DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
                                    },
                                    limit: "All",
                                }),
                            )
                        ).map(({accountId}) => accountId);

                    const otherChatAccountIds = chatAccountIds.filter(
                        chatAccountId => chatAccountId !== sessionContext.actor.getAccountId(),
                    );

                    await markSearchAffinityEntityInteraction(sessionContext, {
                        spaceId: chatItem.spaceId,
                        entityId: `Account:${assertExists(otherChatAccountIds[0])}`,
                        interaction,
                    });
                }
            });

            // Increase affinity points for all mentioned accounts with a high intent
            // update since the user clearly wants the attention of the mentioned accounts.
            //
            // (If a mentioned account doesn't have access to this message should that
            // still be a high intent update? For now we say yes since the user is
            // explicitly choosing to reference them.)
            for (const mentionedAccountId of mentionedAccountIds) {
                context.process.waitUntil(async () => {
                    if (
                        await isAccountMemberOfSpace(context, chatItem.spaceId, mentionedAccountId)
                    ) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId: chatItem.spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });
                    }
                });
            }
        }

        return {
            spaceId: chatItem.spaceId,
            chatId,
            index: messageIndex,
            createdTime,
        };
    });
}

const ChatItemAuthorizationCache = new DynamoContextCache<ChatId, ChatAttributesItem | null>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getChatItemIfExistsForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<ChatAttributesItem | null> {
    return ChatItemAuthorizationCache.get(context, consistency, chatId, consistency =>
        ChatTable.getItemIfExists(
            context,
            {
                partitionType: "Chat",
                sortRangeType: "Attributes",
                chatId,
            },
            {consistency},
        ),
    );
}

async function getChatItemForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatAttributesItem> {
    const chatItem = await getChatItemIfExistsForAuthorization(context, chatId, options);
    if (!chatItem) throw createChatNotFoundError(chatId);
    return chatItem;
}

const ChatAccountItemAuthorizationCache = new DynamoContextCache<
    `${ChatId}:${AccountId}`,
    ChatAccountItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getChatAccountItemIfExistsForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<ChatAccountItem | null> {
    return ChatAccountItemAuthorizationCache.get(
        context,
        consistency,
        `${chatId}:${accountId}`,
        consistency =>
            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Account",
                    chatId,
                    accountId,
                },
                {consistency},
            ),
    );
}

export function createChatNotFoundError(chatId: ChatId) {
    return new NotFoundError("Chat not found", {
        aggregateDedupeKey: chatId,
        displayMessage: errorDisplayMessage`This chat doesn’t exist. Try searching “my chats” to see chats you’re in.`,
    });
}

/**
 * Authorize that the current account is allowed to access the chat.
 *
 * Cached at the action level so multiple requests with the same `ChatId` in
 * the same action will only load data from the database once.
 */
export async function authorizeChatAccess(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId}> {
    const {spaceId} = await authorizeChatAccessAndReturnItem(context, chatId, options);
    return {spaceId};
}

/**
 * Authorize that the current account is allowed to access the chat. Returns a
 * result if authorization fails instead of throwing.
 *
 * Cached at the action level so multiple requests with the same `ChatId` in
 * the same action will only load data from the database once.
 */
export async function authorizeChatAccessIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId}, ErrorBase>> {
    const result = await authorizeChatAccessAndReturnItemIfPossible(context, chatId, options);
    if (!result.ok) return result;
    return {ok: true, value: {spaceId: result.value.spaceId}};
}

async function authorizeChatAccessAndReturnItem(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatAttributesItem> {
    return unwrapResult(await authorizeChatAccessAndReturnItemIfPossible(context, chatId, options));
}

async function authorizeChatAccessAndReturnItemIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<ChatAttributesItem, ErrorBase>> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            const chatItemResult = await authorizeChatAccessForAccountAndReturnItemsIfPossible(
                context,
                chatId,
                context.actor.getAccountId(),
                options,
            );
            if (!chatItemResult.ok) return chatItemResult;
            return {ok: true, value: chatItemResult.value.chatItem};
        }

        // If we have access to the space, we have access to the chat...
        case "System": {
            const chatItem = await getChatItemForAuthorization(context, chatId, options);
            const result = await authorizeSpaceAccessIfPossible(context, chatItem.spaceId);
            if (!result.ok) return result;
            return {ok: true, value: chatItem};
        }

        case "Anonymous": {
            return {ok: false, error: unauthenticatedSessionError()};
        }

        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Authorizes that the provided account has access to the chat.
 *
 * If this is a session context, we also check that our session's account has
 * access to the chat.
 *
 * Returns some data related to the chat that exists on the item's we
 * query for.
 */
export async function authorizeChatAccessForAccount(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; chatAccountCount: number}> {
    const {
        chatItem: {spaceId},
        chatAccountItem: {chatAccountCount},
    } = await authorizeChatAccessForAccountAndReturnItems(context, chatId, accountId, options);

    return {spaceId, chatAccountCount};
}

async function authorizeChatAccessForAccountAndReturnItems(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{chatItem: ChatAttributesItem; chatAccountItem: ChatAccountItem}> {
    return unwrapResult(
        await authorizeChatAccessForAccountAndReturnItemsIfPossible(
            context,
            chatId,
            accountId,
            options,
        ),
    );
}

async function authorizeChatAccessForAccountAndReturnItemsIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{chatItem: ChatAttributesItem; chatAccountItem: ChatAccountItem}, ErrorBase>> {
    const [chatItemResult, chatAccountItem, actorChatAccountItem] = await runAllPromises([
        getChatItemForAuthorization(context, chatId, options).then(
            async (chatItem): Promise<Result<ChatAttributesItem, ErrorBase>> => {
                const result = await authorizeSpaceAccessIfPossible(context, chatItem.spaceId);
                if (!result.ok) return result;
                return {ok: true, value: chatItem};
            },
        ),
        getChatAccountItemIfExistsForAuthorization(context, chatId, accountId, options),
        (async (): Promise<"Ignored" | "Unauthenticated" | ChatAccountItem | null> => {
            switch (context.actor.type) {
                case "Session":
                case "ImpersonatedAccount": {
                    // We already are loading our session's chat account item above.
                    if (context.actor.getAccountId() === accountId) return "Ignored";

                    return getChatAccountItemIfExistsForAuthorization(
                        context,
                        chatId,
                        context.actor.getAccountId(),
                        options,
                    );
                }
                case "System": {
                    // If we have access to the space (authorized above), we have access to
                    // the chat...
                    return "Ignored";
                }
                case "Anonymous": {
                    // We don't need to return an `unauthenticatedSessionError()` error here since
                    // `authorizeSpaceAccessIfPossible()` above will error for anonymous actors.
                    return "Ignored";
                }
                default:
                    throw exhaustive(context.actor);
            }
        })(),
    ]);

    if (!chatItemResult.ok) return chatItemResult;
    const chatItem = chatItemResult.value;

    if (!actorChatAccountItem) {
        return {
            ok: false,
            error: new PermissionDeniedError("Session actor account doesn’t have access to chat"),
        };
    }

    if (!chatAccountItem) {
        return {ok: false, error: new PermissionDeniedError("Account doesn’t have access to chat")};
    }

    return {ok: true, value: {chatItem, chatAccountItem}};
}

/**
 * Get chats shared between the authenticated account and provided accounts in
 * the provided space.
 *
 * Sorts chats with fewer accounts first. So if a chat that exclusively contains
 * the provided accounts and authenticated account will be first.
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
function getSharedChats(
    context: ServerActionContext,
    {
        spaceId,
        actorAccountId,
        otherAccountIds,
    }: {
        spaceId: SpaceId;
        actorAccountId: AccountId;
        otherAccountIds: ReadonlyArray<AccountId>;
    },
): Promise<
    Array<{
        id: ChatId;
        accountCount: number;
    }>
> {
    return context.tracer.withSpan("Get shared chats", async context => {
        // Make sure we're either a system actor or a session actor for this account.
        await authorizeOwnAccountAccess(context, actorAccountId);

        // Make sure `otherAccountIds` is unique and doesn't include our
        // authenticated account.
        otherAccountIds = Array.from(new Set(otherAccountIds)).filter(
            accountId => accountId !== actorAccountId,
        );

        const chatById = new Map<
            ChatId,
            {accountCount: number; includedAccountIds: Set<AccountId>}
        >();

        await runAllPromiseThunks(
            async () => {
                const ourAccountChats = await arrayFromAsyncIterable(
                    AccountChatsIndex.query(context, {
                        partitionKey: {spaceId, accountId: actorAccountId},
                        limit: "All",
                    }),
                );

                for (const accountChat of ourAccountChats) {
                    const chat = getOrSetDefaultMapValue(chatById, accountChat.chatId, () => ({
                        accountCount: accountChat.chatAccountCount,
                        includedAccountIds: new Set<AccountId>(),
                    }));

                    chat.includedAccountIds.add(actorAccountId);
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

        const chats: Array<{id: ChatId; accountCount: number}> = [];

        for (const [chatId, chat] of chatById) {
            // Only include accounts with every requested account and the
            // authenticated account.
            if (!chat.includedAccountIds.has(actorAccountId)) continue;
            if (!otherAccountIds.every(accountId => chat.includedAccountIds.has(accountId)))
                continue;

            chats.push({id: chatId, accountCount: chat.accountCount});
        }

        return chats.sort(
            (chat1, chat2) =>
                // Put chats with fewer accounts first.
                chat1.accountCount - chat2.accountCount ||
                // Tiebreak with chat IDs for a deterministic order.
                defaultCompareStrings(chat1.id, chat2.id),
        );
    });
}

/**
 * Allow tests to call the `getSharedChats()` from a test.
 */
export function getSharedChatsForTest(
    context: ServerSessionActionContext,
    {
        spaceId,
        otherAccountIds,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
    },
) {
    assert(process.env.NODE_ENV === "test");

    return getSharedChats(context, {
        spaceId,
        actorAccountId: context.actor.getAccountId(),
        otherAccountIds,
    });
}

/**
 * Get the provided chat by `ChatId`.
 */
export async function getChat(context: ServerActionContext, chatId: ChatId): Promise<ChatModel> {
    const queryConsistency: DynamoReadConsistency = "Eventual";
    let chatItem: ChatAttributesItem | undefined;
    const chatAccountItems: Array<ChatAccountItem> = [];

    for await (const item of ChatTable.query(context, {
        limit: "All",
        consistency: queryConsistency,
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
    })) {
        switch (item.sortRangeType) {
            case "Attributes": {
                assert(!chatItem);
                chatItem = item;

                // Once we've loaded the chat item, we can add it to our authorization cache so
                // we don't need to make future network requests.
                ChatItemAuthorizationCache.set(context, queryConsistency, item.chatId, item);
                break;
            }
            case "Account": {
                assert(chatItem);
                chatAccountItems.push(item);

                // Once we've loaded the chat account items, we can add it to our authorization
                // cache so we don't need to make future network requests.
                ChatAccountItemAuthorizationCache.set(
                    context,
                    queryConsistency,
                    `${item.chatId}:${item.accountId}`,
                    item,
                );
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (!chatItem) throw createChatNotFoundError(chatId);

    return createChatModelFromItems(context, chatItem, chatAccountItems);
}

async function createChatModelFromItems(
    context: ServerActionContext,
    chatItem: ChatAttributesItem,
    chatAccountItems: ReadonlyArray<ChatAccountItem>,
): Promise<ChatModel> {
    const [accounts] = await runAllPromises([
        runAllPromises(
            chatAccountItems.map(chatAccountItem => {
                if (chatAccountItem.spaceId !== chatItem.spaceId)
                    throw new DataLossError(
                        "Expected chat account item to have same `SpaceId` as chat item",
                    );

                return getAccount(context, chatItem.spaceId, chatAccountItem.accountId);
            }),
        ),
        authorizeSpaceAccess(context, chatItem.spaceId),
    ]);

    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            const sessionAccountId = context.actor.getAccountId();
            if (!accounts.some(account => account.id === sessionAccountId))
                throw new PermissionDeniedError("Account doesn’t have access to chat");
            break;
        }
        case "System":
        case "Anonymous": {
            // Already authenticated these with `authorizeSpaceAccess()`.
            break;
        }
        default:
            throw exhaustive(context.actor);
    }

    return new ChatModel({
        id: chatItem.chatId,
        spaceId: chatItem.spaceId,
        createdTime: chatItem.createdTime,
        messageCount: chatItem.messagesSummary.messageCount,
        lastMessageChangeTime: chatItem.messagesSummary.lastChangeTime,
        // NOTE(calebmer): Ideally we sort chat accounts by some kind of affinity to
        // the current account? That seems like a good default.
        accounts: accounts
            .slice()
            .sort((account1, account2) =>
                account1.initialData.name.localeCompare(account2.initialData.name),
            ),
    });
}

/**
 * Get the provided `AccountId` members of a chat.
 */
export async function getChatAccountIds(
    context: ServerActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    createdTime: Date;
    spaceId: SpaceId;
    hasMessages: boolean;
    accountIds: ReadonlyArray<AccountId>;
}> {
    let chatItem: ChatAttributesItem | undefined;
    const accountIds: Array<AccountId> = [];

    for await (const item of ChatTable.query(context, {
        limit: "All",
        consistency,
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
    })) {
        switch (item.sortRangeType) {
            case "Attributes": {
                assert(!chatItem);
                chatItem = item;

                // Once we've loaded the chat item, we can add it to our authorization cache so
                // we don't need to make future network requests.
                ChatItemAuthorizationCache.set(context, consistency, item.chatId, item);
                break;
            }
            case "Account": {
                assert(chatItem);

                if (item.spaceId !== chatItem.spaceId)
                    throw new DataLossError(
                        "Expected chat account item to have same `SpaceId` as chat item",
                    );

                accountIds.push(item.accountId);

                // Once we've loaded the chat account items, we can add it to our authorization
                // cache so we don't need to make future network requests.
                ChatAccountItemAuthorizationCache.set(
                    context,
                    consistency,
                    `${item.chatId}:${item.accountId}`,
                    item,
                );
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (!chatItem) throw createChatNotFoundError(chatId);

    await authorizeSpaceAccess(context, chatItem.spaceId);

    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            const sessionAccountId = context.actor.getAccountId();
            if (!accountIds.some(accountId => accountId === sessionAccountId))
                throw new PermissionDeniedError("Account doesn’t have access to chat");
            break;
        }
        case "System":
        case "Anonymous": {
            // Already authenticated these with `authorizeSpaceAccess()`.
            break;
        }
        default:
            throw exhaustive(context.actor);
    }

    return {
        createdTime: chatItem.createdTime,
        spaceId: chatItem.spaceId,
        hasMessages: chatItem.messagesSummary.messageCount > 0,
        accountIds,
    };
}

/**
 * Get a single chat message comment.
 */
export async function getChatMessage(
    context: ServerActionContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<ChatMessageModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId),
        ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Messages",
            chatId,
            messageIndex,
        }),
    ]);

    return createChatMessageModelFromItem(context, spaceId, item);
}

/**
 * Get a single chat message comment's payload.
 */
export async function getChatMessagePayload(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        consistency = "Eventual",
    }: {
        chatId: ChatId;
        messageIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    createdTime: Date;
    authorId: AccountId;
    payload: MessagePayload;
}> {
    const [, item] = await runAllPromises([
        authorizeChatAccess(context, chatId, {consistency}),
        ChatTable.getItem(
            context,
            {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            },
            {consistency},
        ),
    ]);

    return {
        createdTime: item.createdTime,
        authorId: item.authorId,
        payload: item.payload,
    };
}

async function createChatMessageModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    item: ChatMessageItem,
): Promise<ChatMessageModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId: item.chatId}),
            item.payload,
        ),
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
    context: ServerSessionActionContext,
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
    return context.dynamo.retryTransaction(async context => {
        const [chatItem, chatMessageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId),
            ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            }),
        ]);

        if (chatMessageItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update chat messages you authored");

        if (chatMessageItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not chat messages with a non-content payload");

        if (chatMessageItem.payload.clerical)
            throw new FailedPreconditionError("Can’t update clerical message content");

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

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: chatItem.spaceId,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {contentUpdatedTime};
    });
}

/**
 * Delete a single chat message.
 */
export function deleteChatMessage(
    context: ServerSessionActionContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<{deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [chatItem, chatMessageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId),
            ChatTable.getItemIfExists(context, {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            }),
        ]);

        if (!chatMessageItem) throw new NotFoundError("Chat message not found");

        if (chatMessageItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only delete messages you authored");

        if (chatMessageItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can’t delete messages with a non-content payload");

        if (chatMessageItem.payload.clerical)
            throw new FailedPreconditionError("Can’t delete clerical messages");

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

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: chatItem.spaceId,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {deletedTime};
    });
}

/**
 * Get our chat and initial messages that come with it efficiently at once.
 */
export function getChatAndInitialMessages(
    context: ServerSessionActionContext,
    {
        chatId,
        messagesLimit,
        onChat,
    }: {
        chatId: ChatId;
        messagesLimit: number;
        onChat?: (chat: ChatModel) => void;
    },
): Promise<{
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> {
    return actuallyGetChatAndInitialMessages(context, {
        result: {type: "FoundIdOnly", chatId},
        messagesLimit,
        onChat,
    });
}

async function actuallyGetChatAndInitialMessages(
    context: ServerSessionActionContext,
    {
        result,
        messagesLimit,
        onChat,
    }: {
        result: ChatForAccountsResult;
        messagesLimit: number;
        onChat?: (chat: ChatModel) => void;
    },
): Promise<{
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> {
    let chatPromise: Promise<ChatModel>;
    switch (result.type) {
        case "FoundIdOnly": {
            chatPromise = getChat(context, result.chatId);
            break;
        }
        case "FoundItems": {
            chatPromise = createChatModelFromItems(
                context,
                result.chatItem,
                result.chatAccountItems,
            );
            break;
        }
        default:
            throw exhaustive(result);
    }

    const [chat, {messages, otherReferencedMessages}] = await runAllPromises([
        chatPromise.then(chat => {
            onChat?.(chat);
            return chat;
        }),
        getChatMessagesFromEndAssumingAuthorizedChat(context, {
            chatId: result.chatId,
            getSpaceId: () => chatPromise.then(({spaceId}) => spaceId),
            limit: messagesLimit,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        chat: chat.clone({
            messageCount: Math.max(
                chat.messageCount,
                // Make sure `messageCount` is consistent with `messages` in case of eventual
                // consistency race conditions.
                lastMessageIndex + 1,
            ),
        }),
        initialMessages: messages,
        initialOtherReferencedMessages: otherReferencedMessages,
    };
}

/**
 * Paginate through chat messages from start to finish.
 */
export async function getChatMessagesFromStart(
    context: ServerSessionActionContext,
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
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId);

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        getChatMessagesFromStartAssumingAuthorizedChat(context, {
            chatId,
            getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        }),
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
    context: ServerActionContext,
    {
        chatId,
        getSpaceId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
        consistency = "Eventual",
    }: {
        chatId: ChatId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    if (limit === 0) return {messages: [], otherReferencedMessages: []};

    const messageItems = await arrayFromAsyncIterable(
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
            consistency,
        }),
    );

    if (messageItems.length === 0) return {messages: [], otherReferencedMessages: []};

    const startMessageIndex = messageItems[0]!.messageIndex;
    const endMessageIndex = messageItems[messageItems.length - 1]!.messageIndex;

    const spaceId = await getSpaceId();

    let otherReferencedMessagePromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedMessages: Array<ChatMessageModel> = [];

    const loadOtherReferencedMessage = (messageIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startMessageIndex <= messageIndex && messageIndex <= endMessageIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedMessagePromiseByIndex,
            messageIndex,
            async () => {
                const item = await ChatTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Chat",
                        sortRangeType: "Messages",
                        chatId,
                        messageIndex,
                    },
                    {consistency},
                );
                if (!item) throw new InternalError("Parent message not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedMessage(item.payload.parentMessageIndex);
                }

                otherReferencedMessages.push(
                    await createChatMessageModelFromItem(context, spaceId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const messages = await runAllPromises(
        messageItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedMessage(item.payload.parentMessageIndex);
            }

            // Don't propagate `consistency` when loading model references. We
            // accept references can have eventual consistency.
            return createChatMessageModelFromItem(context, spaceId, item);
        }),
    );

    // Keep loading other referenced messages until we have all of them. A
    // referenced message may itself reference more messages.
    while (otherReferencedMessagePromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedMessagePromiseByIndex.values());
        otherReferencedMessagePromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        messages,
        otherReferencedMessages: otherReferencedMessages.sort(
            (message1, message2) => message1.index - message2.index,
        ),
    };
}

/**
 * Paginate through chat messages from finish to start.
 */
export async function getChatMessagesFromEnd(
    context: ServerSessionActionContext,
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
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId);

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        getChatMessagesFromEndAssumingAuthorizedChat(context, {
            chatId,
            getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        }),
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

async function getChatMessagesFromEndAssumingAuthorizedChat(
    context: ServerActionContext,
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
    if (limit === 0) return {messages: [], otherReferencedMessages: []};

    const messageItems = await arrayFromAsyncIterable(
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
    );

    if (messageItems.length === 0) return {messages: [], otherReferencedMessages: []};

    const endMessageIndex = messageItems[0]!.messageIndex;
    const startMessageIndex = messageItems[messageItems.length - 1]!.messageIndex;

    const spaceId = await getSpaceId();

    let otherReferencedMessagePromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedMessages: Array<ChatMessageModel> = [];

    const loadOtherReferencedMessage = (messageIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startMessageIndex <= messageIndex && messageIndex <= endMessageIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedMessagePromiseByIndex,
            messageIndex,
            async () => {
                const item = await ChatTable.getItemIfExists(context, {
                    partitionType: "Chat",
                    sortRangeType: "Messages",
                    chatId,
                    messageIndex,
                });
                if (!item) throw new InternalError("Parent message not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedMessage(item.payload.parentMessageIndex);
                }

                otherReferencedMessages.push(
                    await createChatMessageModelFromItem(context, spaceId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const messages = await runAllPromises(
        messageItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedMessage(item.payload.parentMessageIndex);
            }
            return createChatMessageModelFromItem(context, spaceId, item);
        }),
    );

    // Keep loading other referenced messages until we have all of them. A
    // referenced message may itself reference more messages.
    while (otherReferencedMessagePromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedMessagePromiseByIndex.values());
        otherReferencedMessagePromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    // We queried in descending order so put comments back in the right order.
    messages.reverse();

    return {
        messages,
        otherReferencedMessages: otherReferencedMessages.sort(
            (message1, message2) => message1.index - message2.index,
        ),
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
    context: ServerSessionActionContext,
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
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId);

    const [chatItem, {messages, otherReferencedMessages}, messageChangesResult] =
        await runAllPromises([
            chatItemPromise,
            getChatMessagesFromStartAssumingAuthorizedChat(context, {
                chatId,
                getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
                limit: newMessageLimit,
                afterMessageIndex: clientMessageCount - 1,
                beforeMessageIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
            chatItemPromise.then(chatItem =>
                queryChatMessageChangeLogAssumingAuthorizedPost(context, {
                    chatItem,
                    lastMessageChangeTime: clientLastMessageChangeTime,
                    // Use a strong read consistency when backfilling. This guarantees the caller
                    // will observe all realtime events before this function call. Realtime events
                    // that happen during the function call may be missed. You should be subscribed
                    // to new realtime events before starting to backfill.
                    consistency: "Strong",
                }),
            ),
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
    context: ServerActionContext,
    {
        chatItem,
        lastMessageChangeTime,
        consistency = "Eventual",
    }: {
        chatItem: ChatAttributesItem;
        lastMessageChangeTime: Date | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<ChatMessageChangesResult> {
    // No changes occurred during the backfill period, there is nothing we need
    // to query.
    if (chatItem.messagesSummary.lastChangeTime?.getTime() === lastMessageChangeTime?.getTime())
        return {type: "Available", changes: []};

    const lastMessageChangeExpirationTime = getMessageChangeLogExpirationTimeFromChangeTime(
        lastMessageChangeTime ?? chatItem.createdTime,
    );

    // If our last change item may have expired then other relevant changelog entries
    // may have also expired. The client will need to fully reset its state since
    // we don't have the data necessary to backfill.
    if (
        isDatePossiblyLessThanWithUncertaintyWindow(
            lastMessageChangeExpirationTime,
            // Use `Date.now()` so tests can mock the `Date.now()` function.
            new Date(Date.now()),
        )
    ) {
        return {type: "Unavailable"};
    }

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
            consistency,
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.messageIndex,
                        content: {
                            doc: item.change.content,
                            // Don't propagate `consistency` when loading content references. We
                            // accept references can have eventual consistency.
                            references: await getMessageContentReferencesForNode(
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

/**
 * When the user shares an `AccessPolicy` with individual users and selects
 * "Notify people" then this job will be added to the queue.
 */
export async function processSendShareNotificationJob(
    context: ServerSystemActionContext,
    {
        jobId,
        spaceId,
        actorAccountId,
        entityId,
        notification,
    }: {
        jobId: Id;
        spaceId: SpaceId;
        actorAccountId: AccountId;
        entityId: FileEntityId;
        notification: ShareNotification;
    },
) {
    await runAllPromises(
        notification.accountIds.map(async otherAccountId => {
            if (otherAccountId === actorAccountId) return;

            const {chatId} = await actuallyGetOrCreateChatForAccounts(context, {
                spaceId,
                actorAccountId,
                otherAccountIds: [otherAccountId],
                initialSharedChatsPromise: null,
            });

            try {
                const clientRequestTokenIdLength = Math.floor(
                    (dynamoClientRequestTokenMaxLength - 1) / 2,
                );

                await sendChatMessageForAccount(context, {
                    chatId,
                    authorId: actorAccountId,
                    parentMessageIndex: null,
                    content: notification.content,
                    fileIds: [entityId],
                    clerical: {
                        type: "ShareNotification",
                        entityType: parseFileEntityId(entityId).type,
                    },
                    clientRequestToken: [
                        jobId.slice(0, clientRequestTokenIdLength),
                        otherAccountId.slice(0, clientRequestTokenIdLength),
                    ].join("-"),
                });
            } catch (error) {
                // SQS may retry this job. If so, don't send a message to the same
                // account twice.
                if (isDynamoIdempotentParameterMismatchError(error)) return;

                throw error;
            }
        }),
    );
}
