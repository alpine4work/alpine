import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createPost} from "~/server/forum/data/forum_table.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    searchChannelsByAffinity,
    searchChannelsByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

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

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime) => {
        switch (job.type) {
            case "IndexSearchEntity": {
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

test("can search channels by name", async () => {
    const names = [
        "Old Man's War",
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
        expect(await testSearch("thank jeeves")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
        expect(await testSearch("jeeves thank")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
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
            "Old Man's War",
        ]);
        expect(await testSearch("test ma")).toEqual(["Test Mabc", "Test Mxyz", "Old Man's War"]);
        expect(await testSearch("test mab")).toEqual(["Test Mabc", "Test Mxyz", "Old Man's War"]);
        expect(await testSearch("test mabc")).toEqual(["Test Mabc", "Test Mxyz"]);
        expect(await testSearch("test mx")).toEqual(["Test Mxyz", "Test Mabc"]);
        expect(await testSearch("tes m")).toEqual([
            "Test Mxyz",
            "Test Mabc",
            "Monster 1959",
            "Old Man's War",
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
        expect(await testSearch("Presevr")).toEqual([]);
        expect(await testSearch("Perserv")).toEqual([]);
        expect(await testSearch("rPeserv")).toEqual([]);

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
            "Core Product FY2024Q2",
            "Core Product FY2023Q3",
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
        // TODO(calebmer): "play" after applying the stemmer is "plai" which doesn't
        // match "playground". We should see if there's still a way to make this
        // search. Maybe by detecting stemmed words in the prefix match (so fuzzy
        // search doesn't apply) and search once with stemming and once without? Would
        // like to see more cases before writing a fix.
        expect(await testSearch("play")).toEqual([]);
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
});

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
