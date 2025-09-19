import request from "supertest";
import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";

const context = createTestContext({
    tasksInjection,
});

const server = createTestApiServer(context, apiTasksPaths);

test("can read message in task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session);
    await task.createComment(session);

    const response = await request(server)
        .get(`/tasks/${task.id}/messages/0`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(200);

    expect(response.body).toEqual(
        expect.objectContaining({
            roomPath: `/tasks/${task.id}`,
            index: 0,
            payload: expect.objectContaining({type: "Content"}),
        }),
    );
});
