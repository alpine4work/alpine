import {getChat, getSharedChats} from "~/server/dynamo/chat_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {ChatModel} from "~/shared/models/chat_model";
import * as definition from "~/shared/rpc/chat_rpc_definitions";

implementRpc(definition.getChatRecommendations, async (_context, input) => {
    const context = await _context.auth.authenticate();

    // Make sure we uniquify `otherAccountIds` and remove our authenticated
    // account ID.
    const otherAccountIds = new Set(
        filterIterable(
            input.otherAccountIds,
            accountId => accountId !== context.auth.getAccountId(),
        ),
    );

    const sharedChats = await getSharedChats(context, {
        spaceId: input.spaceId,
        otherAccountIds,
    });

    const firstSharedChat = sharedChats[0];

    const exactMatchChatId =
        firstSharedChat?.includedOtherAccountIds.length === otherAccountIds.size &&
        firstSharedChat.accountCount === otherAccountIds.size + 1
            ? firstSharedChat.id
            : null;

    let exactMatchChatPromise = null as Promise<ChatModel | null> | null;

    // Limit the number of chats we return since we need to load the full chat
    // object. We sort shared chats by some heuristics to put more relevant chats
    // first but the heuristics don't consider user activity. Ideally we would also
    // sort with our affinity system. (I (@calebmer) have a rough idea of an
    // affinity system I'd like to build.)
    const sharedChatRecommendations = sharedChats.slice(0, 10);

    const chatRecommendationPromises = sharedChatRecommendations.map(chat => {
        const chatPromise = getChat(context, chat.id);
        if (chat.id === exactMatchChatId) exactMatchChatPromise = chatPromise;
        return chatPromise;
    });

    const [chatRecommendations, exactMatchChat] = await runAllPromises([
        runAllPromises(chatRecommendationPromises),
        (async () => {
            const exactMatchChat = await exactMatchChatPromise;
            if (!exactMatchChat) return null;

            // TODO(calebmer): Load initial messages somewhere around here.

            return exactMatchChat;
        })(),
    ]);

    return {
        exactMatch: exactMatchChat ? {chat: exactMatchChat} : null,
        chatRecommendations: chatRecommendations.filter(isNonNullable),
    };
});
