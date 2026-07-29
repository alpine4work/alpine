import {apiSpacesPaths} from "~/server/api/internal/spaces/api_spaces_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
} from "~/server/search/data/index/search_entity_index.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runAllTimersAndWaitForTestTasks} from "~/shared/test_helpers/run_all_timers_and_wait_for_test_tasks.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

const context = createTestContext({
    shouldStartOpensearch: true,
    searchInjection,
    processJob: async (actionContext, job, jobStartTime, span) => {
        if (job.type !== "IndexSearchEntity") return;
        await processIndexSearchEntityJob(actionContext, job, jobStartTime, span);
    },
});

beforeAll(() => {
    import.meta.jest.useFakeTimers();
});

const server = createTestApiServer(context, apiSpacesPaths);

test("space search returns bot account title, short name, and bot id", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session, {name: "Zephyr Assistant"});
    const apiKey = await bot.createApiKey(session);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await server.GET(`/spaces/${space.id}/search?query=Zephyr`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            results: [
                {
                    type: "Account",
                    id: bot.id,
                    title: "Zephyr Assistant",
                    titleMatch: [{length: 6, isMatch: true}, {length: 10}],
                    body: null,
                    bodyMatch: null,
                    shortName: "Zephyr",
                    bot: {id: bot.bot.id},
                },
            ],
        },
    });
});

test("space search post title includes its author, channel, and preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Example", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session, {
        name: "Search Channel",
        access: "Public",
    });
    const post = await channel.createPost(session, "Quokka post preview content.");

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await server.GET(`/spaces/${space.id}/search?query=quokka`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({
        status: 200,
        body: {
            results: [
                expect.objectContaining({
                    type: "Post",
                    id: post.id,
                    title: "Alice in Search Channel: Quokka post preview content",
                }),
            ],
        },
    });
});

test("space search defaults to 10 results", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await runAllPromises(
        createArrayWithLength(11, index =>
            space.createSession({name: `Quokka search result ${index}`}),
        ),
    );
    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const response = await server.GET(`/spaces/${space.id}/search?query=quokka`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect({
        status: response.status,
        resultCount: response.body.results.length,
    }).toEqual({
        status: 200,
        resultCount: 10,
    });
});

test("space search accepts the maximum limit of 100", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await runAllPromises(
        createArrayWithLength(101, index =>
            space.createSession({name: `Quokka search result ${index}`}),
        ),
    );
    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const response = await server.GET(`/spaces/${space.id}/search?query=quokka&limit=100`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect({
        status: response.status,
        resultCount: response.body.results.length,
    }).toEqual({
        status: 200,
        resultCount: 100,
    });
});

test("space search rejects limits above 100", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${space.id}/search?query=quokka&limit=101`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 400,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: {
                message: "Invalid `limit` query parameter.",
                retry: {able: false},
            },
        },
    });
});
