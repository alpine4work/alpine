import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {updateChannelName} from "~/server/forum/data/update_channel_name.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    fallbackGetSearchEntityBaseIfPossibleTestCounter,
    getSearchEntityIndexesForTest,
    getSearchMentionEntityIfPossible,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    searchByKeywords,
    searchChannelsByAffinity,
    searchChannelsByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {
    assertPostContent,
    createSimplePostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {standardSearchOptions} from "~/shared/search/search_options.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskTitleModel,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";
import {runAllTimersAndWaitForTestTasks} from "~/shared/test_helpers/run_all_timers_and_wait_for_test_tasks.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

let indexSearchEntityJobCount = 0;
let indexSearchEntityDependentsJobCount = 0;

beforeEach(() => {
    indexSearchEntityJobCount = 0;
    indexSearchEntityDependentsJobCount = 0;
});

const indexSearchEntityTestCheckpoint = new TestCheckpoint<SpaceId>();

const context = createTestContext({
    shouldStartOpensearch: true,
    searchInjection,
    spacesInjection,
    tasksInjection,
    processJob: async (actionContext, job, jobStartTime, span) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                await indexSearchEntityTestCheckpoint.waitForTest(job.spaceId);

                if (job.update.type === "Post") {
                    indexSearchEntityJobCount++;
                }

                await processIndexSearchEntityJob(actionContext, job, jobStartTime, span);
                break;
            }
            case "IndexSearchEntityDependents": {
                if (job.update.type === "Post") {
                    indexSearchEntityDependentsJobCount++;
                }

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

test(
    "can search channels by name",
    async () => {
        const names = [
            "Old Man\u2019s War",
            "The Lock Artist",
            "HTML5",
            "Thank You Jeeves",
            "The Code of the Wooster",
            "Right Ho Jeeves",
            "The DaVinci Code",
            "Angels & Demons",
            "The Silmarillion",
            "Syrup",
            "The Lost Symbol",
            "The Book of Lies",
            "Lamb",
            "Fool",
            "Incompetence",
            "Fat",
            "Colony",
            "Backwards, Red Dwarf",
            "The Grand Design",
            "The Book of Samson",
            "The Preservationist",
            "Fallen",
            "Monster 1959",
            "Test Mabc",
            "Test Mxyz",
            "Core Product FY2024Q3",
            "Core Product FY2023Q3",
            "Core Product FY2024Q2",
            "Playground",
        ];

        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();

        for (const name of names) {
            // Make sure created times advance in order.
            import.meta.jest.advanceTimersByTime(1000);

            await runAllPromises([
                TestChannel.create(session, {name}),
                TestChannel.create(otherSession, {name}),
            ]);
        }

        await ProcessContextModule.waitForTestTasks();
        await context.opensearch.refresh(SearchEntityKeywordIndex);

        const testSearch = async (queryText: string) => {
            const results = await searchChannelsByKeywords(testSearchSession.action(), {
                spaceId: testSearchSpace.id,
                queryText,
                limit: 100,
            });

            return results.map(({channel}) => channel.name);
        };

        const runTests = async () => {
            // Testing prefix matching
            expect(await testSearch("inc")).toEqual(["Incompetence"]);
            expect((await testSearch("f")).sort()).toEqual([
                "Core Product FY2023Q3",
                "Core Product FY2024Q2",
                "Core Product FY2024Q3",
                "Fallen",
                "Fat",
                "Fool",
            ]);

            // Testing not first word matching
            expect(await testSearch("jeeves")).toEqual(["Right Ho Jeeves", "Thank You Jeeves"]);

            // Testing not first word prefix matching
            expect(await testSearch("jee")).toEqual(["Right Ho Jeeves", "Thank You Jeeves"]);

            // Testing stop word inclusion
            expect(await testSearch("th")).toEqual([
                "The Preservationist",
                "The Book of Samson",
                "The Grand Design",
                "The Book of Lies",
                "The Lost Symbol",
                "The Silmarillion",
                "The DaVinci Code",
                "The Code of the Wooster",
                "Thank You Jeeves",
                "The Lock Artist",
            ]);
            expect(await testSearch("t")).toEqual([
                "Test Mxyz",
                "Test Mabc",
                "The Preservationist",
                "The Book of Samson",
                "The Grand Design",
                "The Book of Lies",
                "The Lost Symbol",
                "The Silmarillion",
                "The DaVinci Code",
                "The Code of the Wooster",
                "Thank You Jeeves",
                "The Lock Artist",
            ]);
            expect(await testSearch("the")).toEqual([
                "The Preservationist",
                "The Silmarillion",
                "The Code of the Wooster",
                "The Grand Design",
                "The Lost Symbol",
                "The DaVinci Code",
                "The Lock Artist",
                "The Book of Samson",
                "The Book of Lies",
            ]);

            // Testing word position swaps
            expect(await testSearch("Backwards, Red Dwarf")).toEqual(["Backwards, Red Dwarf"]);
            expect(await testSearch("Backwards Red Dwarf")).toEqual(["Backwards, Red Dwarf"]);
            expect(await testSearch("Backwards Dwarf Red")).toEqual(["Backwards, Red Dwarf"]);
            expect(await testSearch("Red Backwards Dwarf")).toEqual(["Backwards, Red Dwarf"]);
            expect(await testSearch("Dwarf Red Backwards")).toEqual(["Backwards, Red Dwarf"]);
            expect(await testSearch("thank jeeves")).toEqual([
                "Thank You Jeeves",
                "Right Ho Jeeves",
            ]);
            expect(await testSearch("jeeves thank")).toEqual([
                "Thank You Jeeves",
                "Right Ho Jeeves",
            ]);
            expect(await testSearch("jeeves thank you")).toEqual([
                "Thank You Jeeves",
                "Right Ho Jeeves",
            ]);
            expect(await testSearch("jeeves you thank")).toEqual([
                "Thank You Jeeves",
                "Right Ho Jeeves",
            ]);

            // Testing word in different positions
            expect(await testSearch("code")).toEqual([
                "The DaVinci Code",
                "The Code of the Wooster",
                "Core Product FY2024Q2",
                "Core Product FY2023Q3",
                "Core Product FY2024Q3",
            ]);

            // Testing last word prefix matching
            expect(await testSearch("test")).toEqual(["Test Mxyz", "Test Mabc"]);
            expect(await testSearch("test m")).toEqual([
                "Test Mxyz",
                "Test Mabc",
                "Monster 1959",
                "Old Man\u2019s War",
            ]);
            expect(await testSearch("test ma")).toEqual([
                "Test Mabc",
                "Test Mxyz",
                "Old Man\u2019s War",
            ]);
            expect(await testSearch("test mab")).toEqual([
                "Test Mabc",
                "Test Mxyz",
                "Old Man\u2019s War",
            ]);
            expect(await testSearch("test mabc")).toEqual(["Test Mabc", "Test Mxyz"]);
            expect(await testSearch("test mx")).toEqual(["Test Mxyz", "Test Mabc"]);
            expect(await testSearch("tes m")).toEqual([
                "Test Mxyz",
                "Test Mabc",
                "Monster 1959",
                "Old Man\u2019s War",
            ]);

            // Testing typos
            expect(await testSearch("Preservationist")).toEqual(["The Preservationist"]);
            expect(await testSearch("Preseravtionist")).toEqual(["The Preservationist"]);
            expect(await testSearch("Preseravtoinist")).toEqual(["The Preservationist"]);
            expect(await testSearch("Perseravtoinist")).toEqual([]);
            expect(await testSearch("Perseravtoisnit")).toEqual([]);
            expect(await testSearch("Mnoster 1")).toEqual(["Monster 1959"]);

            // Testing typos in prefix
            expect(await testSearch("Preserv")).toEqual(["The Preservationist"]);
            expect(await testSearch("preserv")).toEqual(["The Preservationist"]);
            expect(await testSearch("Presevr")).toEqual([]);
            expect(await testSearch("Perserv")).toEqual([]);
            expect(await testSearch("rPeserv")).toEqual([]);

            // Testing two word prefix match
            expect(await testSearch("The Preserv")).toEqual([
                "The Preservationist",
                "The Silmarillion",
                "The Code of the Wooster",
                "The Grand Design",
                "The Lost Symbol",
                "The DaVinci Code",
                "The Lock Artist",
                "The Book of Samson",
                "The Book of Lies",
            ]);
            expect(await testSearch("the preserv")).toEqual([
                "The Preservationist",
                "The Silmarillion",
                "The Code of the Wooster",
                "The Grand Design",
                "The Lost Symbol",
                "The DaVinci Code",
                "The Lock Artist",
                "The Book of Samson",
                "The Book of Lies",
            ]);
            expect(await testSearch("the dav")).toEqual([
                "The DaVinci Code",
                "The Preservationist",
                "The Silmarillion",
                "The Code of the Wooster",
                "The Grand Design",
                "The Lost Symbol",
                "The Lock Artist",
                "The Book of Samson",
                "The Book of Lies",
            ]);

            // Testing identifiers are analyzed properly
            expect(await testSearch("2024")).toEqual([
                "Core Product FY2024Q2",
                "Core Product FY2024Q3",
                "Core Product FY2023Q3",
            ]);
            expect(await testSearch("Q3")).toEqual([
                "Core Product FY2023Q3",
                "Core Product FY2024Q3",
                "Core Product FY2024Q2",
            ]);
            expect(await testSearch("2024 Q3")).toEqual([
                "Core Product FY2024Q3",
                "Core Product FY2023Q3",
                "Core Product FY2024Q2",
            ]);
            expect(await testSearch("Q3 2024")).toEqual([
                "Core Product FY2024Q3",
                "Core Product FY2023Q3",
                "Core Product FY2024Q2",
            ]);
            expect(await testSearch("FY2024Q3")).toEqual([
                "Core Product FY2024Q3",
                "Core Product FY2024Q2",
                "Core Product FY2023Q3",
            ]);
            expect(await testSearch("Q3FY2024")).toEqual([
                "Core Product FY2024Q3",
                "Core Product FY2023Q3",
                "Core Product FY2024Q2",
            ]);
            expect(await testSearch("FY2024 Q3")).toEqual([
                "Core Product FY2024Q3",
                "Core Product FY2024Q2",
                "Core Product FY2023Q3",
            ]);
            expect(await testSearch("Q3 FY2024")).toEqual([
                "Core Product FY2024Q3",
                "Core Product FY2023Q3",
                "Core Product FY2024Q2",
            ]);

            // Testing search as user types
            expect(await testSearch("pl")).toEqual(["Playground"]);
            expect(await testSearch("pla")).toEqual(["Playground"]);
            expect(await testSearch("play")).toEqual(["Playground"]);
            expect(await testSearch("playg")).toEqual(["Playground"]);
            expect(await testSearch("playgr")).toEqual(["Playground"]);
            expect(await testSearch("playgro")).toEqual(["Playground"]);
            expect(await testSearch("playgrou")).toEqual(["Playground"]);
            expect(await testSearch("playgroun")).toEqual(["Playground"]);
            expect(await testSearch("playground")).toEqual(["Playground"]);
        };

        let testSearchSpace = space;
        let testSearchSession = session;
        await runTests();
        testSearchSession = otherSession;
        await expect(runTests).rejects.toThrow(PermissionDeniedError);
        testSearchSpace = otherSpace;
        await runTests();
    },
    // Increase test timeout since we've found that sometimes this test is slow to run
    // in CI.
    30 * 1000,
);

test("can search channels by affinity", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const channel1 = await TestChannel.create(session1, {name: "Channel 1"});
    const channel2 = await TestChannel.create(session1, {name: "Channel 2"});
    const channel3 = await TestChannel.create(session1, {name: "Channel 3"});
    const channel4 = await TestChannel.create(session2, {name: "Channel 4"});
    const channel5 = await TestChannel.create(session1, {name: "Channel 5"});

    const createPostCountBySessionByChannel: Map<
        {id: ChannelId},
        Map<TestSession, number>
    > = new Map([
        [channel1, new Map([[session1, 1]])],
        [channel2, new Map([[session1, 3]])],
        [
            channel3,
            new Map([
                [session2, 1],
                [session3, 3],
            ]),
        ],
        [channel4, new Map([[session3, 5]])],
        [
            channel5,
            new Map([
                [session1, 2],
                [session2, 2],
            ]),
        ],
    ]);

    for (const [channel, createPostCountBySession] of createPostCountBySessionByChannel) {
        for (const [session, createPostCount] of createPostCountBySession) {
            for (let i = 0; i < createPostCount; i++) {
                await createPost(session.action(), {
                    channelId: channel.id,
                    content: createSimplePostContent("Test post"),
                    createdTimeZone: defaultTimeZone,
                });
            }
        }
    }

    await ProcessContextModule.waitForTestTasks();

    expect(
        (await searchChannelsByAffinity(session1.action(), {spaceId: space.id, limit: 100})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel2.id, origin: "Account"},
        {channelId: channel5.id, origin: "Account"},
        {channelId: channel1.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel4.id, origin: "Space"},
    ]);

    expect(
        (await searchChannelsByAffinity(session2.action(), {spaceId: space.id, limit: 100})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel5.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel2.id, origin: "Space"},
        {channelId: channel1.id, origin: "Space"},
    ]);

    expect(
        (await searchChannelsByAffinity(session3.action(), {spaceId: space.id, limit: 100})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel5.id, origin: "Space"},
        {channelId: channel2.id, origin: "Space"},
        {channelId: channel1.id, origin: "Space"},
    ]);

    expect(
        (await searchChannelsByAffinity(session1.action(), {spaceId: space.id, limit: 3})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel2.id, origin: "Account"},
        {channelId: channel5.id, origin: "Account"},
        {channelId: channel1.id, origin: "Account"},
    ]);

    expect(
        (await searchChannelsByAffinity(session2.action(), {spaceId: space.id, limit: 3})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel5.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
    ]);

    expect(
        (await searchChannelsByAffinity(session3.action(), {spaceId: space.id, limit: 3})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel5.id, origin: "Space"},
    ]);

    await channel5.access.revokeDefault(session1);

    expect(
        (await searchChannelsByAffinity(session1.action(), {spaceId: space.id, limit: 100})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel2.id, origin: "Account"},
        {channelId: channel5.id, origin: "Account"},
        {channelId: channel1.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel4.id, origin: "Space"},
    ]);

    expect(
        (await searchChannelsByAffinity(session2.action(), {spaceId: space.id, limit: 100})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel2.id, origin: "Space"},
        {channelId: channel1.id, origin: "Space"},
    ]);

    expect(
        (await searchChannelsByAffinity(session3.action(), {spaceId: space.id, limit: 100})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel2.id, origin: "Space"},
        {channelId: channel1.id, origin: "Space"},
    ]);

    expect(
        (await searchChannelsByAffinity(session1.action(), {spaceId: space.id, limit: 3})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel2.id, origin: "Account"},
        {channelId: channel5.id, origin: "Account"},
        {channelId: channel1.id, origin: "Account"},
    ]);

    expect(
        (await searchChannelsByAffinity(session2.action(), {spaceId: space.id, limit: 3})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
    ]);

    expect(
        (await searchChannelsByAffinity(session3.action(), {spaceId: space.id, limit: 3})).map(
            result => ({channelId: result.channel.id, origin: result.origin}),
        ),
    ).toEqual([
        {channelId: channel4.id, origin: "Account"},
        {channelId: channel3.id, origin: "Account"},
        {channelId: channel2.id, origin: "Space"},
    ]);

    await expect(
        searchChannelsByAffinity(otherSession.action(), {spaceId: space.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        searchChannelsByAffinity(session1.action(), {spaceId: otherSpace.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        (
            await searchChannelsByAffinity(otherSession.action(), {
                spaceId: otherSpace.id,
                limit: 100,
            })
        ).map(result => ({channelId: result.channel.id, origin: result.origin})),
    ).toEqual([]);
});

test("channel access policies are enforced in search", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4, session5, session6] =
        await space.createSessions(6);

    const channels = await runAllPromises([
        TestChannel.create(session1, {name: "Test Channel 1"}),
        TestChannel.create(session1, {name: "Test Channel 2"}),
        TestChannel.create(session1, {name: "Test Channel 3"}),
        TestChannel.create(session1, {name: "Test Channel 4"}),
        TestChannel.create(session1, {name: "Test Channel 5"}),
        TestChannel.create(session6, {name: "Test Channel 6"}),
        TestChannel.create(session6, {name: "Test Channel 7"}),
        TestChannel.create(session6, {name: "Test Channel 8"}),
    ]);

    const [channel1, channel2, channel3, channel4, channel5, channel6, channel7, channel8] =
        channels;

    await runAllPromises([
        channel1.access.revokeDefault(session1),
        channel2.access.revokeDefault(session1),
        channel3.access.revokeDefault(session1),
        channel4.access.revokeDefault(session1),
        channel5.access.revokeDefault(session1),
        channel6.access.revokeDefault(session6),
        channel7.access.revokeDefault(session6),
        channel8.access.revokeDefault(session6),
    ]);

    const posts = await runAllPromises([
        channel1.createPost(session1, "Test post 1"),
        channel2.createPost(session1, "Test post 2"),
        channel3.createPost(session1, "Test post 3"),
        channel4.createPost(session1, "Test post 4"),
        channel5.createPost(session1, "Test post 5"),
        channel6.createPost(session6, "Test post 6"),
        channel7.createPost(session6, "Test post 7"),
        channel8.createPost(session6, "Test post 8"),
    ]);

    const [post1, post2, post3, post4, post5, post6, post7, post8] = posts;

    const comments = await runAllPromises([
        post1.createComment(session1, "Test post comment 1"),
        post2.createComment(session1, "Test post comment 2"),
        post3.createComment(session1, "Test post comment 3"),
        post4.createComment(session1, "Test post comment 4"),
        post5.createComment(session1, "Test post comment 5"),
        post6.createComment(session6, "Test post comment 6"),
        post7.createComment(session6, "Test post comment 7"),
        post8.createComment(session6, "Test post comment 8"),
    ]);

    const searchEntityIdOrder = [
        ...channels.map(channel => `Channel:${channel.id}`),
        ...posts.map(post => `Post:${post.id}`),
        ...comments.map(comment => `PostComment:${comment.room.id}-0`),
    ];

    await channel2.access.grant(session1, session6);

    await channel3.access.grant(session1, session2, "View");
    await channel3.access.grant(session1, session3, "Comment");
    await channel3.access.grant(session1, session4, "Edit");
    await channel3.access.grant(session1, session5, "Manage");

    await channel4.access.grantDefault(session1);

    await channel5.access.grantDefault(session1, "View");
    await channel5.access.grant(session1, session2);
    await channel5.access.grant(session1, session3);

    await channel6.access.grantUrl(session6);

    await channel7.access.grantUrl(session6);
    await channel7.access.grant(session6, session5);

    await channel8.access.grantUrl(session6);
    await channel8.access.grantDefault(session6);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);

        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "test",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:"))
            .sort(
                (id1, id2) =>
                    assertExists(searchEntityIdOrder.findIndex(id => id === id1)) -
                    assertExists(searchEntityIdOrder.findIndex(id => id === id2)),
            );
    };

    expect(await getSearchEntityIds(session1)).toEqual([
        `Channel:${channel1.id}`,
        `Channel:${channel2.id}`,
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post1.id}`,
        `Post:${post2.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post1.id}-0`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Channel:${channel2.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel6.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post2.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post6.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post6.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    await channel5.access.revoke(session1, session2);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `Channel:${channel1.id}`,
        `Channel:${channel2.id}`,
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post1.id}`,
        `Post:${post2.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post1.id}-0`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Channel:${channel2.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel6.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post2.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post6.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post6.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    await channel5.access.revokeDefault(session1);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `Channel:${channel1.id}`,
        `Channel:${channel2.id}`,
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post1.id}`,
        `Post:${post2.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post1.id}-0`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Channel:${channel2.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel6.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post2.id}`,
        `Post:${post4.id}`,
        `Post:${post6.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post6.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    await channel3.access.revoke(session1, session4);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `Channel:${channel1.id}`,
        `Channel:${channel2.id}`,
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post1.id}`,
        `Post:${post2.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post1.id}-0`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel5.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post5.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post5.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Channel:${channel4.id}`,
        `Channel:${channel8.id}`,
        `Post:${post4.id}`,
        `Post:${post8.id}`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Channel:${channel3.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post3.id}`,
        `Post:${post4.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post3.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Channel:${channel2.id}`,
        `Channel:${channel4.id}`,
        `Channel:${channel6.id}`,
        `Channel:${channel7.id}`,
        `Channel:${channel8.id}`,
        `Post:${post2.id}`,
        `Post:${post4.id}`,
        `Post:${post6.id}`,
        `Post:${post7.id}`,
        `Post:${post8.id}`,
        `PostComment:${post2.id}-0`,
        `PostComment:${post4.id}-0`,
        `PostComment:${post6.id}-0`,
        `PostComment:${post7.id}-0`,
        `PostComment:${post8.id}-0`,
    ]);
});

test("changes channel contributors as posts/comments are made", async () => {
    const space = await TestSpace.create(context);

    const [sessionA, sessionB, sessionC, sessionD, sessionE] = await runAllPromises([
        space.createSession({name: "aaaaa", role: "Admin"}),
        space.createSession({name: "bbbbb"}),
        space.createSession({name: "ccccc"}),
        space.createSession({name: "ddddd"}),
        space.createSession({name: "eeeee"}),
        space.createSession({name: "fffff"}),
    ]);

    const channel = await TestChannel.create(sessionA);

    const hasChannel = async (queryText: string) => {
        const results = await searchByKeywords(sessionA.action(), {
            spaceId: space.id,
            queryText,
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results.some(
            result =>
                result.id === `Channel:${channel.id}` &&
                // Make sure this result was returned because of a high confidence natural language
                // match.
                result.score >= standardSearchOptions.naturalLanguage.filterConstantScore,
        );
    };

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(false);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(false);
    expect(await hasChannel("channels updated by ccccc")).toEqual(false);
    expect(await hasChannel("channels updated by ddddd")).toEqual(false);
    expect(await hasChannel("channels updated by eeeee")).toEqual(false);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    const postB = await channel.createPost(sessionB);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(false);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(false);
    expect(await hasChannel("channels updated by ddddd")).toEqual(false);
    expect(await hasChannel("channels updated by eeeee")).toEqual(false);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    await postB.createComment(sessionC);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(false);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(false);
    expect(await hasChannel("channels updated by eeeee")).toEqual(false);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    const postD1 = await channel.createPost(sessionD);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(false);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(false);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    const postD2 = await channel.createPost(sessionD);
    const postD3 = await channel.createPost(sessionD);
    const postD4 = await channel.createPost(sessionD);
    const postD5 = await channel.createPost(sessionD);
    const postD6 = await channel.createPost(sessionD);
    const postD7 = await channel.createPost(sessionD);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(false);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(false);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    const postD8 = await channel.createPost(sessionD);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(true);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(false);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    await postD1.createComment(sessionE);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(true);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(true);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    // Many comments on the same post don't make you a major contributor.
    await postD1.createComment(sessionE);
    await postD1.createComment(sessionE);
    await postD1.createComment(sessionE);
    await postD1.createComment(sessionE);
    await postD1.createComment(sessionE);
    await postD1.createComment(sessionE);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(true);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(true);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    await postD1.createComment(sessionE);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(true);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(true);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    // Many comments on different posts makes you a major contributor.
    await postD2.createComment(sessionC);
    await postD3.createComment(sessionC);
    await postD4.createComment(sessionC);
    await postD5.createComment(sessionC);
    await postD6.createComment(sessionC);
    await postD7.createComment(sessionC);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(false);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(true);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(true);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);

    await postD8.createComment(sessionC);

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await hasChannel("aaaaa\u2019s channels")).toEqual(true);
    expect(await hasChannel("bbbbb\u2019s channels")).toEqual(false);
    expect(await hasChannel("ccccc\u2019s channels")).toEqual(true);
    expect(await hasChannel("ddddd\u2019s channels")).toEqual(true);
    expect(await hasChannel("eeeee\u2019s channels")).toEqual(false);
    expect(await hasChannel("fffff\u2019s channels")).toEqual(false);

    expect(await hasChannel("channels updated by aaaaa")).toEqual(true);
    expect(await hasChannel("channels updated by bbbbb")).toEqual(true);
    expect(await hasChannel("channels updated by ccccc")).toEqual(true);
    expect(await hasChannel("channels updated by ddddd")).toEqual(true);
    expect(await hasChannel("channels updated by eeeee")).toEqual(true);
    expect(await hasChannel("channels updated by fffff")).toEqual(false);
});

test("searching for channel shows both the channel and its posts, ranking the channel first", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Test Account"});

    const channel = await TestChannel.create(session, {name: "Engineering Help"});

    const post1 = await channel.createPost(session, "Test Post 1");
    const post2 = await channel.createPost(session, "Test Post 2");
    const post3 = await channel.createPost(session, "Test Post 3");

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "Engineering Help",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }).then(results =>
            results.sort(
                (a, b) => b.score - a.score || defaultCompareStrings(a.model.id, b.model.id),
            ),
        ),
    ).toEqual(
        [
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "Engineering Help",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
                }),
                bodyTextSnippet: [],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post1.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 1",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in "},
                    {isHighlighted: true, text: "Engineering"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 1"},
                ],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post2.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 2",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in "},
                    {isHighlighted: true, text: "Engineering"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 2"},
                ],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post3.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 3",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in "},
                    {isHighlighted: true, text: "Engineering"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 3"},
                ],
                parsedFilter: null,
            }),
        ].sort((a, b) => b.score - a.score || defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "Help",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }).then(results =>
            results.sort(
                (a, b) => b.score - a.score || defaultCompareStrings(a.model.id, b.model.id),
            ),
        ),
    ).toEqual(
        [
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "Engineering Help",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
                }),
                bodyTextSnippet: [],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post1.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 1",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in Engineering "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 1"},
                ],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post2.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 2",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in Engineering "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 2"},
                ],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post3.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 3",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in Engineering "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 3"},
                ],
                parsedFilter: null,
            }),
        ].sort((a, b) => b.score - a.score || defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "Halp",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }).then(results =>
            results.sort(
                (a, b) => b.score - a.score || defaultCompareStrings(a.model.id, b.model.id),
            ),
        ),
    ).toEqual(
        [
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "Engineering Help",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
                }),
                bodyTextSnippet: [],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post1.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 1",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in Engineering "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 1"},
                ],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post2.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 2",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in Engineering "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 2"},
                ],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Post",
                    post: {
                        id: post3.id,
                        version: 0,
                        channelVersion: 0,
                        author: expect.any(AccountModel),
                    },
                    title: "in Engineering Help: Test Post 3",
                }),
                bodyTextSnippet: [
                    {isHighlighted: false, text: "in Engineering "},
                    {isHighlighted: true, text: "Help"},
                    {isHighlighted: false, text: ": Test Post 3"},
                ],
                parsedFilter: null,
            }),
        ].sort((a, b) => b.score - a.score || defaultCompareStrings(a.model.id, b.model.id)),
    );
});

test("can generate proper post titles", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {name: "Test Channel"});

    const post1 = await channel.createPost(
        session,
        "The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog, and the quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog, and the quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog, and the quick brown fox jumps over the lazy dog 3.",
    );

    const post2 = await channel.createPost(
        session,
        "The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog, and the quick brown FoxJumpsOverTheLazyDog1TheQuickBrownFoxJumpsOverTheLazyDog2TheQuickBrownFoxJumpsOverTheLazyDog3TheQuickBrownFoxJumpsOverTheLazyDog4",
    );

    const post3 = await channel.createPost(
        session,
        "The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog, the quick brown fox jumps over the lazy dog 3.",
    );

    const post4 = await channel.createPost(
        session,
        "The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4.",
    );

    const post5 = await channel.createPost(
        session,
        "The quick brown fox jumps 1. Over the lazy dog 2. The quick brown fox jumps 3. Over the lazy dog 4. The quick brown fox jumps 5. Over the lazy dog 6. The quick brown fox jumps 7. Over the lazy dog 8.",
    );

    const post6 = await channel.createPost(
        session,
        "The quick brown 1. Fox jumps over 2. The lazy dog 3. The quick brown 4. Fox jumps over 5. The lazy dog 6. The quick brown 7. Fox jumps over 8. The lazy dog 9. The quick brown 10. Fox jumps over 11. The lazy dog 12.",
    );

    const post7 = await channel.createPost(
        session,
        "The quick 1. Brown 2. Fox jumps 3. Over 4. The lazy dog 5. The quick 6. Brown 7. Fox jumps 8. Over 9. The lazy dog 10.",
    );

    const post8 = await channel.createPost(
        session,
        "TheQuickBrownFoxJumpsOverTheLazyDog1TheQuickBrownFoxJumpsOverTheLazyDog2TheQuickBrownFoxJumpsOverTheLazyDog3TheQuickBrownFoxJumpsOverTheLazyDog4",
    );

    const post9 = await channel.createPost(
        session,
        "Hello, world! The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4.",
    );

    const post10 = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("Hello, world!")]),
            schema.node("paragraph", {}, [
                schema.text(
                    "The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4.",
                ),
            ]),
        ]),
    );

    const post11 = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("heading", {}, [schema.text("Hello, world!")]),
            schema.node("paragraph", {}, [
                schema.text(
                    "The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4.",
                ),
            ]),
        ]),
    );

    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post1.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: [
                "in Test Channel: The quick brown fox jumps over the lazy dog, the quick brown fox jumps over […]",
            ],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post2.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post2.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: [
                "in Test Channel: The quick brown fox jumps over the lazy dog, the quick brown fox jumps over […]",
            ],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post3.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: [
                "in Test Channel: The quick brown fox jumps over the lazy dog, the quick brown fox jumps over […]",
            ],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post4.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post4.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: The quick brown fox jumps over the lazy dog 1"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post5.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post5.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {title: ["in Test Channel: The quick brown fox jumps 1"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post6.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post6.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {title: ["in Test Channel: The quick brown 1"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post7.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post7.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {title: ["in Test Channel: The quick 1"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post8.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post8.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: [
                "in Test Channel: TheQuickBrownFoxJumpsOverTheLazyDog1TheQuickBrownFoxJumpsOverTheLazyDog2TheQuickBrownFo […]",
            ],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post9.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post9.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Hello, world!"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post10.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post10.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Hello, world!"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post11.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post11.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Hello, world!"],
        },
    });
});

test("post title updates if mentioned entities change", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {name: "Test Channel"});

    const document1 = await TestDocument.create(session, {title: "Foo", access: "Public"});
    const document2 = await TestDocument.create(session, {title: "Qux", access: "Public"});
    const privateDocument = await TestDocument.create(session, {title: "Xyz", access: "Private"});

    const collection = await TestTaskCollection.create(session, {access: "Public"});
    const task1 = await TestTask.create(session, {title: "Bar"});
    await task1.addCollection(session, collection);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(0);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    const post = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Check out "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document1.id}`,
                    }),
                }),
                schema.text(", "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Task:${task1.id}`,
                    }),
                }),
                schema.text(", and "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${privateDocument.id}`,
                    }),
                }),
                schema.text(". This is another mention not in the title "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document2.id}`,
                    }),
                }),
                schema.text("."),
            ]),
        ]),
    );

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(1);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Foo, Bar, and Private document"],
        },
    });

    {
        const oldTitle = getDocumentContentTitle((await document1.get()).content.doc);

        await document1.update(session, [
            new ReplaceStep(
                1,
                1 + oldTitle.length,
                new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("Oof")), 0, 0),
            ),
        ]);
    }

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(2);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Oof, Bar, and Private document"],
        },
    });

    {
        const oldTitle = new TaskTitleModel((await task1.getIndexDoc()).title.raw);

        await task1.updateTitle(
            session,
            oldTitle.replace(
                randomlyGenerateTaskTitleClientId(),
                0,
                oldTitle.getText().length,
                "Rab",
            ).raw,
        );
    }

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(3);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Oof, Rab, and Private document"],
        },
    });

    {
        const oldTitle = getDocumentContentTitle((await document2.get()).content.doc);

        await document2.update(session, [
            new ReplaceStep(
                1,
                1 + oldTitle.length,
                new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("Xuq")), 0, 0),
            ),
        ]);
    }

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(4);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Oof, Rab, and Private document"],
        },
    });

    {
        const oldTitle = getDocumentContentTitle((await privateDocument.get()).content.doc);

        await privateDocument.update(session, [
            new ReplaceStep(
                1,
                1 + oldTitle.length,
                new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("Abc")), 0, 0),
            ),
        ]);
    }

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(5);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Oof, Rab, and Private document"],
        },
    });

    await privateDocument.access.grantDefault(session);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(6);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Oof, Rab, and Abc"],
        },
    });

    await task1.removeCollection(session, collection);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(7);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: ["in Test Channel: Check out Oof, Private task, and Abc"],
        },
    });
});

test("post mention updates if post updates", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Foo"});

    const document1 = await TestDocument.create(session, {title: "Dog", access: "Public"});
    const document2 = await TestDocument.create(session, {title: "Cat", access: "Public"});

    const channel = await TestChannel.create(session, {name: "Bar"});

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(0);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    const post = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("The quick brown fox jumps over the lazy "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document1.id}`,
                    }),
                }),
                schema.text(
                    ". The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4. The quick brown fox jumps over the lazy dog 5. The quick brown fox jumps over the lazy ",
                ),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document2.id}`,
                    }),
                }),
                schema.text(". The quick brown fox jumps over the lazy dog."),
            ]),
        ]),
    );

    const document3 = await TestDocument.create(session, {
        content: DocumentContentProsemirrorSchema.node("doc", {}, [
            DocumentContentProsemirrorSchema.node("title", {}, [
                DocumentContentProsemirrorSchema.text("Qux"),
            ]),
            DocumentContentProsemirrorSchema.node("paragraph", {}, [
                DocumentContentProsemirrorSchema.text("You should check out "),
                DocumentContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${post.id}`,
                    }),
                }),
                DocumentContentProsemirrorSchema.text(". Wow."),
            ]),
        ]),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(1);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Foo in Bar: The quick brown fox jumps over the lazy Dog. Wow.",
            ],
        },
    });

    await updateOurAccountName(session.action(), "Oof");

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(1);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Oof in Bar: The quick brown fox jumps over the lazy Dog. Wow.",
            ],
        },
    });

    await updateChannelName(session.action(), {
        channelId: channel.id,
        name: "Rab",
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(2);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Oof in Rab: The quick brown fox jumps over the lazy Dog. Wow.",
            ],
        },
    });

    {
        const oldTitle = getDocumentContentTitle((await document2.get()).content.doc);

        await document2.update(session, [
            new ReplaceStep(
                1,
                1 + oldTitle.length,
                new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("Mittens")), 0, 0),
            ),
        ]);
    }

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(3);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Oof in Rab: The quick brown fox jumps over the lazy Dog. Wow.",
            ],
        },
    });

    {
        const oldTitle = getDocumentContentTitle((await document1.get()).content.doc);

        await document1.update(session, [
            new ReplaceStep(
                1,
                1 + oldTitle.length,
                new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("Pupper")), 0, 0),
            ),
        ]);
    }

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(4);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Oof in Rab: The quick brown fox jumps over the lazy Pupper. Wow.",
            ],
        },
    });

    await post.updateContent(session, {
        content: schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("The quick brown fox jumps over the lazy "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document1.id}`,
                    }),
                }),
                schema.text(
                    ". The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4. The quick brown fox jumps over the lazy dog 5. The quick brown fox jumps over the lazy lazy ",
                ),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document2.id}`,
                    }),
                }),
                schema.text(". The quick brown fox jumps over the lazy dog."),
            ]),
        ]),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(5);
    expect(indexSearchEntityDependentsJobCount).toBe(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Oof in Rab: The quick brown fox jumps over the lazy Pupper. Wow.",
            ],
        },
    });

    await post.updateContent(session, {
        content: schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("The quick brown FOX FOX jumps over the lazy "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document1.id}`,
                    }),
                }),
                schema.text(
                    ". The quick brown fox jumps over the lazy dog 1. The quick brown fox jumps over the lazy dog 2. The quick brown fox jumps over the lazy dog 3. The quick brown fox jumps over the lazy dog 4. The quick brown fox jumps over the lazy dog 5. The quick brown fox jumps over the LAZY LAZY ",
                ),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document2.id}`,
                    }),
                }),
                schema.text(". The quick brown fox jumps over the lazy dog."),
            ]),
        ]),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(6);
    expect(indexSearchEntityDependentsJobCount).toBe(1);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document3.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Document:${document3.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "You should check out Oof in Rab: The quick brown FOX FOX jumps over the lazy Pupper. Wow.",
            ],
        },
    });
});

test("can index post with cyclic mention", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Foo"});

    const pausePromise = indexSearchEntityTestCheckpoint.pauseForTest(space.id);

    const channel = await TestChannel.create(session, {name: "Bar"});

    const post = await channel.createPost(session, "Qux");

    const {getCount} = fallbackGetSearchEntityBaseIfPossibleTestCounter.recordForTest(
        `Post:${post.id}`,
    );

    await post.updateContent(session, {
        content: schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Qux: "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${post.id}`,
                    }),
                }),
            ]),
        ]),
    });

    const {unpause} = await pausePromise;

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(getCount()).toEqual(0);

    expect(
        await getSearchMentionEntityIfPossible(session.action(), space.id, `Post:${post.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Post",
            post: {
                id: post.id,
                version: 1,
                channelVersion: 0,
                author: expect.any(AccountModel),
            },
            title: "in Bar: Qux: […]",
        }),
    });

    // Make sure we used the entity fallback code path.
    expect(getCount()).toEqual(1);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    unpause();

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(2);
    expect(indexSearchEntityDependentsJobCount).toBe(1);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: Qux: […]"],
        },
    });

    await context.jobs.sendAndWait({
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Post",
            postId: post.id,
            updatedTraits: {type: "Some", traits: []},
        },
    });

    expect(indexSearchEntityJobCount).toBe(3);
    expect(indexSearchEntityDependentsJobCount).toBe(1);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: Qux: […]"],
        },
    });

    await post.updateContent(session, {
        content: schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Qux: "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${post.id}`,
                    }),
                }),
                schema.text(" (test)"),
            ]),
        ]),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(4);
    expect(indexSearchEntityDependentsJobCount).toBe(2);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: Qux: […] (test)"],
        },
    });

    await post.updateContent(session, {
        content: schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Qux: "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${post.id}`,
                    }),
                }),
                schema.text(" (test 2)"),
            ]),
        ]),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(5);
    expect(indexSearchEntityDependentsJobCount).toBe(3);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: Qux: […] (test 2)"],
        },
    });
});

test("can index post with cyclic mention a couple layers deep", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Foo"});

    const pausePromise = indexSearchEntityTestCheckpoint.pauseForTest(space.id);

    const channel = await TestChannel.create(session, {name: "Bar"});

    const postA = await channel.createPost(session, "a0");

    const postB = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("b "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${postA.id}`,
                    }),
                }),
            ]),
        ]),
    );

    const postC = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("c "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${postB.id}`,
                    }),
                }),
            ]),
        ]),
    );

    const postE = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("e "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Post:${postC.id}`,
                    }),
                }),
            ]),
        ]),
    );

    await postA.updateContent(session, {
        content: assertPostContent(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("a1 "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "SearchEntity",
                            entityId: `Post:${postC.id}`,
                        }),
                    }),
                ]),
            ]),
        ),
    });

    const {unpause} = await pausePromise;

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postA.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postB.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postC.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postE.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await getSearchMentionEntityIfPossible(session.action(), space.id, `Post:${postA.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Post",
            post: {
                id: postA.id,
                version: 1,
                channelVersion: 0,
                author: expect.any(AccountModel),
            },
            title: "in Bar: a1 Foo in Bar: c Foo in Bar: b […]",
        }),
    });

    expect(
        await getSearchMentionEntityIfPossible(session.action(), space.id, `Post:${postB.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Post",
            post: {
                id: postB.id,
                version: 0,
                channelVersion: 0,
                author: expect.any(AccountModel),
            },
            title: "in Bar: b Foo in Bar: a1 Foo in Bar: c […]",
        }),
    });

    expect(
        await getSearchMentionEntityIfPossible(session.action(), space.id, `Post:${postC.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Post",
            post: {
                id: postC.id,
                version: 0,
                channelVersion: 0,
                author: expect.any(AccountModel),
            },
            title: "in Bar: c Foo in Bar: b Foo in Bar: a1 […]",
        }),
    });

    expect(
        await getSearchMentionEntityIfPossible(session.action(), space.id, `Post:${postE.id}`),
    ).toEqual({
        isPrivate: false,
        entity: new SearchEntityModel({
            type: "Post",
            post: {
                id: postE.id,
                version: 0,
                channelVersion: 0,
                author: expect.any(AccountModel),
            },
            title: "in Bar: e Foo in Bar: c Foo in Bar: b Foo in Bar: a1 […]",
        }),
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postA.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postB.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postC.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postE.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual(null);

    unpause();

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(5);
    expect(indexSearchEntityDependentsJobCount).toBe(1);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postA.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postA.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: a1 Foo in Bar: c Foo in Bar: b […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postB.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postB.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: b Foo in Bar: a1 Foo in Bar: c […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postC.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postC.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: c Foo in Bar: b Foo in Bar: a1 […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postE.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postE.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: e Foo in Bar: c Foo in Bar: b Foo in Bar: a1 […]"],
        },
    });

    await postA.updateContent(session, {
        content: assertPostContent(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("a2 "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "SearchEntity",
                            entityId: `Post:${postC.id}`,
                        }),
                    }),
                ]),
            ]),
        ),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(9);
    expect(indexSearchEntityDependentsJobCount).toBe(2);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postA.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postA.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: a2 Foo in Bar: c Foo in Bar: b […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postB.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postB.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: b Foo in Bar: a2 Foo in Bar: c […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postC.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postC.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: c Foo in Bar: b Foo in Bar: a2 […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postE.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postE.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: e Foo in Bar: c Foo in Bar: b Foo in Bar: a2 […]"],
        },
    });

    await postA.updateContent(session, {
        content: assertPostContent(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("a3 "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "SearchEntity",
                            entityId: `Post:${postC.id}`,
                        }),
                    }),
                ]),
            ]),
        ),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(13);
    expect(indexSearchEntityDependentsJobCount).toBe(3);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postA.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postA.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: a3 Foo in Bar: c Foo in Bar: b […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postB.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postB.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: b Foo in Bar: a3 Foo in Bar: c […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postC.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postC.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: c Foo in Bar: b Foo in Bar: a3 […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postE.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postE.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: e Foo in Bar: c Foo in Bar: b Foo in Bar: a3 […]"],
        },
    });

    await postB.updateContent(session, {
        content: assertPostContent(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("d "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "SearchEntity",
                            entityId: `Post:${postA.id}`,
                        }),
                    }),
                ]),
            ]),
        ),
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(indexSearchEntityJobCount).toBe(17);
    expect(indexSearchEntityDependentsJobCount).toBe(4);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postA.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postA.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: a3 Foo in Bar: c Foo in Bar: d […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postB.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postB.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: d Foo in Bar: a3 Foo in Bar: c […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postC.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postC.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: c Foo in Bar: d Foo in Bar: a3 […]"],
        },
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${postE.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${postE.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: ["in Bar: e Foo in Bar: c Foo in Bar: d Foo in Bar: a3 […]"],
        },
    });
});
