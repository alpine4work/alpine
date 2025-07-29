import {createChatForTest} from "~/server/chat/data/chat_table.js";
import {ChatRealtimeConnection} from "~/server/chat/realtime/chat_realtime_connection.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {
    TestMessagingRealtimeConnectionProcedures,
    testMessagingRealtimeImplementation,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {
    deleteChatMessage,
    sendChatMessage,
    updateChatMessageContent,
} from "~/shared/rpc/chat_rpc_definitions.js";

const context = createTestWorkerContext();

type TestChatRealtimeConnection = {
    readonly actualConnection: ChatRealtimeConnection;
    readonly procedures: TestMessagingRealtimeConnectionProcedures<ChatMessageModel>;
};

testMessagingRealtimeImplementation<ChatId, TestChatRealtimeConnection>(context, {
    async createRoom(context, space, sessions) {
        const chat = await createChatForTest(context, {
            spaceId: space.id,
            otherAccountIds: sessions.map(session => session.account.id),
        });

        return {
            key: chat.id,
            spaceId: space.id,
            createdTime: chat.createdTime,
            messageCount: 0,
        };
    },
    createRealtimeConnection({
        spaceId,
        roomKey: chatId,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }) {
        const connection = new ChatRealtimeConnection({
            connectionId: generateId(),
            spaceId,
            chatId,
            sendEvent,
            sendEventToOthers,
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection.actualConnection),
        });

        return {
            actualConnection: connection,
            procedures: connection.procedures,
        };
    },
    createMessageModel({roomKey: chatId, index, createdTime, author, payload}) {
        return new ChatMessageModel({
            chatId,
            index,
            createdTime,
            author,
            payload,
        });
    },
    async createMessage(context, {roomKey: chatId, parentMessageIndex, content, fileIds}) {
        const {message} = await sendChatMessage(context, {
            chatId,
            parentMessageIndex,
            content,
            fileIds,
        });

        return message;
    },
    async updateMessageContent(context, {roomKey: chatId, messageIndex, content}) {
        return updateChatMessageContent(context, {
            chatId,
            messageIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: chatId, messageIndex}) {
        return deleteChatMessage(context, {chatId, messageIndex});
    },
});
