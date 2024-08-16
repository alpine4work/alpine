import {getOrCreateChatForAccounts, sendChatMessage} from "~/server/chat/data/chat_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    searchByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

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
    processJob: async (actionContext, job, jobStartTime) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                if (job.update.type !== "Account") {
                    indexSearchEntityJobCount++;
                }

                await processIndexSearchEntityJob(actionContext, job, jobStartTime);
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

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([]);

    await sendChatMessage(session2.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent("Message 1"),
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chatId}`]);

    await sendChatMessage(session3.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent("Message 2"),
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chatId}`]);

    await sendChatMessage(session1.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent("Message 3"),
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chatId}`]);
});

test("will not make chat searchable even if manually indexed until first message is sent", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Test 1"});
    const session2 = await space.createSession({name: "Test 2"});
    const session3 = await space.createSession({name: "Test 3"});

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

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
        ).results
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
                chatId,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([]);

    await sendChatMessage(session2.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent("Message 1"),
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chatId}`]);

    await sendChatMessage(session3.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent("Message 2"),
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chatId}`]);

    await sendChatMessage(session1.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent("Message 3"),
    });

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
        ).results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:")),
    ).toEqual([`Chat:${chatId}`]);
});
