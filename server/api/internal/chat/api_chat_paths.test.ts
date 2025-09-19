import request from "supertest";
import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    chatInjection,
});

const server = createTestApiServer(context, apiChatPaths);

test("can read message in chat", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const chat = await TestChat.get(session1, session2);
    await chat.sendMessage(session1);

    const response = await request(server)
        .get(`/chats/${chat.id}/messages/0`)
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
