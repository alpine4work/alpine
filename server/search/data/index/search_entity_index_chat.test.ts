import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    searchByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

let indexSearchEntityJobCount = 0;

beforeEach(() => {
    indexSearchEntityJobCount = 0;
});

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime, span) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                if (job.update.type !== "Account") {
                    indexSearchEntityJobCount++;
                }

                await processIndexSearchEntityJob(actionContext, job, jobStartTime, span);
                break;
            }
            case "IndexSearchEntityDependents": {
                await processIndexSearchEntityDependentsJob(actionContext, job);
                break;
            }
            case "IndexSearchEntityEmbeddingChunks": {
                await processIndexSearchEntityEmbeddingChunksJob(actionContext, job);
                break;
            }
            default: {
                // Ignore all other jobs...
                break;
            }
        }
    },
});

test("will not index chat until first message is sent", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Test 1"});
    const session2 = await space.createSession({name: "Test 2"});
    const session3 = await space.createSession({name: "Test 3"});

    const chat = await TestChat.get(session1, session2, session3);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(0);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([]);

    await chat.sendMessage(session2, "Message 1");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(2);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chat.id}`]);

    await chat.sendMessage(session3, "Message 2");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(3);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chat.id}`]);

    await chat.sendMessage(session1, "Message 3");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(4);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chat.id}`]);
});

test("will not make chat searchable even if manually indexed until first message is sent", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Test 1"});
    const session2 = await space.createSession({name: "Test 2"});
    const session3 = await space.createSession({name: "Test 3"});

    const chat = await TestChat.get(session1, session2, session3);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(0);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([]);

    await processIndexSearchEntityJob(
        space.systemAction(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Chat",
                chatId: chat.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {addData: () => {}},
    );

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(0);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([]);

    await chat.sendMessage(session2, "Message 1");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(2);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chat.id}`]);

    await chat.sendMessage(session3, "Message 2");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(3);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chat.id}`]);

    await chat.sendMessage(session1, "Message 3");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(4);

    expect(
        (
            await searchByKeywords(session1.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        )
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chat.id}`]);
});
