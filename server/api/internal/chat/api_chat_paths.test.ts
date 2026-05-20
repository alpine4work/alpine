import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
});

const server = createTestApiServer(context, apiChatPaths);

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
                type: "Direct",
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

test("can\u2019t read chat information without access", async () => {
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
                message: expect.stringMatching("You don\u2019t have access"),
                retry: {
                    able: false,
                },
            }),
        },
    });
});

test("can\u2019t read chat information for non-existent chat", async () => {
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
                message: expect.stringMatching("doesn\u2019t exist"),
                retry: {
                    able: false,
                },
            }),
        },
    });
});

test("can\u2019t send message to chat bot isn\u2019t a member of (but does have read access to)", async () => {
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
                retry: {
                    able: false,
                },
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
                type: "Direct",
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

test("can send chat message with file attachments", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session1);
    const chat = await TestChat.get(session1, bot);
    const apiKey = await bot.createApiKey({type: "Chat", chatId: chat.id});

    // Upload and attach the file to a public document so the bot can access it through
    // the attachment authorizer.
    const file = await TestFile.create(session1);
    const document = await TestDocument.create(session1, {
        title: "Doc with file",
        access: "Public",
    });
    await document.attachFile(session1, file);

    const response = await server.POST(`/chats/${chat.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Message with file"}]},
                ],
            },
            files: [{element: {type: "File", id: file.id}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: expect.objectContaining({
                payload: expect.objectContaining({
                    type: "Content",
                    files: [
                        expect.objectContaining({
                            rowIndex: 0,
                            width: 1,
                            element: {
                                type: "File",
                                id: file.id,
                                contentType: expect.any(String),
                                contentLength: expect.any(Number),
                            },
                        }),
                    ],
                }),
            }),
        },
    });
});

test("chat message with invalid file object returns 400", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session1);
    const chat = await TestChat.get(session1, bot);
    const apiKey = await bot.createApiKey({type: "Chat", chatId: chat.id});

    const response = await server.POST(`/chats/${chat.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [{type: "Paragraph", elements: [{type: "Text", text: "Bad file"}]}],
            },
            files: [{element: {type: "File", id: "not-a-valid-id"}}],
        },
    });

    expect(response).toMatchObject({status: 400});
});
