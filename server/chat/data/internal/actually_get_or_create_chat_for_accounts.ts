import murmurhash from "murmurhash";
import {
    ChatAccountItem,
    ChatAttributesItem,
    ChatItem,
    ChatTable,
} from "~/server/chat/data/internal/chat_table.js";
import {
    ChatItemAuthorizationCache,
    getChatItemIfExistsForAuthorization,
} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {getOptimisticChatId} from "~/server/chat/data/internal/get_optimistic_chat_id.js";
import {getSharedChats} from "~/server/chat/data/internal/get_shared_chats.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/get_account.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export const getOrCreateChatBeforeCreateChatTestCheckpoint = new TestCheckpoint<AccountId>();

export type ChatForAccountsResult =
    | {
          type: "FoundIdOnly";
          chatId: ChatId;
      }
    | {
          type: "FoundItems";
          chatId: ChatId;
          chatItem: ChatItem;
      };

export function actuallyGetOrCreateChatForAccounts(
    context: ServerActionContext,
    {
        spaceId,
        actorAccountId,
        otherAccountIds,
        initialSharedChatsPromise,
        consistency = "Eventual",
    }: {
        spaceId: SpaceId;
        actorAccountId: AccountId;
        otherAccountIds: ReadonlyArray<AccountId>;
        initialSharedChatsPromise: ReturnType<typeof getSharedChats> | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<ChatForAccountsResult> {
    return context.tracer.withSpan("Get or create chat", async (context, span) => {
        // Make sure we're either a system actor or a session actor for this account.
        await authorizeOwnSpaceAccountAccess(context, actorAccountId);

        let hasAlreadyAttempted = false;

        return await retryWithExponentialBackoff(async (retry): Promise<ChatForAccountsResult> => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            // Make sure `otherAccountIds` is unique and doesn't include our authenticated
            // account.
            otherAccountIds = Array.from(new Set(otherAccountIds)).filter(
                accountId => accountId !== actorAccountId,
            );

            const allSortedAccountIds = [...otherAccountIds, actorAccountId].sort();

            const createChatForAccounts = async (
                chatId: ChatId,
                withClientRequestToken: boolean,
            ): Promise<ChatForAccountsResult> => {
                await getOrCreateChatBeforeCreateChatTestCheckpoint.waitForTest(actorAccountId);

                try {
                    const createdTime = new Date();

                    const attributesItem: ChatAttributesItem = {
                        partitionType: "Chat",
                        sortRangeType: "Attributes",
                        chatId,
                        spaceId,
                        createdTime,
                        definition: {type: "Direct"},
                        accountIdsForDirectOneOnOne:
                            allSortedAccountIds.length === 2 ? allSortedAccountIds : null,
                        messagesSummary: {
                            unknownAuthorMessageCount: 0,
                            messageCountByAuthorId: new Map(),
                            mentionCountByAccountId: new Map(),
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
                            // If two processes try to create a chat at the same time for the same accounts, we
                            // want to treat this transaction as idempotent.
                            //
                            // We need to hash the request token because DynamoDB imposes a maximum length on
                            // tokens.
                            clientRequestToken: withClientRequestToken
                                ? `${spaceId}:${murmurhash
                                      .v3(allSortedAccountIds.join("-"))
                                      .toString(16)
                                      .padStart(8, "0")}`
                                : undefined,
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
                    // If we have a race condition where some other process created this chat before us
                    // then retry our action. Retrying should load the chat created by the other
                    // process.
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
                            {consistency},
                        );
                        return {optimisticChatId, optimisticChatItem};
                    })(),

                    // Is the actor a bot account? We won't allow a chat with only bots.
                    isBotSpaceAccount(context, spaceId, actorAccountId),

                    // Make sure all accounts we are sending a message to are a part of the provided
                    // space.
                    //
                    // We first try to load the account with eventual consistency and if that fails we
                    // try strong consistency.
                    runAllPromises(
                        Array.from(otherAccountIds, accountId =>
                            consistency !== "Eventual"
                                ? getAccount(context, spaceId, accountId, {consistency})
                                : getAccountIfExists(context, spaceId, accountId, {
                                      consistency: "Eventual",
                                  }).then(account => {
                                      if (account) return account;
                                      return getAccount(context, spaceId, accountId, {
                                          consistency: "StrongWithinCache",
                                      });
                                  }),
                        ),
                    ),
                ]);

            if (isActorBotAccount && otherAccounts.every(account => account.botId)) {
                throw new PermissionDeniedError("Can\u2019t create a chat with only bot accounts", {
                    displayMessage: errorDisplayMessage`Can\u2019t create a chat with only bot accounts. Try again but include at least one human account in the chat.`,
                });
            }

            // If the optimistic `ChatId` does not exist then create a new chat with the
            // optimistic `ChatId` and send a message there.
            if (!optimisticChatItem) {
                span.addData({common: {branch: "CreateWithOptimisticChatId"}});

                return await createChatForAccounts(
                    optimisticChatId,
                    // Don't use a `clientRequestToken`. Because we use a deterministic `ChatId` we'll
                    // fail with a condition check error if we try to create a chat with the same
                    // `ChatId` twice in a race condition. The condition check error then gets retried
                    // and we'll find the new chat with an optimistic `ChatId` and return it.
                    false,
                );
            }

            // If the optimistic `ChatId` exists then we need to double check it matches our
            // expected space and accounts. If it does then hooray! We can send a chat message
            // here.
            if (
                optimisticChatItem.attributesItem.spaceId === spaceId &&
                isDeepEqual(
                    allSortedAccountIds,
                    // Chat account items should be sorted by DynamoDB.
                    optimisticChatItem.accountItems.map(item => item.accountId),
                )
            ) {
                span.addData({common: {branch: "FoundWithOptimisticChatId"}});

                return {
                    type: "FoundItems",
                    chatId: optimisticChatItem.attributesItem.chatId,
                    chatItem: optimisticChatItem,
                };
            }

            const sharedChats = await ((isInitialAttempt ? initialSharedChatsPromise : null) ??
                getSharedChats(
                    // TODO(calebmer, #public-api): When creating a chat consider also creating account
                    // -> chat items so we can replace `AccountChatsIndex` (which can only be queried
                    // with eventual consistency) with a strongly consistent read. Otherwise the API
                    // won't have read-after-write semantics for the `POST /chats` endpoint in some
                    // cases. (If you hit this endpoint twice with the same `accountId`s one after the
                    // other in quick succession you may get two different `ChatId`s.)
                    //
                    // It might even be worth considering putting all of an account's chats into one
                    // DynamoDB item? To solve race conditions where we try to create two chats with
                    // the same `AccountId`s _at the same time_ and end up with different `ChatId`s.
                    //
                    // Not considering this blocking for now since the endpoint is `POST /chats`,
                    // `POST` implies there could be side effects. Also, it seems pretty rare to have
                    // this problem in practice for now.
                    context.dynamo.unexpectStrongReadConsistency(),
                    {spaceId, actorAccountId, otherAccountIds},
                ));

            const firstSharedChat = sharedChats[0];

            // We found a chat that exactly matches the accounts we want to message! Send a
            // message to that chat.
            if (firstSharedChat?.accountCount === otherAccountIds.length + 1) {
                span.addData({common: {branch: "FoundWithSharedChats"}});

                return {
                    type: "FoundIdOnly",
                    chatId: firstSharedChat.id,
                };
            }

            span.addData({common: {branch: "CreateWithGeneratedChatId"}});

            return await createChatForAccounts(
                generateId(),
                // Always use `clientRequestToken`. In race conditions we want to create only one
                // chat for the accounts. The `clientRequestToken` makes sure if there are two
                // processes trying to create a chat for the same accounts only one process
                // successfully creates the chat, the other will retry and find the new chat
                // eventually with `getSharedChats()`.
                true,
            );
        });
    });
}
