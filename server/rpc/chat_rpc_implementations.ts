import {
    authorizeChatAccess,
    backfillChatMessages,
    deleteChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/chat/data/chat_table.js";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definition from "~/shared/rpc/chat_rpc_definitions.js";

implementRpc(definition.getChatMessagesFromStart, {visibility: ["AppClient"]}, (context, input) => {
    return getChatMessagesFromStart(context.actor.authorizeSession(), input);
});

implementRpc(definition.getChatMessagesFromEnd, {visibility: ["AppClient"]}, (context, input) => {
    return getChatMessagesFromEnd(context.actor.authorizeSession(), input);
});

implementRpc(
    definition.authorizeChatAccess,
    {visibility: ["ChatRealtimeService"]},
    async (context, input) => {
        const {spaceId} = await authorizeChatAccess(context.actor.authorizeSession(), input.chatId);
        return {spaceId};
    },
);

implementRpc(
    definition.sendChatMessage,
    {visibility: ["ChatRealtimeService"]},
    async (unknownContext, input) => {
        const context = unknownContext.actor.authorizeSession();

        const [{index, createdTime}, [author, contentReferences]] = await runAllPromises([
            sendChatMessage(context, input),
            authorizeChatAccess(context, input.chatId).then(({spaceId}) =>
                runAllPromises([
                    getAccount(context, spaceId, context.actor.getAccountId()),
                    getContentReferencesForNode(context, spaceId, input.content),
                ]),
            ),
        ]);

        const message = new ChatMessageModel({
            chatId: input.chatId,
            index,
            createdTime,
            author,
            payload: {
                type: "Content",
                parentMessageIndex: input.parentMessageIndex,
                content: {
                    doc: input.content,
                    references: contentReferences,
                },
                contentUpdatedTime: null,
            },
        });

        return {message};
    },
);

implementRpc(
    definition.updateChatMessageContent,
    {visibility: ["ChatRealtimeService"]},
    async (context, input) => {
        const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
            updateChatMessageContent(context.actor.authorizeSession(), input),
            authorizeChatAccess(context.actor.authorizeSession(), input.chatId).then(({spaceId}) =>
                getContentReferencesForNode(context, spaceId, input.content),
            ),
        ]);

        return {contentUpdatedTime, contentReferences};
    },
);

implementRpc(
    definition.deleteChatMessage,
    {visibility: ["ChatRealtimeService"]},
    (context, input) => {
        return deleteChatMessage(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.backfillChatMessages,
    {visibility: ["ChatRealtimeService"]},
    (context, input) => {
        return backfillChatMessages(context.actor.authorizeSession(), input);
    },
);
