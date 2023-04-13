import {ChatRealtimeConnection} from "~/server/chat/chat_realtime_connection";
import {
    createChatForTest,
    deleteChatMessage,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/dynamo/chat_table";
import {
    TestMessagingRealtimeConnectionProcedures,
    testMessagingRealtimeImplementation,
} from "~/server/dynamo/test_helpers/jest/test_messaging_realtime_implementation";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {generateId} from "~/shared/id/id";
import {ChatId} from "~/shared/id/types/id_types";
import {ChatMessageModel} from "~/shared/models/chat_model";

const context = createTestContext();

type TestChatRealtimeConnection = {
    readonly actualConnection: ChatRealtimeConnection;
    readonly procedures: TestMessagingRealtimeConnectionProcedures<ChatMessageModel>;
};

testMessagingRealtimeImplementation<ChatId, TestChatRealtimeConnection>(context, {
    async createRoom(context, spaceId, sessions) {
        const chat = await createChatForTest(context, {
            spaceId,
            otherAccountIds: sessions.map(session => session.accountId),
        });

        return {
            key: chat.id,
            spaceId,
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
    async createMessage(context, {roomKey: chatId, parentMessageIndex, content}) {
        const message = await sendChatMessage(context, {
            chatId,
            parentMessageIndex,
            content,
        });

        return {
            index: message.index,
            createdTime: message.createdTime,
        };
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
