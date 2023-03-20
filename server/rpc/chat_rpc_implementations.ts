import {
    deleteChatMessage,
    getChat,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getSharedChats,
    sendChatMessage,
    sendChatMessageToAccounts,
    updateChatMessageContent,
} from "~/server/dynamo/chat_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import {InternalError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable";
import * as definition from "~/shared/rpc/chat_rpc_definitions";

implementRpc(definition.getRecommendedChats, async (_context, input) => {
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

    const recommendedChatPromises =
        // Only return chat recommendations if we have some other account IDs.
        // Otherwise we return a list of direct message chats.
        otherAccountIds.size > 0
            ? mapIterable(
                  // Limit the number of chats we return since we need to load the full chat
                  // object. We sort shared chats by some heuristics to put more relevant chats
                  // first but the heuristics don't consider user activity. Ideally we would also
                  // sort with our affinity system. (I (@calebmer) have a rough idea of an
                  // affinity system I'd like to build.)
                  sliceIterable(
                      // Only recommend chats that have more accounts beyond what was provided. The
                      // user doesn't need to autocomplete chats with a subset of what they
                      // already selected.
                      filterIterable(
                          sharedChats,
                          sharedChat =>
                              sharedChat.accountCount > sharedChat.includedOtherAccountIds.length,
                      ),
                      0,
                      10,
                  ),
                  sharedChat => getChat(context, sharedChat.id),
              )
            : [];

    const [recommendedChats, exactMatch] = await runAllPromises([
        runAllPromises(recommendedChatPromises),
        (async () => {
            if (!exactMatchChatId) return null;
            const chat = await getChat(context, exactMatchChatId);
            if (!chat) return null;

            const {messageCount, messages, otherReferencedMessages, lastMessageChangeTime} =
                await getChatMessagesFromEnd(context, {
                    chatId: chat.id,
                    limit: input.exactMatchInitialMessagesLimit,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                });

            return {
                // Use the latest message count and last message change time.
                chat: chat.clone({messageCount, lastMessageChangeTime}),
                initialMessages: messages,
                initialOtherReferencedMessages: otherReferencedMessages,
            };
        })(),
    ]);

    return {
        exactMatch,
        recommendedChats: recommendedChats.filter(isNonNullable),
    };
});

implementRpc(definition.getChatMessagesFromStart, async (context, input) => {
    return getChatMessagesFromStart(await context.auth.authenticate(), input);
});

implementRpc(definition.getChatMessagesFromEnd, async (context, input) => {
    return getChatMessagesFromEnd(await context.auth.authenticate(), input);
});

implementRpc(definition.sendChatMessage, async (context, input) => {
    return sendChatMessage(await context.auth.authenticate(), input);
});

implementRpc(definition.sendChatMessageToAccounts, async (context, input) => {
    const {chatId} = await sendChatMessageToAccounts(await context.auth.authenticate(), input);

    const chat = await getChat(await context.auth.authenticate(), chatId);
    if (!chat) throw new InternalError("Can't find chat that message was just sent to");

    return {chat};
});

implementRpc(definition.updateChatMessageContent, async (context, input) => {
    return updateChatMessageContent(await context.auth.authenticate(), input);
});

implementRpc(definition.deleteChatMessage, async (context, input) => {
    return deleteChatMessage(await context.auth.authenticate(), input);
});
