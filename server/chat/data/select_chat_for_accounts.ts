import {getChat} from "~/server/chat/data/get_chat.js";
import {actuallyGetChatAndInitialMessages} from "~/server/chat/data/internal/actually_get_chat_and_initial_messages.js";
import {actuallyGetOrCreateChatForAccounts} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {getSharedChats} from "~/server/chat/data/internal/get_shared_chats.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {asyncIterableFromIterable} from "~/shared/helpers/iterable/async_iterable_from_iterable.js";
import {parallelFilterMapLimitAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_filter_map_limit_async_iterable_to_array.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Called by the chat account picker component after the user has selected some
 * accounts to send a message to. Tells us what the shared chat between those
 * accounts is (and creates an empty chat for those accounts if one does not
 * exist). Also returns some suggested accounts we will show in the chat account
 * picker's autocomplete list.
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
        // Make sure `otherAccountIds` is unique and doesn't include our authenticated
        // account.
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

                // Limit the number of chats we return since we need to load the full chat object.
                // We sort shared chats by some heuristics to put more relevant chats first but the
                // heuristics don't consider user activity. Ideally we would also sort with our
                // affinity system. (I (@calebmer) have a rough idea of an affinity system I'd like
                // to build.)
                const suggestedChatLimit = 5;

                return parallelFilterMapLimitAsyncIterableToArray(
                    asyncIterableFromIterable(sharedChats),
                    suggestedChatLimit,
                    async sharedChat => {
                        // We only suggest chats with additional accounts on top of the ones we requested.
                        if (sharedChat.accountCount <= otherAccountIds.length + 1) return null;

                        const chat = await getChat(context, sharedChat.id);

                        // Only suggest chats with some messages.
                        if (chat.messageCount === 0) return null;

                        return chat;
                    },
                );
            })(),
        ]);

        return {
            selectedChat,
            // Make sure we only return direct chats. Just in case due to race conditions we
            // ended up loading some room chats. We shouldn't have loaded room chats because
            // room chats don't have chat account items (which is what this function searches)
            // but due to race condition we may have seen a chat account item for a room chat.
            suggestedChats: suggestedChats.filter(chat => chat.definition.type === "Direct"),
        };
    });
}
