// Generic tests for `api_service_server.ts`. Needs to be in the package
// `//server/api/internal/chat` since we need access to some API path
// implementations to test the service properly.

import request from "supertest";
import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgent} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {generateApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    chatInjection,
});

const server = createTestApiServer(context, apiChatPaths);

let appTokenAgent: TokenAgent;

beforeAll(async () => {
    appTokenAgent = await createTestTokenAgent(context, "AppService");
});

test("not found route", async () => {
    const response = await request(server)
        .get("/asdf")
        .expect("content-type", "application/json")
        .expect(404);

    expect(response.body).toEqual({error: {message: "Path not found."}});
});

test("redirects favicon request", async () => {
    {
        await request(server)
            .get("/favicon.ico")
            .expect("location", "https://test.alpine.inc/favicon.ico")
            .expect(301);
    }

    {
        await request(server)
            .get("/favicon.svg")
            .expect("location", "https://test.alpine.inc/favicon.svg")
            .expect(301);
    }
});

test("requires authorization header", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .expect("content-type", "application/json")
        .expect(401);

    expect(response.body).toEqual({
        error: {
            message: "Missing `Authorization` header.",
        },
    });
});

test("requires bearer scheme in authorization header", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", "basic YWxhZGRpbjpvcGVuc2VzYW1l")
        .expect("content-type", "application/json")
        .expect(400);

    expect(response.body).toEqual({
        error: {
            message: "Expected `Authorization` header to have `Bearer` authentication scheme.",
        },
    });
});

test("requires authorization header to have proper API key", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", "bearer asdf")
        .expect("content-type", "application/json")
        .expect(400);

    expect(response.body).toEqual({
        error: {
            message: "Incorrectly formatted API key in `Authorization` header.",
        },
    });
});

test("requires authorization header to have proper API key (an `Id` doesn’t work)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateId()}`)
        .expect("content-type", "application/json")
        .expect(400);

    expect(response.body).toEqual({
        error: {
            message: "Incorrectly formatted API key in `Authorization` header.",
        },
    });
});

test("rejects improperly formatted access token", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~asdf`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Invalid access token in `Authorization` header.",
        },
    });
});

test("rejects access token from the wrong service", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const accessToken = await appTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "ApiService",
        {
            type: "Bot",
            spaceId: space.id,
            accountId: session1.account.id,
            scope: {type: "Chat", chatId: chat.id},
        },
    );

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Access token in `Authorization` header failed signature verification.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Access token in `Authorization` header has an incorrect audience.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Access token in `Authorization` header has expired.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Expected bot access token in `Authorization` header.",
        },
    });
});

// This also tests that a short lived token is considered valid if all the
// claims + signatures are correct.
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Unrecognized API key in `Authorization` header.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${generateApiKey()}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Unrecognized API key in `Authorization` header.",
        },
    });
});

test("doesn’t allow an unscoped API key without an access token", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createUnscopedApiKey();

    const chat = await TestChat.get(session2, session3);
    const message = await chat.sendMessage(session2);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Missing access token for unscoped API key in `Authorization` header.",
        },
    });
});

test("doesn’t allow a scoped API key with an access token", async () => {
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message:
                "Can’t have both an access token and a scoped API key in `Authorization` header.",
        },
    });
});

test("doesn’t allow non-bot account in access token", async () => {
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message:
                "Access token bot account isn’t an instantiation of the API key bot in `Authorization` header.",
        },
    });
});

test("doesn’t allow mismatched bot between API key and access token", async () => {
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message:
                "Access token bot account isn’t an instantiation of the API key bot in `Authorization` header.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(403);

    expect(response.body).toEqual({
        error: {
            message: "Bot account was removed from space.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}~${accessToken}`)
        .expect("content-type", "application/json")
        .expect(200);

    expect(response.body).toEqual(
        expect.objectContaining({
            roomPath: `/chats/${chat.id}`,
            index: 0,
            payload: expect.objectContaining({type: "Content"}),
        }),
    );
});

test("can read message in chat", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(200);

    expect(response.body).toEqual(
        expect.objectContaining({
            roomPath: `/chats/${chat.id}`,
            index: 0,
            payload: expect.objectContaining({type: "Content"}),
        }),
    );
});

test("can’t use unsupported method", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .post(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(405);

    expect(response.body).toEqual({
        error: {message: "`POST` method isn’t supported, try `GET`."},
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}?test-additional-property=foo`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(500);

    expect(response.body).toEqual({
        error: {
            message:
                "An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc",
            stack: expect.stringMatching(
                /^InternalError: Response schema validation failed: must NOT have additional properties\n/,
            ),
        },
    });
});

test("path param that doesn’t match pattern", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/abc/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(400);

    expect(response.body).toEqual({
        error: {
            message: "Invalid `id` path parameter.",
        },
    });
});

test("integer path param that’s not a number", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/abc`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(400);

    expect(response.body).toEqual({
        error: {
            message: "Invalid `index` path parameter.",
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

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("authorization", `bearer ${apiKey}`)
        .set("accept", "text/html")
        .expect("content-type", "text/html")
        .expect(200);

    /* eslint-disable string-quotes */

    expect(response.text).toContain(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;roomPath&quot;</span>: <span class="tok-string">&quot;/chats/${chat.id}&quot;</span>`);

    /* eslint-enable string-quotes */
});

test("responds with pretty HTML if asked using authorization cookie", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("cookie", `authorization=${encodeURIComponent(`bearer ${apiKey}`)}`)
        .set("accept", "text/html")
        .expect("content-type", "text/html")
        .expect(200);

    /* eslint-disable string-quotes */

    expect(response.text).toContain(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;roomPath&quot;</span>: <span class="tok-string">&quot;/chats/${chat.id}&quot;</span>`);

    /* eslint-enable string-quotes */
});

test("responds with pretty HTML with error if authorization header is invalid", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("cookie", `authorization=${encodeURIComponent(apiKey)}`)
        .set("accept", "text/html")
        .expect("content-type", "text/html")
        .expect(400);

    /* eslint-disable string-quotes */

    expect(response.text).toContain(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;error&quot;</span>: <span class="tok-punctuation">{</span>`);

    /* eslint-enable string-quotes */
});

test("doesn’t use authorization cookie if request isn’t an HTML request", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/${message.index}`)
        .set("cookie", `authorization=${encodeURIComponent(`bearer ${apiKey}`)}`)
        .expect("content-type", "application/json")
        .expect(401);

    expect(response.body).toEqual({
        error: {
            message: "Missing `Authorization` header.",
        },
    });
});
