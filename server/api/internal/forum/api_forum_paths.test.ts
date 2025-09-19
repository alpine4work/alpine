import request from "supertest";
import {apiForumPaths} from "~/server/api/internal/forum/api_forum_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    forumInjection,
});

const server = createTestApiServer(context, apiForumPaths);

test("can read message in post", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session);
    await post.createComment(session);

    const response = await request(server)
        .get(`/posts/${post.id}/messages/0`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(200);

    expect(response.body).toEqual(
        expect.objectContaining({
            roomPath: `/posts/${post.id}`,
            index: 0,
            payload: expect.objectContaining({type: "Content"}),
        }),
    );
});
