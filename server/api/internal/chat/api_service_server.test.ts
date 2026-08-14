// Generic tests for `api_service_server.ts`. Needs to be in the package
// `//server/api/internal/chat` since we need access to some API path
// implementations to test the service properly.

import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {generateApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.open_source.js";

const context = createTestContext({
    chatInjection,
});

const server = createTestApiServer(context, apiChatPaths);

test("not found route", async () => {
    expect(await server.GET("/asdf")).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {error: {message: "Path not found.", retry: {able: false}}},
    });
});

test("not found route returns JSON without accept header", async () => {
    expect(await server.GET("/asdf", {unsetHeaders: ["accept"]})).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {error: {message: "Path not found.", retry: {able: false}}},
    });
});

test("not found route returns JSON with wildcard accept header", async () => {
    expect(
        await server.GET("/asdf", {
            headers: {accept: "*/*"},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {error: {message: "Path not found.", retry: {able: false}}},
    });
});

test("redirects favicon request", async () => {
    expect(await server.GET("/favicon.ico")).toEqual({
        status: 301,
        headers: expect.objectContaining({location: "https://test.cyberworlds.dev/favicon.ico"}),
        body: "",
    });

    expect(await server.GET("/favicon.svg")).toEqual({
        status: 301,
        headers: expect.objectContaining({location: "https://test.cyberworlds.dev/favicon.svg"}),
        body: "",
    });
});

test("serves the final API specification", async () => {
    const response = await server.GET("/specification.yaml", {unsetHeaders: ["accept"]});

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/yaml"}),
        body: expect.stringContaining("openapi: 3.0.0"),
    });
});

describe("Alpine-Version header", () => {
    beforeEach(() => {
        import.meta.jest.useFakeTimers();
        import.meta.jest.setSystemTime(new Date("2026-07-29T02:00:00.000Z"));
    });

    afterEach(() => {
        import.meta.jest.useRealTimers();
    });

    test("is required", async () => {
        expect(
            await server.GET(`/chats/${generateId()}/messages/0`, {
                unsetHeaders: ["Alpine-Version"],
            }),
        ).toMatchObject({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message: expect.stringMatching(/^Missing `Alpine-Version` header\./),
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });

    test("recommends using today\u2019s date in the default time zone", async () => {
        expect(
            await server.GET(`/chats/${generateId()}/messages/0`, {
                unsetHeaders: ["Alpine-Version"],
            }),
        ).toMatchObject({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message:
                        "Missing `Alpine-Version` header. When starting a new project, you should set the `Alpine-Version` header to today\u2019s date: `2026-07-28`. Don\u2019t dynamically compute the `Alpine-Version` header from today\u2019s date or your code may be broken by backwards incompatible API changes.",
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });

    test("allows one date in the future but not two", async () => {
        const allowedResponse = await server.GET(`/chats/${generateId()}/messages/0`, {
            headers: {"Alpine-Version": "2026-07-29"},
        });
        const rejectedResponse = await server.GET(`/chats/${generateId()}/messages/0`, {
            headers: {"Alpine-Version": "2026-07-30"},
        });

        expect([allowedResponse, rejectedResponse]).toMatchObject([
            {
                status: 401,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: {
                        message: "Missing `Authorization` header.",
                        retry: {
                            able: false,
                        },
                    },
                },
            },
            {
                status: 400,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: {
                        message:
                            "Can\u2019t set the `Alpine-Version` header to a future date. When starting a new project, you should set the `Alpine-Version` header to today\u2019s date: `2026-07-28`. Don\u2019t dynamically compute the `Alpine-Version` header from today\u2019s date or your code may be broken by backwards incompatible API changes.",
                        retry: {
                            able: false,
                        },
                    },
                },
            },
        ]);
    });
});

test("requires authorization header", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(await server.GET(`/chats/${chat.id}/messages/${message.index}`)).toEqual({
        status: 401,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Missing `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("requires bearer scheme in authorization header", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {
                authorization: "basic YWxhZGRpbjpvcGVuc2VzYW1l",
            },
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Expected `Authorization` header to have `Bearer` authentication scheme.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("requires authorization header to have proper API key", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: "bearer asdf"},
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Incorrectly formatted API key in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("requires authorization header to have proper API key (an `Id` doesn\u2019t work)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateId()}`},
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Incorrectly formatted API key in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("rejects improperly formatted access token", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateApiKey()}~asdf`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Invalid access token in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("rejects access token for the wrong service", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const accessToken = await server.jobQueueTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "ChatRealtimeService",
        {
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        },
    );

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateApiKey()}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Access token in `Authorization` header has an incorrect audience.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("rejects expired access token", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const accessToken = await server.jobQueueTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "ApiService",
        {
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        },
        {currentTimeForTest: new Date(Date.now() - 1000 * 60 * 60 * 24)},
    );

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateApiKey()}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Access token in `Authorization` header has expired.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("rejects non-bot token payload", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const accessToken = await server.jobQueueTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "ApiService",
        {
            type: "System",
            spaceId: space.id,
        },
    );

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateApiKey()}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Expected bot access token in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

// This also tests that a short lived token is considered valid if all the claims +
// signatures are correct.
test("rejects unknown API key (with short lived token)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const accessToken = await server.jobQueueTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "ApiService",
        {
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        },
    );

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateApiKey()}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Unrecognized API key in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("rejects unknown API key", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const accessToken =
        await server.jobQueueTokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook({
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        });

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${generateApiKey()}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Unrecognized API key in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("doesn\u2019t allow an unscoped API key without an access token", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createUnscopedApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Missing access token for unscoped API key in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("doesn\u2019t allow a scoped API key with an access token", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    const accessToken =
        await server.jobQueueTokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook({
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        });

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message:
                    "Can\u2019t have both an access token and a scoped API key in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("doesn\u2019t allow non-bot account in access token", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createUnscopedApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    const accessToken =
        await server.jobQueueTokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook({
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        });

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message:
                    "Access token bot account isn\u2019t an instantiation of the API key bot in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("doesn\u2019t allow mismatched bot between API key and access token", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot1 = await TestBot.createAndInstantiate(session1);
    const bot2 = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot1.createUnscopedApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    const accessToken =
        await server.jobQueueTokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook({
            type: "Bot",
            spaceId: space.id,
            accountId: bot2.id,
            scope: {type: "Chat", chatId: chat.id},
        });

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message:
                    "Access token bot account isn\u2019t an instantiation of the API key bot in `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("rejects request from removed bot account", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createUnscopedApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    await space.removeAccount(bot);

    const accessToken =
        await server.jobQueueTokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook({
            type: "Bot",
            spaceId: space.id,
            accountId: bot.id,
            scope: {type: "Chat", chatId: chat.id},
        });

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}~${accessToken}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Bot account was removed from space.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("can read message in chat with unscoped API key", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createUnscopedApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    const accessToken =
        await server.jobQueueTokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook({
            type: "Bot",
            spaceId: space.id,
            accountId: bot.id,
            scope: {type: "Chat", chatId: chat.id},
        });

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}~${accessToken}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            message: expect.objectContaining({
                index: 0,
                payload: expect.objectContaining({type: "Content"}),
            }),
        }),
    });
});

test("can read message in chat", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            message: expect.objectContaining({
                index: 0,
                payload: expect.objectContaining({type: "Content"}),
            }),
        }),
    });
});

test("can\u2019t use unsupported method", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.POST(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 405,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "`POST` method isn\u2019t supported, try `GET`.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("validates response with schema in tests", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(
            `/chats/${chat.id}/messages/${message.index}?test-additional-property=foo`,
            {headers: {authorization: `bearer ${apiKey}`}},
        ),
    ).toEqual({
        status: 500,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message:
                    "An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc",
                stack: expect.stringMatching(
                    /^InternalError: Response schema validation failed: must NOT have additional properties\n/,
                ),
                // TODO(ifitzsimmons, #ai): This should be false since there is a display message.
                // Also, shouldn't this be a 400 BadRequest?
                //
                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/3419z2bttnps1q7cqg5w5tyntg
                retry: {
                    able: true,
                },
            },
        },
    });
});

test.each(["top-level", "nested", "array", "union"])(
    "validates response object property order in tests (%s)",
    async testPropertyOrder => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const chat = await TestChat.get(session1, session2);
        const message = await chat.sendMessage(session1, "Hello, world!");

        expect(
            await server.GET(
                `/chats/${chat.id}/messages/${message.index}?test-property-order=${testPropertyOrder}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            ),
        ).toEqual({
            status: 500,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message:
                        "An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc",
                    stack: expect.stringMatching(
                        /^InternalError: Response schema validation failed: must list `.+` before `.+`\n/,
                    ),
                    retry: {
                        able: true,
                    },
                },
            },
        });
    },
);

test("path param that doesn\u2019t match pattern", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/abc/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Invalid `id` path parameter.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("integer path param that\u2019s not a number", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/abc`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Invalid `index` path parameter.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("responds with pretty HTML if asked", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {authorization: `bearer ${apiKey}`, accept: "text/html"},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "text/html"}),
        body: expect.stringContaining(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;spaceId&quot;</span>: <span class="tok-string">&quot;${space.id}&quot;</span>`),
    });
});

test("responds to representative browser `Accept` header with pretty HTML", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {
                authorization: `bearer ${apiKey}`,
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            },
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "text/html"}),
        body: expect.stringContaining(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;spaceId&quot;</span>: <span class="tok-string">&quot;${space.id}&quot;</span>`),
    });
});

test("responds with pretty HTML if asked using authorization cookie", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {
                cookie: `authorization=${encodeURIComponent(`bearer ${apiKey}`)}`,
                accept: "text/html",
            },
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "text/html"}),
        body: expect.stringContaining(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;spaceId&quot;</span>: <span class="tok-string">&quot;${space.id}&quot;</span>`),
    });
});

test("responds with pretty HTML with error if authorization header is invalid", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {
                cookie: `authorization=${encodeURIComponent(apiKey)}`,
                accept: "text/html",
            },
        }),
    ).toEqual({
        status: 400,
        headers: expect.objectContaining({"content-type": "text/html"}),
        body: expect.stringContaining(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;error&quot;</span>: <span class="tok-punctuation">{</span>`),
    });
});

test("doesn\u2019t use authorization cookie if request isn\u2019t an HTML request", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    expect(
        await server.GET(`/chats/${chat.id}/messages/${message.index}`, {
            headers: {cookie: `authorization=${encodeURIComponent(`bearer ${apiKey}`)}`},
        }),
    ).toEqual({
        status: 401,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Missing `Authorization` header.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("invalid request body throws a validation error", async () => {
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
                            type: "InvalidType",
                            elements: [],
                        },
                    ],
                },
            },
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Invalid request body (path: `#/content/elements/0/type`).",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("can read messages", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);
    const apiKey = await botAccount.createApiKey(session);

    const chat = await TestChat.get(session, botAccount);

    const message = await chat.sendMessage(session, "Hello, world!");

    const response = await server.GET(`/chats/${chat.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            messages: [
                expect.objectContaining({
                    index: message.index,
                    payload: expect.objectContaining({type: "Content"}),
                }),
            ],
        }),
    });

    expect(printApiContentToMarkdown(response.body.messages[0].payload.content)).toEqual(
        "Hello, world!\n",
    );
});

test("can\u2019t read message with invalid string query parameter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);
    const apiKey = await botAccount.createApiKey(session);

    const chat = await TestChat.get(session, botAccount);

    await chat.sendMessage(session, "Hello, world!");

    expect(
        await server.GET(`/chats/${chat.id}/messages?from=nope`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Invalid `from` query parameter.",
                retry: {
                    able: false,
                },
            },
        },
    });
});

test("can\u2019t read message with invalid integer query parameter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);
    const apiKey = await botAccount.createApiKey(session);

    const chat = await TestChat.get(session, botAccount);

    await chat.sendMessage(session, "Hello, world!");

    expect(
        await server.GET(`/chats/${chat.id}/messages?limit=0`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({
        status: 400,
        headers: {"content-type": "application/json"},
        body: {
            error: {
                message: "Invalid `limit` query parameter.",
                retry: {
                    able: false,
                },
            },
        },
    });
});
