import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {convertDirectChatToRoomChat} from "~/server/chat/data/convert_direct_chat_to_room_chat.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {idRegExp} from "~/shared/id/id_reg_exp.js";

const context = createTestContext({
    chatInjection,
});

const server = createTestApiServer(context, apiChatPaths);

describe("POST /chats", () => {
    test("room chat creation is unimplemented and returns the generic API error", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey();

        expect(
            await server.POST("/chats", {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    spaceId: space.id,
                    chat: {
                        type: "Room",
                        name: "Announcements",
                    },
                },
            }),
        ).toEqual({
            status: 500,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message:
                        "An unexpected error occurred, please try again. " +
                        "If the problem continues, let us know at support@alpine.inc",
                    stack: expect.stringMatching(
                        /^UnimplementedError: Creating room chats from the API isn\u2019t implemented yet\n/,
                    ),
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });

    test("fails if actor bot isn't included in members", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey();

        expect(
            await server.POST("/chats", {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    spaceId: space.id,
                    chat: {
                        type: "Direct",
                        members: [
                            {account: {id: session1.account.id}},
                            {account: {id: session2.account.id}},
                        ],
                    },
                },
            }),
        ).toEqual({
            status: 500,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message:
                        "Must include the current bot in `accountIds`. We may add support for " +
                        "creating a chat by `accountIds` that doesn\u2019t include the current bot " +
                        "in the future because bots are allowed to read chats they aren\u2019t in " +
                        "if the chat is within their access scope.",
                    stack: expect.stringMatching(
                        /^UnimplementedError: Getting direct chats that don’t include the bot account isn’t implemented/,
                    ),
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });

    test("creates direct chat with one non-bot member", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session, {name: "Helper Bot"});
        const apiKey = await bot.createApiKey();

        const response = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: [{account: {id: bot.id}}, {account: {id: session.account.id}}],
                },
            },
        });

        expect({
            response,
            memberAccountIds: (response.body.chat.members as Array<{account: {id: string}}>)
                .map(member => member.account.id)
                .sort(),
        }).toEqual({
            response: {
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    spaceId: space.id,
                    chat: expect.objectContaining({
                        type: "Direct",
                        id: expect.stringMatching(idRegExp),
                        members: expect.any(Array),
                        reference: {title: expect.any(String)},
                    }),
                }),
            },
            memberAccountIds: [bot.id, session.account.id].sort(),
        });
    });

    test("creates direct chat with two non-bot members", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1, {name: "Helper Bot"});
        const apiKey = await bot.createApiKey();

        const response = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: [
                        {account: {id: bot.id}},
                        {account: {id: session1.account.id}},
                        {account: {id: session2.account.id}},
                    ],
                },
            },
        });

        expect({
            response,
            memberAccountIds: (response.body.chat.members as Array<{account: {id: string}}>)
                .map(member => member.account.id)
                .sort(),
        }).toEqual({
            response: {
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    spaceId: space.id,
                    chat: expect.objectContaining({
                        type: "Direct",
                        id: expect.stringMatching(idRegExp),
                        members: expect.any(Array),
                        reference: {title: expect.any(String)},
                    }),
                }),
            },
            memberAccountIds: [bot.id, session1.account.id, session2.account.id].sort(),
        });
    });

    test("creates direct chat with five non-bot members", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const otherSessions = await space.createSessions(4);

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey();

        const memberAccountIds = [
            bot.id,
            session.account.id,
            ...otherSessions.map(otherSession => otherSession.account.id),
        ];

        const response = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: memberAccountIds.map(accountId => ({
                        account: {id: accountId},
                    })),
                },
            },
        });

        expect({
            response,
            memberAccountIds: (response.body.chat.members as Array<{account: {id: string}}>)
                .map(member => member.account.id)
                .sort(),
        }).toEqual({
            response: {
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    spaceId: space.id,
                    chat: expect.objectContaining({
                        type: "Direct",
                        id: expect.stringMatching(idRegExp),
                        members: expect.any(Array),
                        reference: {title: expect.any(String)},
                    }),
                }),
            },
            memberAccountIds: memberAccountIds.sort(),
        });
    });

    test("can\u2019t create a direct chat with only bots", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot1 = await TestBot.createAndInstantiate(session);
        const bot2 = await TestBot.createAndInstantiate(session);
        const apiKey = await bot1.createApiKey();

        expect(
            await server.POST("/chats", {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    spaceId: space.id,
                    chat: {
                        type: "Direct",
                        members: [{account: {id: bot1.id}}, {account: {id: bot2.id}}],
                    },
                },
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message:
                        "Can\u2019t create a chat with only bot accounts. " +
                        "Try again but include at least one human account in the chat.",
                    stack: expect.stringMatching(
                        /^PermissionDeniedError: Can’t create a chat with only bot accounts\n/,
                    ),
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });

    test("deduplicates and reuses the same ChatId for repeated direct chat creation", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey();

        const firstResponse = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: [
                        {account: {id: bot.id}},
                        {account: {id: session1.account.id}},
                        {account: {id: session2.account.id}},
                    ],
                },
            },
        });

        const secondResponse = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: [
                        {account: {id: session2.account.id}},
                        {account: {id: bot.id}},
                        {account: {id: session1.account.id}},
                        {account: {id: session2.account.id}},
                        {account: {id: bot.id}},
                    ],
                },
            },
        });

        const firstChatId = firstResponse.body.chat.id;

        expect({
            firstResponse,
            secondResponse,
            firstChatId,
            secondChatId: secondResponse.body.chat.id,
            secondMemberAccountIds: (
                secondResponse.body.chat.members as Array<{account: {id: string}}>
            )
                .map(member => member.account.id)
                .sort(),
        }).toEqual({
            firstResponse: expect.objectContaining({status: 200}),
            secondResponse: expect.objectContaining({status: 200}),
            firstChatId: expect.stringMatching(idRegExp),
            secondChatId: firstChatId,
            secondMemberAccountIds: [bot.id, session1.account.id, session2.account.id].sort(),
        });
    });

    test("creates a new direct ChatId after matching direct chat is converted to room chat", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey();

        const originalResponse = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: [
                        {account: {id: bot.id}},
                        {account: {id: session1.account.id}},
                        {account: {id: session2.account.id}},
                        {account: {id: session3.account.id}},
                    ],
                },
            },
        });

        await convertDirectChatToRoomChat(session1.action(), {
            chatId: originalResponse.body.chat.id,
            name: "Project Room",
        });

        const newResponse = await server.POST("/chats", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                chat: {
                    type: "Direct",
                    members: [
                        {account: {id: bot.id}},
                        {account: {id: session1.account.id}},
                        {account: {id: session2.account.id}},
                        {account: {id: session3.account.id}},
                    ],
                },
            },
        });

        expect(originalResponse.status).toBe(200);
        expect(newResponse.status).toBe(200);
        expect(originalResponse.body.chat.id).not.toEqual(newResponse.body.chat.id);
    });

    test("fails if a member isn\u2019t in the requested space", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession({role: "Admin"});
        const space2 = await TestSpace.create(context);
        const session2 = await space2.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey();

        expect(
            await server.POST("/chats", {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    spaceId: space1.id,
                    chat: {
                        type: "Direct",
                        members: [{account: {id: bot.id}}, {account: {id: session2.account.id}}],
                    },
                },
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "This person doesn\u2019t exist. Try searching \u201Call people\u201D to " +
                        "see who else is here.",
                    retry: {
                        able: false,
                    },
                }),
            },
        });
    });
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
                message: "You don\u2019t have access to this chat.",
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
                message:
                    "This chat doesn\u2019t exist. Try searching \u201Cmy chats\u201D to see " +
                    "chats you\u2019re in.",
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
                message:
                    "Can\u2019t create messages in chat the bot isn\u2019t a member of. " +
                    "Try creating a new chat that includes the bot and send a message to that chat.",
                stack: expect.any(String),
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("can\u2019t send message to chat bot isn\u2019t a member of even when scope grants edit access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session3);

    const chat = await TestChat.get(session2, session3);

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
                message:
                    "Can\u2019t create messages in chat the bot isn\u2019t a member of. " +
                    "Try creating a new chat that includes the bot and send a message to that chat.",
                stack: expect.stringMatching(
                    /^PermissionDeniedError: Bot can only view messages in chat it\u2019s not a member of\n/,
                ),
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
