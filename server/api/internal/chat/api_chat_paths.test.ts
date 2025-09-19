import request from "supertest";
import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {
    testMessagingApiImplementation,
    testMessagingApiImplementationSearchInjection,
} from "~/server/api/internal/test_helpers/test_messaging_api_implementation.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
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

test("can’t send message to chat bot isn’t a member of (but does have read access to)", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);

    const response = await request(server)
        .post(`/chats/${chat.id}/messages`)
        .set("authorization", `bearer ${apiKey}`)
        .send({
            content: {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Hello from API"}],
                    },
                ],
            },
        })
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: expect.objectContaining({
            message: "You don’t have access to this chat.",
        }),
    });
});
