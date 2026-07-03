import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {ApiOperation200JsonResponseType} from "~/server/api/internal/shared/api_paths_type.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ApiContentKeyDecoder} from "~/shared/api/content/api_content_key.js";
import {MessageContentProsemirrorSchema} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
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

test("message content keys use content version instead of update lock version", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session1);
    const chat = await TestChat.get(session1, bot);
    const apiKey = await bot.createApiKey({type: "Chat", chatId: chat.id});

    const message = await chat.sendMessage(session1, "Original");
    await message.updateContent(session1, "Edited");
    await message.setReaction(session1);

    const response = await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: {
                payload: {
                    type: "Content",
                    content: {
                        elements: [{key: expect.any(String)}],
                    },
                },
            },
        },
    });

    const body: ApiOperation200JsonResponseType<"/chats/{id}/messages/{index}", "get"> =
        response.body;

    assert(body.message.payload.type === "Content");
    const firstElement = body.message.payload.content.elements[0];
    assert(firstElement?.type === "Paragraph");
    assert(firstElement.key !== undefined);

    const key = firstElement.key;
    const decoder = new ApiContentKeyDecoder(`ChatMessage:${chat.id}-${message.index}`);

    expect(decoder.decode(key).version).toBe(1);
});

test("stream message content keys use version zero and merged content positions", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const chat = await TestChat.get(session, bot);
    const apiKey = await bot.createApiKey({type: "Chat", chatId: chat.id});

    const messageResponse = await server.POST(`/chats/${chat.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            isStream: true,
            content: {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Base"}],
                    },
                ],
            },
        },
    });

    expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

    const messageIndex = messageResponse.body.message.index;

    await server.POST(`/chats/${chat.id}/messages/${messageIndex}/stream/parts`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Part 1"}],
                        },
                    ],
                },
            },
        },
    });

    await server.POST(`/chats/${chat.id}/messages/${messageIndex}/stream/parts`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Part 2"}],
                        },
                    ],
                },
            },
        },
    });

    const response = await server.GET(`/chats/${chat.id}/messages/${messageIndex}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: {
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {key: expect.any(String)},
                            {key: expect.any(String)},
                            {key: expect.any(String)},
                        ],
                    },
                },
            },
        },
    });

    const body: ApiOperation200JsonResponseType<"/chats/{id}/messages/{index}", "get"> =
        response.body;

    assert(body.message.payload.type === "Content");
    const [baseElement, part1Element, part2Element] = body.message.payload.content.elements;
    assert(baseElement?.type === "Paragraph");
    assert(baseElement.key !== undefined);
    assert(part1Element?.type === "Paragraph");
    assert(part1Element.key !== undefined);
    assert(part2Element?.type === "Paragraph");
    assert(part2Element.key !== undefined);

    const baseNode = MessageContentProsemirrorSchema.node("paragraph", {}, [
        MessageContentProsemirrorSchema.text("Base"),
    ]);
    const part1Node = MessageContentProsemirrorSchema.node("paragraph", {}, [
        MessageContentProsemirrorSchema.text("Part 1"),
    ]);
    const part2Node = MessageContentProsemirrorSchema.node("paragraph", {}, [
        MessageContentProsemirrorSchema.text("Part 2"),
    ]);
    const decoder = new ApiContentKeyDecoder(`ChatMessage:${chat.id}-${messageIndex}`);

    expect([
        decoder.decode(baseElement.key),
        decoder.decode(part1Element.key),
        decoder.decode(part2Element.key),
    ]).toEqual([
        {version: 0, pos: 0, nodeSize: baseNode.nodeSize},
        {version: 0, pos: baseNode.nodeSize, nodeSize: part1Node.nodeSize},
        {
            version: 0,
            pos: baseNode.nodeSize + part1Node.nodeSize,
            nodeSize: part2Node.nodeSize,
        },
    ]);
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
