import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {
    pingChatMessageStream,
    putChatMessageStreamPart,
    sendChatMessage,
} from "~/server/chat/data/chat_messaging.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {getSearchEntity} from "~/server/search/data/index/internal/get_search_entity.js";
import {
    SearchEntityIdForKeywordIndex,
    fallbackGetSearchEntityBaseIfPossibleTestCounter,
    getSearchEntityIndexesForTest,
    getSearchMentionEntityIfPossible,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    searchByKeywords,
    searchRoomChatsByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {runAllTimersAndWaitForTestTasks} from "~/shared/test_helpers/run_all_timers_and_wait_for_test_tasks.js";

const {SearchEntityKeywordIndex, SearchEntityEmbeddingChunkIndex} = getSearchEntityIndexesForTest();

let indexSearchEntityJobCount = 0;
let disableProcessJob = false;

beforeEach(() => {
    indexSearchEntityJobCount = 0;
    disableProcessJob = false;
});

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime, span) => {
        if (disableProcessJob) return;

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
                await processIndexSearchEntityEmbeddingChunksJob(actionContext, job, span);
                break;
            }
            default: {
                // Ignore all other jobs...
                break;
            }
        }
    },
});

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

// Important that this goes after `createTestContext()` which will register
// `afterEach` hooks that clean up some timers (specifically `TestLocalJobSender`
// which cleans up any delayed jobs).
afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

const longMessageSuffix =
    "This message contains enough tokens to ensure we generate embedding chunks for search indexing logic in room chat tests by adding extra words until the minimum token threshold is exceeded.";

async function runAllTimersAndWaitForTestTasksThenRefreshIndexes() {
    await runAllTimersAndWaitForTestTasks();

    await runAllPromises([
        context.opensearch.refresh(SearchEntityKeywordIndex),
        context.opensearch.refresh(SearchEntityEmbeddingChunkIndex),
    ]);
}

async function getSearchEntityTitleFromIndex(
    spaceId: SpaceId,
    entityId: SearchEntityIdForKeywordIndex,
) {
    const doc = await context.opensearch.getDocWithoutSourceIfExists(
        SearchEntityKeywordIndex,
        spaceId,
        entityId,
        {storedFields: ["title"]},
    );

    return doc?.fields.title?.[0] ?? null;
}

async function getSearchEntityEmbeddingChunksFromIndex(
    spaceId: SpaceId,
    entityId: SearchDynamicEntityId,
): Promise<Array<string>> {
    const {hits} = await context.opensearch.searchWithoutSource(
        SearchEntityEmbeddingChunkIndex,
        spaceId,
        {
            size: 100,
            storedFields: ["text"],
            query: {bool: {filter: [{term: {"entity.id": new OpensearchQueryValue(entityId)}}]}},
        },
    );

    return hits.flatMap(hit => hit.fields.text ?? []);
}

async function searchEntityIdsByKeywords(session: TestSpaceSession, queryText: string) {
    return filterMapArray(
        await searchByKeywords(session.action(), {
            spaceId: session.space.id,
            queryText,
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
        result => {
            if (result.id.startsWith("Account:")) return;
            return result.id;
        },
    );
}

async function searchRoomChatIdsByKeywords(
    session: TestSpaceSession,
    queryText: string,
    contributorIds: ReadonlySet<AccountId> = emptySet,
) {
    return filterMapArray(
        await searchRoomChatsByKeywords(session.action(), {
            spaceId: session.space.id,
            queryText,
            limit: 100,
            contributorIds,
        }),
        chat => {
            if (!chat.id.startsWith("Chat:")) return;
            return chat.id.slice(5) as ChatId;
        },
    );
}

test("room chat mention uses fallback when chat has not been indexed", async () => {
    disableProcessJob = true;

    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Room Creator"});
    const session2 = await space.createSession({name: "Room Member"});

    const chat = await TestChat.createRoom(session1, {name: "Fallback Room"});
    await chat.sendMessage(session2, "Room chat message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    const entityId = `Chat:${chat.id}` as const;
    const {getCount} = fallbackGetSearchEntityBaseIfPossibleTestCounter.recordForTest(entityId);

    expect(getCount()).toEqual(0);

    expect(await getSearchMentionEntityIfPossible(session1.action(), space.id, entityId)).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Chat",
            title: "Fallback Room",
            chat: {
                id: chat.id,
                version: expect.any(Number),
                media: {
                    type: "AccountPile",
                    previewAccounts: expect.any(Array),
                    accountCount: null,
                },
            },
        }),
    });

    expect(getCount()).toEqual(1);
});

test("direct chat mention uses fallback when chat has not been indexed", async () => {
    disableProcessJob = true;

    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Actor Alpha"});
    const session2 = await space.createSession({name: "Bravo Beta"});
    const session3 = await space.createSession({name: "Charlie Gamma"});

    const chat = await TestChat.get(session1, session2, session3);
    await chat.sendMessage(session1, "Direct chat message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    const entityId = `Chat:${chat.id}` as const;
    const {getCount} = fallbackGetSearchEntityBaseIfPossibleTestCounter.recordForTest(entityId);

    expect(getCount()).toEqual(0);

    expect(
        await getSearchMentionEntityIfPossible(space.systemAction(), space.id, entityId),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Chat",
            title: expect.stringContaining("other"),
            chat: {
                id: chat.id,
                version: 1,
                media: {
                    type: "AccountPile",
                    previewAccounts: expect.any(Array),
                    accountCount: 3,
                },
            },
        }),
    });

    expect(getCount()).toEqual(1);
});

test("private room chat mention fallback returns private for ungranted accounts", async () => {
    disableProcessJob = true;

    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Private Room Owner"});
    const session2 = await space.createSession({name: "Ungranted Viewer"});

    const chat = await TestChat.createRoom(session1, {
        name: "Private Fallback Room",
        access: "Private",
    });
    await chat.sendMessage(session1, "Room chat message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    const entityId = `Chat:${chat.id}` as const;
    const {getCount} = fallbackGetSearchEntityBaseIfPossibleTestCounter.recordForTest(entityId);

    expect(getCount()).toEqual(0);

    expect(await getSearchMentionEntityIfPossible(session2.action(), space.id, entityId)).toEqual({
        isPrivate: true,
    });

    expect(getCount()).toEqual(1);
});

test("private direct chat mention fallback returns private for ungranted accounts", async () => {
    disableProcessJob = true;

    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Direct Participant 1"});
    const session2 = await space.createSession({name: "Direct Participant 2"});
    const session3 = await space.createSession({name: "Outside Viewer"});

    const chat = await TestChat.get(session1, session2);
    await chat.sendMessage(session1, "Direct chat message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    const entityId = `Chat:${chat.id}` as const;
    const {getCount} = fallbackGetSearchEntityBaseIfPossibleTestCounter.recordForTest(entityId);

    expect(getCount()).toEqual(0);

    expect(await getSearchMentionEntityIfPossible(session3.action(), space.id, entityId)).toEqual({
        isPrivate: true,
    });

    expect(getCount()).toEqual(1);
});

test("room chat search entity title matches the room name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const session2 = await space.createSession({role: "Admin"});
    const session3 = await space.createSession({role: "Admin"});

    const chat = await TestChat.createRoom(session, {name: "Weekly Standup"});
    await chat.sendMessage(session, "First message");
    await chat.sendMessage(session2, "Second message");
    await chat.sendMessage(session3, "Third message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(
        await getSearchMentionEntityIfPossible(session.action(), space.id, `Chat:${chat.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Chat",
            title: "Weekly Standup",
            chat: {
                id: chat.id,
                version: expect.any(Number),
                media: expect.any(Object),
            },
        }),
    });
});

test("direct chat search entity title joins sorted account full names", async () => {
    const space = await TestSpace.create(context);
    // Create sessions out of alphabetical order to confirm the indexed title sorts the
    // account names.
    const session1 = await space.createSession({name: "Charlie Gamma"});
    const session2 = await space.createSession({name: "Alpha Account"});
    const session3 = await space.createSession({name: "Bravo Beta"});

    const chat = await TestChat.get(session1, session2, session3);
    await chat.sendMessage(session1, "First message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(
        await getSearchMentionEntityIfPossible(session1.action(), space.id, `Chat:${chat.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Chat",
            title: expect.stringMatching("(Bravo and Alpha)|(Alpha and Bravo)"),
            chat: {
                id: chat.id,
                version: expect.any(Number),
                media: expect.any(Object),
            },
        }),
    });
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

    await chat.sendMessage(session1, "Message 3");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(6);

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

    await chat.sendMessage(session1, "Message 3");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toEqual(6);

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

test("converting direct chat to room chat reindexes chat and message embeddings", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({name: "Alpha"});
    const sessionB = await space.createSession({name: "Beta"});
    const sessionC = await space.createSession({name: "Gamma"});

    const chat = await TestChat.get(sessionA, sessionB, sessionC);

    const message1 = await chat.sendMessage(sessionA, `Test 1: ${longMessageSuffix}`);
    const message2 = await chat.sendMessage(sessionB, `Test 2: ${longMessageSuffix}`);

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await getSearchEntityTitleFromIndex(space.id, `Chat:${chat.id}`)).toBe(
        "Alpha, Beta, and Gamma",
    );

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message1.index}`,
        ),
    ).toEqual([
        expect.stringMatching("This is a message in a chat between three people:\n\nTest 1:"),
    ]);

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message2.index}`,
        ),
    ).toEqual([
        expect.stringMatching("This is a message in a chat between three people:\n\nTest 2:"),
    ]);

    await chat.convertToRoom(sessionA, "Announcements");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await getSearchEntityTitleFromIndex(space.id, `Chat:${chat.id}`)).toBe("Announcements");

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message1.index}`,
        ),
    ).toEqual([
        expect.stringMatching(
            "This is a message in the \u201CAnnouncements\u201D chat:\n\nTest 1:",
        ),
    ]);

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message2.index}`,
        ),
    ).toEqual([
        expect.stringMatching(
            "This is a message in the \u201CAnnouncements\u201D chat:\n\nTest 2:",
        ),
    ]);
});

test("updating a room chat name reindexes chat and message embeddings", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    let expectedIndexSearchEntityJobCount = 0;

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    const chat = await TestChat.createRoom(session, {
        name: "General",
        access: "Private",
    });
    expectedIndexSearchEntityJobCount++;

    const message1 = await chat.sendMessage(session, `Test 1: ${longMessageSuffix}`);
    expectedIndexSearchEntityJobCount++;

    const message2 = await chat.sendMessage(session, `Test 2: ${longMessageSuffix}`);
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await getSearchEntityTitleFromIndex(space.id, `Chat:${chat.id}`)).toBe("General");

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message1.index}`,
        ),
    ).toEqual([
        expect.stringMatching("This is a message in the \u201CGeneral\u201D chat:\n\nTest 1:"),
    ]);

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message2.index}`,
        ),
    ).toEqual([
        expect.stringMatching("This is a message in the \u201CGeneral\u201D chat:\n\nTest 2:"),
    ]);

    await chat.updateRoomName(session, "Announcements");

    // Reindex `Chat` and two `ChatMessage`s.
    expectedIndexSearchEntityJobCount++;
    expectedIndexSearchEntityJobCount++;
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await getSearchEntityTitleFromIndex(space.id, `Chat:${chat.id}`)).toBe("Announcements");

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message1.index}`,
        ),
    ).toEqual([
        expect.stringMatching(
            "This is a message in the \u201CAnnouncements\u201D chat:\n\nTest 1:",
        ),
    ]);

    expect(
        await getSearchEntityEmbeddingChunksFromIndex(
            space.id,
            `ChatMessage:${chat.id}-${message2.index}`,
        ),
    ).toEqual([
        expect.stringMatching(
            "This is a message in the \u201CAnnouncements\u201D chat:\n\nTest 2:",
        ),
    ]);
});

test("updating a room chat\u2019s access policy reindexes chat messages for new viewers", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const [sessionB, sessionC] = await space.createSessions(2);

    const chat = await TestChat.createRoom(sessionA, {
        name: "Private Room",
        access: "Private",
    });

    const message = await chat.sendMessage(sessionA, "Secret 1");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchEntityIdsByKeywords(sessionA, "Secret 1")).toEqual([
        `ChatMessage:${chat.id}-${message.index}`,
    ]);
    expect(await searchEntityIdsByKeywords(sessionB, "Secret 1")).toEqual([]);
    expect(await searchEntityIdsByKeywords(sessionC, "Secret 1")).toEqual([]);

    await chat.roomAccess.grant(sessionA, sessionB, "Edit");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchEntityIdsByKeywords(sessionA, "Secret 1")).toEqual([
        `ChatMessage:${chat.id}-${message.index}`,
    ]);
    expect(await searchEntityIdsByKeywords(sessionB, "Secret 1")).toEqual([
        `ChatMessage:${chat.id}-${message.index}`,
    ]);
    expect(await searchEntityIdsByKeywords(sessionC, "Secret 1")).toEqual([]);
});

test("sending messages changes major contributor ids of chat without reindexing chat messages", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    let expectedIndexSearchEntityJobCount = 0;

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    const chat = await TestChat.createRoom(session1, {name: "foo"});
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([]);

    await chat.sendMessage(session1, "qux 1");
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([]);

    await chat.sendMessage(session2, "qux 2");
    expectedIndexSearchEntityJobCount++;

    // `contributorId` map changed, `Chat` needs to reindex.
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([]);

    await chat.sendMessage(session1, "qux 3");
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([]);

    await chat.sendMessage(session3, "qux 4");
    expectedIndexSearchEntityJobCount++;

    // `contributorId` map changed, `Chat` needs to reindex.
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([`Chat:${chat.id}`]);

    await chat.sendMessage(session3, "qux 5");
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([`Chat:${chat.id}`]);

    await chat.sendMessage(session3, "qux 5");
    expectedIndexSearchEntityJobCount++;

    // `contributorId` map changed, `Chat` needs to reindex.
    expectedIndexSearchEntityJobCount++;

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(indexSearchEntityJobCount).toEqual(expectedIndexSearchEntityJobCount);

    expect(await searchEntityIdsByKeywords(session1, "my chats")).toEqual([`Chat:${chat.id}`]);
    expect(await searchEntityIdsByKeywords(session2, "my chats")).toEqual([]);
    expect(await searchEntityIdsByKeywords(session3, "my chats")).toEqual([`Chat:${chat.id}`]);
});

test("room chats are searchable by the room tag", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const roomChat = await TestChat.createRoom(session1, {name: "Leadership"});

    const directChat = await TestChat.get(session1, session2);
    await directChat.sendMessage(session1);

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchEntityIdsByKeywords(session1, "room")).toEqual([`Chat:${roomChat.id}`]);
});

test("searchRoomChatsByKeywords hides private room chats from ungranted accounts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const roomChat = await TestChat.createRoom(session1, {
        name: "Private Access Policy",
        access: "Private",
    });
    await roomChat.roomAccess.grant(session1, session2, "View");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session3, "Private Access Policy")).toEqual([]);
});

test("searchRoomChatsByKeywords returns private room chats for granted accounts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const roomChat = await TestChat.createRoom(session1, {
        name: "Private Grant Policy",
        access: "Private",
    });
    await roomChat.roomAccess.grant(session1, session2, "View");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session2, "Private Grant Policy")).toEqual([
        roomChat.id,
    ]);
});

test("searchRoomChatsByKeywords returns public room chats for other space accounts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const roomChat = await TestChat.createRoom(session1, {
        name: "Public Default Grant",
        access: "Public",
    });

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session2, "Public Default Grant")).toEqual([
        roomChat.id,
    ]);
});

test("searchRoomChatsByKeywords supports prefix matching", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const roomChat = await TestChat.createRoom(session, {name: "Bluebird Planning"});

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session, "B")).toEqual([roomChat.id]);
    expect(await searchRoomChatIdsByKeywords(session, "Bl")).toEqual([roomChat.id]);
    expect(await searchRoomChatIdsByKeywords(session, "Blu")).toEqual([roomChat.id]);
    expect(await searchRoomChatIdsByKeywords(session, "Bluebi")).toEqual([roomChat.id]);
});

test("searchRoomChatsByKeywords supports fuzzy matching", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const roomChat = await TestChat.createRoom(session, {name: "Leadership"});

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session, "Leaderahip")).toEqual([roomChat.id]);
});

test("searchRoomChatsByKeywords does not return direct chats", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Orbit Keyword Alpha"});
    const session2 = await space.createSession({name: "Orbit Keyword Beta"});

    const directChat = await TestChat.get(session1, session2);
    await directChat.sendMessage(session1, "Keyword message");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session1, "Keyword")).toEqual([]);
});

test("searchRoomChatsByKeywords works with empty contributorIds", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const roomChat = await TestChat.createRoom(session, {name: "Contributor Empty Case"});

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(await searchRoomChatIdsByKeywords(session, "Contributor Empty Case", emptySet)).toEqual([
        roomChat.id,
    ]);
});

test("searchRoomChatsByKeywords filters with one contributorId", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const matchingRoomChat = await TestChat.createRoom(session1, {name: "Contributor One"});
    const nonMatchingRoomChat = await TestChat.createRoom(session1, {name: "Contributor One"});

    await matchingRoomChat.sendMessage(session2, "Message from contributor two.");
    await nonMatchingRoomChat.sendMessage(session3, "Message from contributor three.");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(
        await searchRoomChatIdsByKeywords(
            session1,
            "Contributor One",
            new Set([session2.account.id]),
        ),
    ).toEqual([matchingRoomChat.id]);
});

test("searchRoomChatsByKeywords filters with two contributorIds", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const matchingRoomChat = await TestChat.createRoom(session1, {name: "Contributor Two"});
    const nonMatchingRoomChat = await TestChat.createRoom(session1, {name: "Contributor Two"});

    await matchingRoomChat.sendMessage(session2, "Message from contributor two.");
    await matchingRoomChat.sendMessage(session3, "Message from contributor three.");
    await nonMatchingRoomChat.sendMessage(session2, "Message from contributor two.");
    await nonMatchingRoomChat.sendMessage(session4, "Message from contributor four.");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(
        await searchRoomChatIdsByKeywords(
            session1,
            "Contributor Two",
            new Set([session2.account.id, session3.account.id]),
        ),
    ).toEqual([matchingRoomChat.id]);
});

test("searchRoomChatsByKeywords filters with five contributorIds", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4, session5, session6] =
        await space.createSessions(6);

    const matchingRoomChat = await TestChat.createRoom(session1, {name: "Contributor Five"});
    const nonMatchingRoomChat = await TestChat.createRoom(session1, {name: "Contributor Five"});

    await matchingRoomChat.sendMessage(session2, "Message from contributor two.");
    await matchingRoomChat.sendMessage(session3, "Message from contributor three.");
    await matchingRoomChat.sendMessage(session4, "Message from contributor four.");
    await matchingRoomChat.sendMessage(session5, "Message from contributor five.");
    await nonMatchingRoomChat.sendMessage(session2, "Message from contributor two.");
    await nonMatchingRoomChat.sendMessage(session3, "Message from contributor three.");
    await nonMatchingRoomChat.sendMessage(session4, "Message from contributor four.");
    await nonMatchingRoomChat.sendMessage(session6, "Message from contributor six.");

    await runAllTimersAndWaitForTestTasksThenRefreshIndexes();

    expect(
        await searchRoomChatIdsByKeywords(
            session1,
            "Contributor Five",
            new Set([
                session1.account.id,
                session2.account.id,
                session3.account.id,
                session4.account.id,
                session5.account.id,
            ]),
        ),
    ).toEqual([matchingRoomChat.id]);
});

test("room chat search entities keep dependency ids tight", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

    const chat = await TestChat.createRoom(session, {
        name: "Dependencies",
        access: "Private",
    });

    const message = await chat.sendMessage(session, "Test 1");

    const chatEntity = await getSearchEntity(
        space.systemAction(),
        {type: "Chat", chatId: chat.id},
        {tokenizer, registerAdditionalWrite: noop},
    );

    expect(Array.from(chatEntity.dependencyIds)).toEqual([]);

    const messageEntity = await getSearchEntity(
        space.systemAction(),
        {type: "ChatMessage", chatId: chat.id, messageIndex: message.index},
        {tokenizer, registerAdditionalWrite: noop},
    );

    expect(Array.from(messageEntity.dependencyIds)).toEqual([`Chat:${chat.id}:Definition`]);
});

test("will index streaming chat message after delay", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);

    const chat = await TestChat.get(session, botAccount);

    await chat.sendMessage(session);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const message = await sendChatMessage(botAccount.action(session), {
        chatId: chat.id,
        parent: null,
        content: createSimpleMessageContent(),
        fileIds: [],
        isStream: true,
        createdTimeZone: defaultTimeZone,
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 0,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 1"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 1,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 2"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 1,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 3"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 2,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 4"),
        },
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    await pingChatMessageStream(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    await pingChatMessageStream(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    await pingChatMessageStream(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-${message.index}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["Part 1\n\nPart 3\n\nPart 4"],
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 2,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 5"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 3,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 6"),
        },
    });

    import.meta.jest.advanceTimersByTime(1 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-${message.index}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["Part 1\n\nPart 3\n\nPart 4"],
        },
    });

    import.meta.jest.advanceTimersByTime(4 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    await pingChatMessageStream(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-${message.index}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["Part 1\n\nPart 3\n\nPart 4"],
        },
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    await pingChatMessageStream(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-${message.index}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["Part 1\n\nPart 3\n\nPart 5\n\nPart 6"],
        },
    });
});

test("will complete streaming chat message with error if not updated after delay", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);

    const chat = await TestChat.get(session, botAccount);

    await chat.sendMessage(session);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const message = await sendChatMessage(botAccount.action(session), {
        chatId: chat.id,
        parent: null,
        content: createSimpleMessageContent(),
        fileIds: [],
        isStream: true,
        createdTimeZone: defaultTimeZone,
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 0,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 1"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 1,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 2"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 1,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 3"),
        },
    });

    await putChatMessageStreamPart(botAccount.action(session), {
        chatId: chat.id,
        messageIndex: message.index,
        partIndex: 2,
        payload: {
            type: "Content",
            content: createSimpleMessageContent("Part 4"),
        },
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-${message.index}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-${message.index}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["Part 1\n\nPart 3\n\nPart 4"],
        },
    });

    await expect(
        putChatMessageStreamPart(botAccount.action(session), {
            chatId: chat.id,
            messageIndex: message.index,
            partIndex: 2,
            payload: {
                type: "Content",
                content: createSimpleMessageContent("Part 5"),
            },
        }),
    ).rejects.toThrow("The stream has already been completed");

    import.meta.jest.advanceTimersToNextTimer();
    await ProcessContextModule.waitForTestTasks();
});
