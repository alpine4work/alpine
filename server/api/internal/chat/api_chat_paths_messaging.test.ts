import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {
    testMessagingApiImplementation,
    testMessagingApiImplementationSearchInjection,
} from "~/server/api/internal/test_helpers/test_messaging_api_implementation.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
    searchInjection: testMessagingApiImplementationSearchInjection,
});

const server = createTestApiServer(context, apiChatPaths);

testMessagingApiImplementation(context, server, {
    generateMissingRoomPath: () => `/chats/${generateId<ChatId>()}`,
    createPrivateRoom: async (session, botAccount) => {
        const chat = await TestChat.get(session, botAccount);
        return {roomPath: `/chats/${chat.id}`, room: chat, initialMessageCount: 0};
    },
});
