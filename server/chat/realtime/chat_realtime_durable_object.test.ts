import {createChatForTest, getOrCreateChatForAccounts} from "~/server/chat/data/chat_actions.js";
import {ChatRealtimeDurableObject} from "~/server/chat/realtime/chat_realtime_durable_object.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    testMessagingRealtimeImplementation,
    testMessagingRealtimeImplementationSearchInjection,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {
    deleteChatMessage,
    sendChatMessage,
    updateChatMessageContent,
} from "~/shared/rpc/chat_rpc_definitions.js";

const context = createTestWorkerContext({
    documentsInjection,
    searchInjection: testMessagingRealtimeImplementationSearchInjection,
});
const {connectForTest} = ChatRealtimeDurableObject.test(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not connect to a chat that does not exist", async () => {
    await expect(connectForTest(context.action(session1), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a chat in a different space", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await expect(connectForTest(context.action(otherSession), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing chat durable object in a different space", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await connectForTest(context.action(session1), chatId);

    await expect(connectForTest(context.action(otherSession), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to a chat as an account without access", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await expect(connectForTest(context.action(session3), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing chat durable object as an account without access", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await connectForTest(context.action(session1), chatId);

    await expect(connectForTest(context.action(session3), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

testMessagingRealtimeImplementation<ChatId>(context, {
    async createRoom(sessions) {
        const chat = await createChatForTest(sessions[0].action(), {
            spaceId: sessions[0].space.id,
            otherAccountIds: sessions.slice(1).map(session => session.account.id),
        });

        return {
            key: chat.id,
            spaceId: sessions[0].space.id,
            createdTime: chat.createdTime,
            messageCount: 0,
        };
    },
    async connectForTest(context, roomKey) {
        const connection = await connectForTest(context, roomKey);

        return {
            getConnection: () => connection.connection.getConnectionForTest(),
            procedures: connection.procedures,
            takeEvents: () => connection.takeEvents(),
        };
    },
    createMessageModel({roomKey: chatId, index, createdTime, author, payload}) {
        return new ChatMessageModel({
            chatId,
            index,
            createdTime,
            author,
            payload,
            stream: null,
        });
    },
    createMessage(context, {roomKey: chatId, parentMessageIndex, content, fileIds}) {
        return sendChatMessage(context, {
            chatId,
            parentMessageIndex,
            content,
            fileIds,
        });
    },
    updateMessageContent(context, {roomKey: chatId, messageIndex, content}) {
        return updateChatMessageContent(context, {
            chatId,
            messageIndex,
            content,
        });
    },
    deleteMessage(context, {roomKey: chatId, messageIndex}) {
        return deleteChatMessage(context, {chatId, messageIndex});
    },
});
