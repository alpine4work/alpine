import {AccountChatsIndex} from "~/server/chat/data/internal/chat_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {
    runAllPromiseThunks,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get chats shared between the authenticated account and provided accounts in the
 * provided space.
 *
 * Sorts chats with fewer accounts first. So if a chat that exclusively contains
 * the provided accounts and authenticated account will be first.
 *
 * The current implementation isn't optimized. It loads all chats for each account
 * and finds intersecting chats.
 *
 * Idea for an optimized implementation: For every pair of accounts in a space
 * (key: `{spaceId, account1Id, account2Id}`) maintain a list of `ChatId`s they are
 * both in. Then to implement this function load all pairs between the
 * authenticated account and other accounts (should be O(otherAccounts)) and
 * intersect those chat IDs. This would eliminate a lot of the search space of this
 * function.
 *
 * Decided that the search space is small enough (~100 \* number of accounts) and
 * the items are small enough it's not worth prematurely optimizing this function.
 */
export function getSharedChats(
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

        // Make sure `otherAccountIds` is unique and doesn't include our authenticated
        // account.
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
            // Only include accounts with every requested account and the authenticated
            // account.
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
