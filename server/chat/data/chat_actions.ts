import {addDays} from "date-fns";
import murmurhash from "murmurhash";
import {Step} from "prosemirror-transform";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {
    AccountChatsIndex,
    ChatTable,
    InternalFileChatAuthorizer,
} from "~/server/chat/data/internal/chat_table.js";
import {getMentionedAccountIdsInContent} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {
    ServerMinimalActionContext,
    ServerMinimalBotActionContext,
} from "~/server/context/server_minimal_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
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
import {computeUpdateMessageContent} from "~/server/messaging/helpers/compute_update_message_content.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {
    createCantCompleteStaleMessageStreamError,
    createCantPingCompletedMessageStreamError,
    createCantPingStaleMessageStreamError,
    createCantWriteToStaleMessageStreamError,
} from "~/server/messaging/helpers/create_message_stream_errors.js";
import {
    messageStreamIndexSearchEntityDelaySeconds,
    shouldScheduleMessageStreamIndexSearchEntityJob,
} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {hasMessageStreamDefinitelyTimedOut} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {
    messagingEventExpirationDays,
    runBackfillMessageUpdates,
} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {runMessagesQuery} from "~/server/messaging/helpers/run_messages_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {AccessPolicyWithoutGenerations} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {
    createChatMessageNotFoundError,
    createChatNotFoundError,
} from "~/shared/chat/chat_error_messages.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {
    DataLossError,
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
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
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {asyncIterableFromIterable} from "~/shared/helpers/iterable/async_iterable_from_iterable.js";
import {parallelFilterMapLimitAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_filter_map_limit_async_iterable_to_array.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {Id, decodeIdInto, encodeId, generateId, isId} from "~/shared/id/id.js";
import {AccountId, ChatId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";
import {computeSetMessageReaction} from "~/shared/messaging/compute_set_message_reaction.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    MessageContentPayloadClerical,
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
    MessageStreamPartPayload,
    iterateMessageContentPayloadParentIndexes,
} from "~/shared/messaging/message_schema.js";
import {
    MessageUpdatesBackfillResult,
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {SearchAffinityEntityInteraction} from "~/shared/search/search_affinity_entity_interaction.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

// Authorizers must be declared next to their respective Tables, so we must
// re-export from this accessible module.
export const FileChatAuthorizer = InternalFileChatAuthorizer;

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more methods here.
 */

type ChatAttributesItem = DynamoTableItemType<typeof ChatTable, "Chat", "Attributes">;
type ChatAccountItem = DynamoTableItemType<typeof ChatTable, "Chat", "Account">;

type ChatItem = {
    readonly attributesItem: ChatAttributesItem;
    readonly accountItems: ReadonlyArray<ChatAccountItem>;
};

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
    const accounts = await runAllPromises(
        accountIds.map(accountId => getAccount(context, spaceId, accountId)),
    );

    if (accounts.every(account => account.botId)) {
        throw new PermissionDeniedError("Can’t create a chat with only bot accounts");
    }

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
    context: ServerAccountActionContext,
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
        actorAccountId: context.actor.getPossiblyBotAccountId(),
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
          chatItem: ChatItem;
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
        await authorizeOwnSpaceAccountAccess(context, actorAccountId);

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

            const createChatForAccounts = async (
                chatId: ChatId,
            ): Promise<ChatForAccountsResult> => {
                await sendChatMessageToAccountsBeforeCreateChatTestCheckpoint.waitForTest(
                    actorAccountId,
                );

                try {
                    const createdTime = new Date();

                    const attributesItem: ChatAttributesItem = {
                        partitionType: "Chat",
                        sortRangeType: "Attributes",
                        chatId,
                        spaceId,
                        createdTime,
                        accountIdsForOneOnOne:
                            allSortedAccountIds.length === 2 ? allSortedAccountIds : null,
                        messagesSummary: {
                            nextMessageIndex: 0,
                            messageCount: 0,
                        },
                    };

                    const accountItems = Array.from(
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
                            ChatTable.transactionCreateItem(attributesItem),
                            ...accountItems.map(chatAccountItem =>
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

                    // Populate the newly created chat in the cache so if we need to read the chat
                    // later it's available.
                    ChatItemAuthorizationCache.set(context, "Strong", attributesItem.chatId, {
                        attributesItem,
                        accountItems,
                    });

                    // NOTE(calebmer): We don't send an `IndexSearchEntity` job for chats until the
                    // first message is sent to that chat.

                    return {
                        type: "FoundItems",
                        chatId: attributesItem.chatId,
                        chatItem: {attributesItem, accountItems},
                    };
                } catch (error) {
                    // If we have a race condition where some other process created this chat
                    // before us then retry our action. Retrying should load the chat created by
                    // the other process.
                    if (
                        isDynamoConditionCheckError(error) ||
                        isDynamoIdempotentParameterMismatchError(error)
                    ) {
                        ChatItemAuthorizationCache.delete(context, chatId);
                        retry(error);
                    }

                    throw error;
                }
            };

            const [, {optimisticChatId, optimisticChatItem}, isActorBotAccount, otherAccounts] =
                await runAllPromises([
                    // Make sure the authenticated account has access to the space.
                    authorizeSpaceAccess(context, spaceId),

                    (async () => {
                        const optimisticChatId = getOptimisticChatId(spaceId, allSortedAccountIds);
                        const optimisticChatItem = await getChatItemIfExistsForAuthorization(
                            context,
                            optimisticChatId,
                        );
                        return {optimisticChatId, optimisticChatItem};
                    })(),

                    // Is the actor a bot account? We won't allow a chat with only bots.
                    isBotSpaceAccount(context, spaceId, actorAccountId),

                    // Make sure all accounts we are sending a message to are a part of the
                    // provided space.
                    runAllPromises(
                        Array.from(otherAccountIds, accountId =>
                            getAccount(context, spaceId, accountId),
                        ),
                    ),
                ]);

            if (isActorBotAccount && otherAccounts.every(account => account.botId)) {
                throw new PermissionDeniedError("Can’t create a chat with only bot accounts");
            }

            // If the optimistic `ChatId` does not exist then create a new chat with the
            // optimistic `ChatId` and send a message there.
            if (!optimisticChatItem) {
                return createChatForAccounts(optimisticChatId);
            }

            // If the optimistic `ChatId` exists then we need to double check it matches
            // our expected space and accounts. If it does then hooray! We can send a chat
            // message here.
            if (
                optimisticChatItem.attributesItem.spaceId === spaceId &&
                isDeepEqual(
                    allSortedAccountIds,
                    // Chat account items should be sorted by DynamoDB.
                    optimisticChatItem.accountItems.map(item => item.accountId),
                )
            ) {
                return {
                    type: "FoundItems",
                    chatId: optimisticChatItem.attributesItem.chatId,
                    chatItem: optimisticChatItem,
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
    context: ServerAccountActionContext,
    {
        chatId,
        parent,
        content,
        fileIds,
        createdTimeZone,
        isStream,
        consistency,
    }: {
        chatId: ChatId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        createdTimeZone: TimeZone;
        isStream?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    return sendChatMessageForAccount(context, {
        chatId,
        authorId: context.actor.getPossiblyBotAccountId(),
        parent,
        content,
        fileIds,
        createdTimeZone,
        clerical: isStream ? {type: "Stream"} : undefined,
        consistency,
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
        parent,
        content,
        fileIds,
        createdTimeZone,
        clerical,
        consistency,
        clientRequestToken,
    }: {
        chatId: ChatId;
        authorId: AccountId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        createdTimeZone: TimeZone;
        clerical?: MessageContentPayloadClerical;
        consistency?: DynamoCacheReadConsistency;
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
        await authorizeOwnSpaceAccountAccess(context, authorId);

        const [{chatAttributesItem, chatAccountItem}] = await runAllPromises([
            (async () => {
                const items = await authorizeChatAccessForAccountAndReturnItems(
                    context,
                    chatId,
                    authorId,
                    {consistency},
                );

                // Make sure all the provided files exist.
                await runAllPromises(
                    fileIds.map(fileId =>
                        isId<FileId>(fileId)
                            ? getFileFromAttachment(
                                  context,
                                  items.chatAttributesItem.spaceId,
                                  fileId,
                                  FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
                                  {consistency},
                              )
                            : null,
                    ),
                );

                return items;
            })(),
            (async () => {
                if (!parent) return;

                switch (parent.type) {
                    case "Message": {
                        await ChatTable.getItem(context, {
                            partitionType: "Chat",
                            sortRangeType: "Messages",
                            chatId,
                            messageIndex: parent.index,
                        });
                        break;
                    }
                    case "MessagesRange": {
                        const messageItems = await arrayFromAsyncIterable(
                            runMessagesQuery(context, {
                                cache: ChatMessageItemContextCache,
                                cacheKeyPrefix: chatId,
                                consistency,
                                startIndex: parent.startIndex,
                                endIndex: parent.endIndex,
                                query: ({consistency, limit, startSortKey, endSortKey}) =>
                                    ChatTable.query(context, {
                                        consistency,
                                        limit,
                                        partitionKey: {partitionType: "Chat", chatId},
                                        startSortKey,
                                        endSortKey,
                                    }),
                            }),
                        );

                        validateMessageContentPayloadMessagesRangeParent(parent, messageItems);
                        break;
                    }
                    case "PostRange": {
                        throw new InvalidArgumentError(
                            "Post range parent can only be used with post comments",
                        );
                    }
                    default:
                        throw exhaustive(parent);
                }
            })(),
        ]);

        if (clerical) {
            switch (clerical.type) {
                case "ShareNotification": {
                    if (context.actor.type !== "System") {
                        throw new PermissionDeniedError(
                            "Only system actors can send `ShareNotification` messages",
                        );
                    }
                    break;
                }
                case "Stream": {
                    if (context.actor.type !== "Bot") {
                        throw new PermissionDeniedError("Only bots can send `Stream` messages");
                    }
                    break;
                }
                default:
                    throw exhaustive(clerical);
            }
        }

        const messageIndex = chatAttributesItem.messagesSummary.nextMessageIndex;

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock
        // `Date.now()` and override the time that is returned.
        const createdTime = new Date(Date.now());

        await DynamoTableSchema.executeTransaction(
            context,
            [
                ChatTable.transactionCreateItem(
                    {
                        partitionType: "Chat",
                        sortRangeType: "Messages",
                        chatId,
                        messageIndex,
                        authorId,
                        createdTime,
                        createdTimeZone,
                        payload: {
                            type: "Content",
                            parent,
                            content,
                            contentUpdate: null,
                            fileIds,
                            clerical,
                            reactionsByPos: emptyMap,
                        },
                    },
                    // Retry in case of a race condition where another process writes to this
                    // `messageIndex` before us.
                    {isConditionCheckErrorRetriable: true},
                ),
                ChatTable.transactionDirectlyUpdateItemAttribute(
                    {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                    "messagesSummary",
                    {
                        nextMessageIndex: chatAttributesItem.messagesSummary.nextMessageIndex + 1,
                        messageCount: chatAttributesItem.messagesSummary.messageCount + 1,
                    },
                    {updateLockVersion: chatAttributesItem.updateLockVersion},
                ),

                // If this is a stream message then create the stream state item.
                // Create-or-replace is safe since we know the message index doesn't exist from
                // our other condition checks.
                ...(clerical?.type === "Stream"
                    ? [
                          ChatTable.transactionCreateOrReplaceItem({
                              partitionType: "Chat",
                              sortRangeType: "Messages#Stream",
                              chatId,
                              createdTime,
                              messageIndex,
                              authorId,
                              completedTime: null,
                              partCount: 0,
                              lastPartUpdateLockVersion: null,
                              lastPartCreatedTime: null,
                              lastPingTime: null,
                              lastIndexSearchEntityJob: {
                                  sendTime: createdTime,
                                  delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
                              },
                          }),
                      ]
                    : []),
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
                spaceId: chatAttributesItem.spaceId,
                chatId,
                messageIndex,
                createdTime,
                createdTimeZone,
                authorId,
                mentionedAccountIds,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
                clerical,
            },
        });

        context.jobs.send(
            {
                type: "IndexSearchEntity",
                spaceId: chatAttributesItem.spaceId,
                update: {
                    type: "ChatMessage",
                    chatId,
                    messageIndex,
                    // Nothing depends on this entity when it's created. Don't bother trying to
                    // reindex dependencies.
                    updatedTraits: {type: "None"},
                },
            },
            {
                delaySeconds:
                    clerical?.type === "Stream" ? messageStreamIndexSearchEntityDelaySeconds : 0,
            },
        );

        // We don't index a chat for search until the first message is sent to
        // the chat.
        if (messageIndex === 0) {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId: chatAttributesItem.spaceId,
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
                        spaceId: chatAttributesItem.spaceId,
                        entityId: `Chat:${chatAttributesItem.chatId}`,
                        interaction,
                    });
                } else {
                    const chatAccountIds =
                        // If `accountIdsForOneOnOne` is available we can use it, otherwise we need to
                        // query chat accounts to get our partner's `AccountId`.
                        chatAttributesItem.accountIdsForOneOnOne ??
                        (await getChatItemForAuthorization(context, chatId)).accountItems.map(
                            ({accountId}) => accountId,
                        );

                    const otherChatAccountIds = chatAccountIds.filter(
                        chatAccountId => chatAccountId !== sessionContext.actor.getAccountId(),
                    );

                    await markSearchAffinityEntityInteraction(sessionContext, {
                        spaceId: chatAttributesItem.spaceId,
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
                        await isAccountMemberOfSpace(
                            context,
                            chatAttributesItem.spaceId,
                            mentionedAccountId,
                        )
                    ) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId: chatAttributesItem.spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });
                    }
                });
            }
        }

        return {
            spaceId: chatAttributesItem.spaceId,
            chatId,
            index: messageIndex,
            createdTime,
        };
    });
}

/**
 * Update a part of the message stream.
 *
 * Message streams are made up of multiple parts. Only the bot that created a
 * stream can update the stream. A bot can only create new parts or update the
 * last part of the stream.
 *
 * Currently, you completely replace a part when you update it. We may allow
 * more granular part updates in the future.
 */
export function putChatMessageStreamPart(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        partIndex,
        payload,
        consistency,
        isTimeoutErrorCompletion = false,
    }: {
        chatId: ChatId;
        messageIndex: number;
        partIndex: number | "Create";
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
        isTimeoutErrorCompletion?: boolean;
    },
): Promise<{spaceId: SpaceId; createdTime: Date}> {
    if (isTimeoutErrorCompletion && context.actor.type !== "System") {
        throw new PermissionDeniedError(
            "Only system actors can complete a message stream after timeout",
        );
    }

    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeChatAccess(context, chatId, {consistency}),

            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Messages#Stream",
                    chatId,
                    messageIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        if (item.completedTime !== null) {
            // If the stream is already completed then noop.
            if (isTimeoutErrorCompletion) return {spaceId, createdTime: new Date()};

            throw new FailedPreconditionError("The stream has already been completed", {
                displayMessage: errorDisplayMessage`The stream has already been completed.`,
            });
        }

        if (!isTimeoutErrorCompletion && hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantWriteToStaleMessageStreamError();
        }

        if (partIndex === "Create") {
            partIndex = item.partCount;
        }

        // Use `Date.now()` so tests can mock the `Date.now()` function.
        const currentTime = new Date(Date.now());

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        let version: number;

        let createdTime: Date;
        if (partIndex === item.partCount) {
            createdTime = currentTime;

            const createPartTransactionEntry = ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "Messages#StreamPart",
                chatId,
                messageIndex,
                partIndex,
                payload,
                createdTime,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ChatTable.transactionDirectlyUpdateItem({
                    ...item,
                    completedTime: isTimeoutErrorCompletion ? currentTime : null,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastPartCreatedTime: createdTime,
                    lastPingTime,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                createPartTransactionEntry,
            ]);
        } else {
            if (partIndex !== item.partCount - 1) {
                throw new FailedPreconditionError(
                    "Only the last part of the stream or the next part can be updated",
                    {
                        displayMessage: errorDisplayMessage`Only the last part of the stream (index ${
                            item.partCount - 1
                        }) or the next part (index ${item.partCount}) can be updated.`,
                    },
                );
            }

            assert(item.lastPartUpdateLockVersion !== null);
            assert(item.lastPartCreatedTime !== null);
            createdTime = item.lastPartCreatedTime;

            const updatePartTransactionEntry = ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "Messages#StreamPart",
                chatId,
                messageIndex,
                partIndex,
                payload,
                createdTime,
                updateLockVersion: item.lastPartUpdateLockVersion + 1,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ChatTable.transactionDirectlyUpdateItem({
                    ...item,
                    completedTime: isTimeoutErrorCompletion ? currentTime : null,
                    lastPingTime,
                    lastPartUpdateLockVersion: item.lastPartUpdateLockVersion + 1,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                updatePartTransactionEntry,
            ]);
        }

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "ChatMessage",
                        chatId,
                        messageIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        // NOTE(calebmer): If the process dies after committing to DynamoDB but before
        // sending this realtime event the user might not see an update to their
        // message in realtime.
        //
        // Should we send this broadcast event in a DynamoDB Streams listener that
        // reacts to the update? We plan to move `NotificationEvent`,
        // `IndexSearchEntity`, and other processing that needs to reliably run after
        // an updates to DynamoDB Streams.
        context.process.waitUntil(
            context.edge.broadcastToDurableObject(
                `/api/durable-objects/chat/${chatId}/broadcast-put-message-stream-part`,
                {
                    serviceName: "ChatRealtimeService",
                    route: "/api/durable-objects/chat/:chatId/broadcast-put-message-stream-part",
                    body: MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.serialize({
                        index: messageIndex,
                        partIndex,
                        part: {version, payload, createdTime},
                    }),
                },
            ),
        );

        return {spaceId, createdTime};
    });
}

/**
 * Completes a message stream. After this parts can't be added or updated.
 *
 * This function is idempotent. If the stream is already completed this method
 * does nothing.
 */
export function completeChatMessageStream(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        consistency,
    }: {
        chatId: ChatId;
        messageIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    completedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeChatAccess(context, chatId, {consistency}),

            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Messages#Stream",
                    chatId,
                    messageIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        // Already completed!
        if (item.completedTime !== null) {
            return {spaceId, completedTime: item.completedTime};
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock
        // `Date.now()` and override the time that is returned.
        const completedTime = new Date(Date.now());

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantCompleteStaleMessageStreamError();
        }

        await ChatTable.directlyUpdateItem(context, {
            ...item,
            completedTime,
        });

        // NOTE(calebmer): If the process dies after committing to DynamoDB but before
        // sending this realtime event the user might not see an update to their
        // message in realtime.
        //
        // Should we send this broadcast event in a DynamoDB Streams listener that
        // reacts to the update? We plan to move `NotificationEvent`,
        // `IndexSearchEntity`, and other processing that needs to reliably run after
        // an updates to DynamoDB Streams.
        context.process.waitUntil(
            context.edge.broadcastToDurableObject(
                `/api/durable-objects/chat/${chatId}/broadcast-complete-message-stream`,
                {
                    serviceName: "ChatRealtimeService",
                    route: "/api/durable-objects/chat/:chatId/broadcast-complete-message-stream",
                    body: MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.serialize({
                        index: messageIndex,
                        completedTime,
                    }),
                },
            ),
        );

        return {spaceId, completedTime};
    });
}

/**
 * Pings a message stream and updates its `lastPingTime`.
 *
 * This function is idempotent. If the stream hasn't been pinged in a while this method
 * will update its `lastPingTime`.
 */
export function pingChatMessageStream(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        consistency,
    }: {
        chatId: ChatId;
        messageIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    lastPingTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeChatAccess(context, chatId, {consistency}),

            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Messages#Stream",
                    chatId,
                    messageIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        if (item.completedTime !== null) {
            throw createCantPingCompletedMessageStreamError();
        }

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantPingStaleMessageStreamError();
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock
        // `Date.now()` and override the time that is returned.
        const currentTime = new Date(Date.now());

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        // Our `IndexSearchEntity` job also serves to expire streams that haven't been
        // updated in a while. So we need to re-schedule it when the stream is pinged.
        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        await ChatTable.directlyUpdateItem(context, {
            ...item,
            lastPingTime,
            lastIndexSearchEntityJob: nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
        });

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "ChatMessage",
                        chatId,
                        messageIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        return {spaceId, lastPingTime};
    });
}

const ChatAttributesItemAuthorizationCache = new DynamoContextCache<
    ChatId,
    ChatAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getChatAttributesItemIfExistsForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<ChatAttributesItem | null> {
    const chatItem = await ChatItemAuthorizationCache.getIfExists(context, consistency, chatId);
    if (chatItem) return chatItem.attributesItem;

    return ChatAttributesItemAuthorizationCache.get(context, consistency, chatId, consistency => {
        return ChatTable.getItemIfExists(
            context,
            {
                partitionType: "Chat",
                sortRangeType: "Attributes",
                chatId,
            },
            {consistency},
        );
    });
}

async function getChatAttributesItemForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatAttributesItem> {
    const chatItem = await getChatAttributesItemIfExistsForAuthorization(context, chatId, options);
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
    const chatItem = await ChatItemAuthorizationCache.getIfExists(context, consistency, chatId);
    if (chatItem) {
        return chatItem.accountItems.find(item => item.accountId === accountId) ?? null;
    }

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

const ChatItemAuthorizationCache = new DynamoContextCache<ChatId, ChatItem | null>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

function getChatItemIfExistsForAuthorization(
    context: ServerMinimalActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<ChatItem | null> {
    return ChatItemAuthorizationCache.get(context, consistency, chatId, async consistency => {
        let attributesItem: ChatAttributesItem | undefined;
        const accountItems: Array<ChatAccountItem> = [];

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
                    assert(!attributesItem);
                    attributesItem = item;
                    break;
                }
                case "Account": {
                    assert(attributesItem);
                    accountItems.push(item);
                    break;
                }
                default:
                    throw exhaustive(item);
            }
        }

        if (!attributesItem) {
            assert(accountItems.length === 0);
            return null;
        }

        return {attributesItem, accountItems};
    });
}

async function getChatItemForAuthorization(
    context: ServerMinimalActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatItem> {
    const chatItem = await getChatItemIfExistsForAuthorization(context, chatId, options);
    if (!chatItem) throw createChatNotFoundError(chatId);
    return chatItem;
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
    return unwrapResult(await authorizeChatAccessIfPossible(context, chatId, options));
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
    return mapResult(result, ({spaceId}) => ({spaceId}));
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
            const result = await authorizeChatAccessForAccountAndReturnItemsIfPossible(
                context,
                chatId,
                context.actor.getAccountId(),
                options,
            );
            return mapResult(result, ({chatAttributesItem}) => chatAttributesItem);
        }

        // If we have access to the space, we have access to the chat...
        case "System": {
            const attributesItem = await getChatAttributesItemForAuthorization(
                context,
                chatId,
                options,
            );
            const result = await authorizeSpaceAccessIfPossible(context, attributesItem.spaceId);
            if (!result.ok) return result;
            return {ok: true, value: attributesItem};
        }

        case "Anonymous": {
            return {ok: false, error: unauthenticatedSessionError()};
        }

        case "Bot": {
            const chatItem = await getChatItemForAuthorization(context, chatId, options);

            const accessPolicy: AccessPolicyWithoutGenerations = {
                accountGrantById: new Map(
                    chatItem.accountItems.map(({accountId}) => [accountId, {level: "Edit"}]),
                ),
                defaultGrant: null,
                urlGrant: null,
            };

            const ok = await evaluateAccessPolicy(
                context,
                chatItem.attributesItem.spaceId,
                accessPolicy,
                "Edit",
                options,
            );

            if (!ok) {
                return {
                    ok: false,
                    error: new PermissionDeniedError("Bot actor doesn’t have access to chat", {
                        displayMessage: chatPermissionDeniedErrorDisplayMessage,
                    }),
                };
            }

            return {ok: true, value: chatItem.attributesItem};
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
    return unwrapResult(
        await authorizeChatAccessForAccountIfPossible(context, chatId, accountId, options),
    );
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
export async function authorizeChatAccessForAccountIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; chatAccountCount: number}, ErrorBase>> {
    const result = await authorizeChatAccessForAccountAndReturnItemsIfPossible(
        context,
        chatId,
        accountId,
        options,
    );
    return mapResult(
        result,
        ({chatAttributesItem: {spaceId}, chatAccountItem: {chatAccountCount}}) => ({
            spaceId,
            chatAccountCount,
        }),
    );
}

async function authorizeChatAccessForAccountAndReturnItems(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{chatAttributesItem: ChatAttributesItem; chatAccountItem: ChatAccountItem}> {
    return unwrapResult(
        await authorizeChatAccessForAccountAndReturnItemsIfPossible(
            context,
            chatId,
            accountId,
            options,
        ),
    );
}

const chatPermissionDeniedErrorDisplayMessage = errorDisplayMessage`You don’t have access to this chat.`;

export async function authorizeChatAccessForAccountAndReturnItemsIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<
    Result<{chatAttributesItem: ChatAttributesItem; chatAccountItem: ChatAccountItem}, ErrorBase>
> {
    const [chatAttributesItemResult, chatAccountItem] = await runAllPromises([
        (async (): Promise<Result<ChatAttributesItem, ErrorBase>> => {
            switch (context.actor.type) {
                case "Session":
                case "ImpersonatedAccount": {
                    // We already are loading our session's chat account item above.
                    if (context.actor.getAccountId() === accountId) {
                        const attributesItem = await getChatAttributesItemForAuthorization(
                            context,
                            chatId,
                            options,
                        );

                        // Throw if actor doesn't have access to the chat. We only return a `Result`
                        // when the account we're checking doesn't have access to the chat.
                        const result = await authorizeSpaceAccessIfPossible(
                            context,
                            attributesItem.spaceId,
                        );
                        if (!result.ok) return result;
                        return {ok: true, value: attributesItem};
                    }

                    // Intentionally fallthrough...
                }
                case "System":
                case "Anonymous":
                case "Bot": {
                    // Throw if actor doesn't have access to the chat. We only return a `Result`
                    // when the account we're checking doesn't have access to the chat.
                    const attributesItem = unwrapResult(
                        await authorizeChatAccessAndReturnItemIfPossible(context, chatId, options),
                    );

                    // Make sure the account is a member of the space. If the account was removed
                    // from the space then we want to return a `PermissionDeniedError`.
                    if (
                        !(await isAccountMemberOfSpace(context, attributesItem.spaceId, accountId))
                    ) {
                        return {
                            ok: false,
                            error: new PermissionDeniedError("Account isn’t a member of space"),
                        };
                    }

                    return {ok: true, value: attributesItem};
                }
                default:
                    throw exhaustive(context.actor);
            }
        })(),

        // Load the account we're authorizing. We intentionally put this second so if
        // we have a bot actor that loads the full account (with
        // `getChatItemForAuthorization()`) then we won't need to make a second request
        // here thanks to `getChatAccountItemIfExistsForAuthorization()` checking the
        // `getChatItemForAuthorization()` cache first.
        getChatAccountItemIfExistsForAuthorization(context, chatId, accountId, options),
    ]);

    if (!chatAttributesItemResult.ok) return chatAttributesItemResult;
    const chatAttributesItem = chatAttributesItemResult.value;

    if (!chatAccountItem) {
        return {
            ok: false,
            error: new PermissionDeniedError("Account doesn’t have access to chat", {
                displayMessage: chatPermissionDeniedErrorDisplayMessage,
            }),
        };
    }

    return {ok: true, value: {chatAttributesItem, chatAccountItem}};
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
        await authorizeOwnSpaceAccountAccess(context, actorAccountId);

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
    const chatItem = await getChatItemForAuthorization(context, chatId);

    // This call won't make any database calls since it's after the
    // `getChatItemForAuthorization()` call which will cache the data we need.
    await authorizeChatAccess(context, chatId);

    return createChatModelFromItem(context, chatItem);
}

async function createChatModelFromItem(
    context: ServerActionContext,
    chatItem: ChatItem,
): Promise<ChatModel> {
    const accounts = await runAllPromises(
        chatItem.accountItems.map(chatAccountItem => {
            if (chatAccountItem.spaceId !== chatItem.attributesItem.spaceId) {
                throw new DataLossError(
                    "Expected chat account item to have same `SpaceId` as chat item",
                );
            }
            return getAccount(context, chatItem.attributesItem.spaceId, chatAccountItem.accountId);
        }),
    );

    return new ChatModel({
        id: chatItem.attributesItem.chatId,
        spaceId: chatItem.attributesItem.spaceId,
        createdTime: chatItem.attributesItem.createdTime,
        messageCount: chatItem.attributesItem.messagesSummary.messageCount,
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
    const chatItem = await getChatItemForAuthorization(context, chatId, {consistency});

    // This call won't make any database calls since it's after the
    // `getChatItemForAuthorization()` call which will cache the data we need.
    await authorizeChatAccess(context, chatId, {consistency});

    return {
        createdTime: chatItem.attributesItem.createdTime,
        spaceId: chatItem.attributesItem.spaceId,
        hasMessages: chatItem.attributesItem.messagesSummary.messageCount > 0,
        accountIds: chatItem.accountItems.map(({accountId}) => accountId),
    };
}

/**
 * Load the chat's accounts for a bot scoped to the chat. Used
 * when evaluating whether a bot has permissions to certain resources.
 */
export async function getChatAccountIdsForBotScope(
    context: ServerMinimalBotActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ReadonlyArray<AccountId>> {
    const scope = context.actor.getScope();
    if (scope.type !== "Chat" || scope.chatId !== chatId) {
        throw new PermissionDeniedError("Can only get `AccountId`s for the scoped chat");
    }

    const chatItem = await getChatItemForAuthorization(context, chatId, options);

    await authorizeSpaceAccess(context, chatItem.attributesItem.spaceId);

    return chatItem.accountItems.map(({accountId}) => accountId);
}

const ChatMessageItemContextCache = new DynamoContextCache<
    `${ChatId}:${number}`,
    MessageItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getChatMessageItemIfExists(
    context: ServerActionContext,
    chatId: ChatId,
    messageIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        runMessagesQuery(context, {
            cache: ChatMessageItemContextCache,
            cacheKeyPrefix: chatId,
            consistency,
            startIndex: messageIndex,
            endIndex: messageIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                ChatTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Chat", chatId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    assert(items.length <= 1);

    return items[0] ?? null;
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
        getChatMessageItemIfExists(context, chatId, messageIndex),
    ]);

    if (!item) throw createChatMessageNotFoundError(chatId, messageIndex);

    return createChatMessageModelFromItem(context, spaceId, chatId, item);
}

/**
 * Get a chat message with a version that's either equal to or greater than the
 * provided version.
 */
export async function getChatMessageAtVersion(
    context: ServerActionContext,
    {chatId, messageIndex, version}: {chatId: ChatId; messageIndex: number; version: number},
): Promise<ChatMessageModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId),
        (async () => {
            let item = await getChatMessageItemIfExists(context, chatId, messageIndex, {
                consistency: "Eventual",
            });

            if (!item || item.version < version) {
                item = await getChatMessageItemIfExists(context, chatId, messageIndex, {
                    consistency: "Strong",
                });
            }

            if (!item) {
                throw createChatMessageNotFoundError(chatId, messageIndex);
            }

            if (item.version < version) {
                throw new FailedPreconditionError("Can’t get message at a future version");
            }

            return item;
        })(),
    ]);

    return createChatMessageModelFromItem(context, spaceId, chatId, item);
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
): Promise<MessageItem & {spaceId: SpaceId}> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId, {consistency}),
        getChatMessageItemIfExists(context, chatId, messageIndex, {consistency}),
    ]);

    if (!item) throw createChatMessageNotFoundError(chatId, messageIndex);

    return {spaceId, ...item};
}

async function createChatMessageModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    chatId: ChatId,
    item: MessageItem,
): Promise<ChatMessageModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new ChatMessageModel({
        chatId,
        index: item.index,
        version: item.version,
        author,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        payload,
        stream: item.stream,
    });
}

/**
 * Update the contents of a chat message.
 */
export function updateChatMessageContent(
    context: ServerAccountActionContext,
    {
        chatId,
        messageIndex,
        contentVersion,
        steps,
    }: {
        chatId: ChatId;
        messageIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: MessageContent;
    contentUpdate: MessageContentPayloadContentUpdate;
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

        if (chatMessageItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only update chat messages you authored");

        const {newPayload} = computeUpdateMessageContent(chatMessageItem, contentVersion, steps);

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...chatMessageItem,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: newPayload.contentUpdate.time,
                messageIndex: chatMessageItem.messageIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(
                    newPayload.contentUpdate.time,
                    messagingEventExpirationDays,
                ),
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

        return {
            spaceId: chatItem.spaceId,
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            content: newPayload.content,
            contentUpdate: newPayload.contentUpdate,
        };
    });
}

/**
 * Delete a single chat message.
 */
export function deleteChatMessage(
    context: ServerAccountActionContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<{version: number; deletedTime: Date}> {
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

        if (chatMessageItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete messages you authored");

        if (chatMessageItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can’t delete messages with a non-content payload");

        if (chatMessageItem.payload.clerical)
            throw new FailedPreconditionError("Can’t delete clerical messages");

        const deletedTime = new Date();

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...chatMessageItem,
            payload: {type: "Deleted", deletedTime},
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: deletedTime,
                messageIndex: chatMessageItem.messageIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(deletedTime, messagingEventExpirationDays),
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

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            deletedTime,
        };
    });
}

export function setChatMessageReaction(
    context: ServerSessionActionContextWithPush,
    {
        chatId,
        messageIndex,
        contentVersion,
        pos,
        reaction,
    }: {
        chatId: ChatId;
        messageIndex: number;
        contentVersion: number;
        pos: number;
        reaction: Reaction | "GenericLike";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [chatItem, messageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId),
            getChatMessageItemIfExists(context, chatId, messageIndex),
        ]);

        if (!messageItem) throw createChatMessageNotFoundError(chatId, messageIndex);

        const currentTime = new Date();

        const newPayload = computeSetMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: messageItem,
            contentVersion,
            pos,
            reaction,
        });

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...omitObject(messageItem, ["index", "version"]),
            partitionType: "Chat",
            sortRangeType: "Messages",
            chatId,
            messageIndex: messageItem.index,
            updateLockVersion: messageItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: currentTime,
                messageIndex: messageItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        context.process.waitUntil(
            context.notificationsInjection.archiveInboxChatEntryAfterSetChatMessageReaction({
                spaceId: chatItem.spaceId,
                chatId,
                messageCount: chatItem.messagesSummary.messageCount,
                messageIndex,
            }),
        );

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

export function deleteChatMessageReaction(
    context: ServerAccountActionContext,
    {
        chatId,
        messageIndex,
        contentVersion,
        pos,
    }: {
        chatId: ChatId;
        messageIndex: number;
        contentVersion: number;
        pos: number;
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [, messageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId),
            getChatMessageItemIfExists(context, chatId, messageIndex),
        ]);

        if (!messageItem) throw createChatMessageNotFoundError(chatId, messageIndex);

        const currentTime = new Date();

        const newPayload = computeDeleteMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: messageItem,
            contentVersion,
            pos,
        });

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...omitObject(messageItem, ["index", "version"]),
            partitionType: "Chat",
            sortRangeType: "Messages",
            chatId,
            messageIndex: messageItem.index,
            updateLockVersion: messageItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: currentTime,
                messageIndex: messageItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

/**
 * Get our chat and initial messages that come with it efficiently at once.
 */
export function getChatAndInitialMessages(
    context: ServerActionContext,
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
    context: ServerActionContext,
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
            chatPromise = (async () => {
                // This call won't make any database calls since it's (hopefully) after a
                // `getChatItemForAuthorization()` call which will cache the data we need.
                await authorizeChatAccess(context, result.chatId);

                return createChatModelFromItem(context, result.chatItem);
            })();
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
            chatItemPromise: chatPromise.then(({spaceId, messageCount}) => ({
                spaceId,
                messagesSummary: {messageCount},
            })),
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

    const queryStartMessageIndex =
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0;

    const queryEndMessageIndex = Math.min(
        queryStartMessageIndex + limit - 1,
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const messageItems = await arrayFromAsyncIterable(
        runMessagesQuery(context, {
            cache: ChatMessageItemContextCache,
            cacheKeyPrefix: chatId,
            consistency,
            startIndex: queryStartMessageIndex,
            endIndex: queryEndMessageIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                ChatTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Chat", chatId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    if (messageItems.length === 0) return {messages: [], otherReferencedMessages: []};

    const startMessageIndex = messageItems[0]!.index;
    const endMessageIndex = messageItems[messageItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedMessagePromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedMessages: Array<ChatMessageModel> = [];

    const loadOtherReferencedMessageFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedMessage(index);
        }
    };

    const loadOtherReferencedMessage = (messageIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startMessageIndex <= messageIndex && messageIndex <= endMessageIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedMessagePromiseByIndex,
            messageIndex,
            async () => {
                const item = await getChatMessageItemIfExists(context, chatId, messageIndex, {
                    consistency,
                });
                if (!item) throw new InternalError("Parent message not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedMessageFromParent(item.payload.parent);
                }

                otherReferencedMessages.push(
                    await createChatMessageModelFromItem(context, spaceId, chatId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const messages = await runAllPromises(
        messageItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedMessageFromParent(item.payload.parent);
            }

            // Don't propagate `consistency` when loading model references. We
            // accept references can have eventual consistency.
            return createChatMessageModelFromItem(context, spaceId, chatId, item);
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
 * Paginate through chat message payloads (doesn't load references) from start
 * to finish.
 */
export async function getChatMessagePayloadsFromStart(
    context: ServerActionContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
        consistency,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    messageCount: number;
    messages: Array<MessageItem>;
}> {
    const queryStartMessageIndex =
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0;

    const queryEndMessageIndex = Math.min(
        queryStartMessageIndex + limit - 1,
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const [chatItem, messageItems] = await runAllPromises([
        authorizeChatAccessAndReturnItem(context, chatId, {consistency}),
        arrayFromAsyncIterable(
            runMessagesQuery(context, {
                cache: ChatMessageItemContextCache,
                cacheKeyPrefix: chatId,
                consistency,
                startIndex: queryStartMessageIndex,
                endIndex: queryEndMessageIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    ChatTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Chat", chatId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastMessageIndex =
        messageItems.length > 0 ? messageItems[messageItems.length - 1]!.index : -1;

    return {
        spaceId: chatItem.spaceId,
        messageCount: Math.max(
            chatItem.messagesSummary.messageCount,
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages: messageItems,
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
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId);

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        getChatMessagesFromEndAssumingAuthorizedChat(context, {
            chatId,
            chatItemPromise,
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
    };
}

async function getChatMessagesFromEndAssumingAuthorizedChat(
    context: ServerActionContext,
    {
        chatId,
        chatItemPromise,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        chatItemPromise: Promise<{spaceId: SpaceId; messagesSummary: {messageCount: number}}>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    if (limit === 0) return {messages: [], otherReferencedMessages: []};

    const queryStartMessageIndex = Math.max(
        typeof beforeMessageIndex === "number"
            ? beforeMessageIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if there
              // was a message stream then query again with `limit: "All"` and a proper query start
              // index. Instead right now we wait for chat access to authorize before starting our
              // query which is slower than authorizing + querying in parallel.
              (await chatItemPromise).messagesSummary.messageCount - limit,
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
    );

    const queryEndMessageIndex =
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER;

    const messageItems = await arrayFromAsyncIterable(
        typeof beforeMessageIndex !== "number" || beforeMessageIndex > 0
            ? runMessagesQuery(context, {
                  cache: ChatMessageItemContextCache,
                  cacheKeyPrefix: chatId,
                  consistency: undefined,
                  startIndex: queryStartMessageIndex,
                  endIndex: queryEndMessageIndex,
                  query: ({consistency, limit, startSortKey, endSortKey}) =>
                      ChatTable.query(context, {
                          consistency,
                          limit,
                          partitionKey: {partitionType: "Chat", chatId},
                          startSortKey,
                          endSortKey,
                      }),
              })
            : (async function* () {})(),
    );

    if (messageItems.length === 0) return {messages: [], otherReferencedMessages: []};

    const startMessageIndex = messageItems[0]!.index;
    const endMessageIndex = messageItems[messageItems.length - 1]!.index;

    const {spaceId} = await chatItemPromise;

    let otherReferencedMessagePromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedMessages: Array<ChatMessageModel> = [];

    const loadOtherReferencedMessageFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedMessage(index);
        }
    };

    const loadOtherReferencedMessage = (messageIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startMessageIndex <= messageIndex && messageIndex <= endMessageIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedMessagePromiseByIndex,
            messageIndex,
            async () => {
                const item = await getChatMessageItemIfExists(context, chatId, messageIndex);
                if (!item) throw new InternalError("Parent message not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedMessageFromParent(item.payload.parent);
                }

                otherReferencedMessages.push(
                    await createChatMessageModelFromItem(context, spaceId, chatId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const messages = await runAllPromises(
        messageItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedMessageFromParent(item.payload.parent);
            }
            return createChatMessageModelFromItem(context, spaceId, chatId, item);
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
 * Paginate through chat message payloads (doesn't load references) from finish
 * to start.
 */
export async function getChatMessagePayloadsFromEnd(
    context: ServerActionContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
        consistency,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    messageCount: number;
    messages: Array<MessageItem>;
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId, {consistency});

    const queryStartMessageIndex = Math.max(
        typeof beforeMessageIndex === "number"
            ? beforeMessageIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if there
              // was a message stream then query again with `limit: "All"` and a proper query start
              // index. Instead right now we wait for chat access to authorize before starting our
              // query which is slower than authorizing + querying in parallel.
              (await chatItemPromise).messagesSummary.messageCount - limit,
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
    );

    const queryEndMessageIndex =
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER;

    const [chatItem, messageItems] = await runAllPromises([
        chatItemPromise,
        arrayFromAsyncIterable(
            runMessagesQuery(context, {
                cache: ChatMessageItemContextCache,
                cacheKeyPrefix: chatId,
                consistency,
                startIndex: queryStartMessageIndex,
                endIndex: queryEndMessageIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    ChatTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Chat", chatId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastMessageIndex =
        messageItems.length > 0 ? messageItems[messageItems.length - 1]!.index : -1;

    return {
        spaceId: chatItem.spaceId,
        messageCount: Math.max(
            chatItem.messagesSummary.messageCount,
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages: messageItems,
    };
}

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
        checkpoint,
        clientMessageCount,
        newMessageLimit,
    }: {
        chatId: ChatId;
        checkpoint: ServerSynchronizationCheckpoint;
        clientMessageCount: number;
        newMessageLimit: number;
    },
): Promise<{
    messageCount: number;
    newMessages: Array<ChatMessageModel>;
    newOtherReferencedMessages: Array<ChatMessageModel>;
    messageUpdatesResult: MessageUpdatesBackfillResult<ChatMessageModel>;
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId);

    const [chatItem, {messages, otherReferencedMessages}, messageUpdatesResult] =
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
            runBackfillMessageUpdates(context, {
                checkpoint,
                queryMessageUpdates: (context, options) =>
                    ChatTable.query(context, {
                        partitionKey: {partitionType: "Chat", chatId},
                        ...options,
                    }),
                getMessageIfExists: (context, messageIndex, options) =>
                    getChatMessageItemIfExists(context, chatId, messageIndex, options),
                createMessageModelFromItem: async (context, item) => {
                    const {spaceId} = await chatItemPromise;
                    return createChatMessageModelFromItem(context, spaceId, chatId, item);
                },
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
        newMessages: messages,
        newOtherReferencedMessages: otherReferencedMessages,
        messageUpdatesResult,
    };
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

            // Don't send share notification to bot accounts.
            if (await isBotSpaceAccount(context, spaceId, otherAccountId)) return;

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
                    parent: null,
                    content: notification.content,
                    fileIds: [entityId],
                    clerical: {
                        type: "ShareNotification",
                        entityType: parseFileEntityId(entityId).type,
                    },
                    createdTimeZone: notification.createdTimeZone,
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
