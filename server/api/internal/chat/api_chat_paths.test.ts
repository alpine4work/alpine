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

test("can read chat information", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);

    expect(
        await server.GET(`/chats/${chat.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            chat: expect.objectContaining({
                id: chat.id,
                members: expect.arrayContaining([
                    expect.objectContaining({
                        account: expect.objectContaining({
                            id: session1.account.id,
                            name: "Alice Smith",
                        }),
                    }),
                    expect.objectContaining({
                        account: expect.objectContaining({
                            id: session2.account.id,
                            name: "Bob Johnson",
                        }),
                    }),
                ]),
            }),
        }),
    });
});

test("can’t read chat information without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session2, session3);

    expect(
        await server.GET(`/chats/${chat.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You don’t have access"),
            }),
        },
    });
});

test("can’t read chat information for non-existent chat", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/chats/${generateId()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn’t exist"),
            }),
        },
    });
});

test("can’t send message to chat bot isn’t a member of (but does have read access to)", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);

    expect(
        await server.POST(`/chats/${chat.id}/messages`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Hello from API"}],
                        },
                    ],
                },
            },
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "You don\u2019t have access to this chat.",
                stack: expect.any(String),
            },
        },
    });
});

test("can read chat information with chat scope", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const chat = await TestChat.get(session1, session2);
    const apiKey = await bot.createApiKey({type: "Chat", chatId: chat.id});

    expect(
        await server.GET(`/chats/${chat.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            chat: expect.objectContaining({
                id: chat.id,
                members: expect.arrayContaining([
                    expect.objectContaining({
                        account: expect.objectContaining({
                            id: session1.account.id,
                            name: "Alice Smith",
                        }),
                    }),
                    expect.objectContaining({
                        account: expect.objectContaining({
                            id: session2.account.id,
                            name: "Bob Johnson",
                        }),
                    }),
                ]),
            }),
        }),
    });
});
