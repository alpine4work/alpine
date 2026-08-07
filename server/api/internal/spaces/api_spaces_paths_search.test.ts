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
import {contentMentionTextTruncatedSuffix} from "~/shared/content/truncate_content_mention_text.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
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
                    bodySnippet: null,
                    matches: [{type: "Title", index: 0, length: 6}],
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
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
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

describe("space search removes post title overlap from body snippets", () => {
    const postContentByCase = new Map([
        [
            "body match at start",
            "Startquokka appears in the opening title sentence. " +
                "A later sentence repeats startquokka in body context.",
        ],
        [
            "body match at end",
            "Opening sentence creates the title. " +
                "Background filler without sentence punctuation ".repeat(30) +
                "This filler sentence ends here. Endwombat appears at the end.",
        ],
        [
            "unordered list",
            `- Unorderedyak title item
- A second unordered item contains unorderedyak.`,
        ],
        [
            "unordered list with only a title match",
            `- Unorderedkoala title item
- A second unordered item has no match.`,
        ],
        [
            "ordered list",
            `1. Orderedlynx title item
2. A second ordered item contains orderedlynx.`,
        ],
        [
            "ordered list with only a title match",
            `1. Orderedpanda title item
2. A second ordered item has no match.`,
        ],
        [
            "check list",
            `- [ ] Checklistibis title item
- [x] A second checklist item contains checklistibis.`,
        ],
        [
            "check list with only a title match",
            `- [ ] Checklisttern title item
- [x] A second checklist item has no match.`,
        ],
        [
            "table",
            `\
| Tableorca title | First row |
| --- | --- |
| A second cell | Last row contains tableorca |`,
        ],
        [
            "table with only a title match",
            `\
| Tablebadger title | First row |
| --- | --- |
| A second cell | Last row has no match |`,
        ],
        [
            "truncated title",
            "This is a very long sentence that contains " +
                "word ".repeat(30) +
                "truncatedfox body match.",
        ],
        [
            "truncated title with only a title match",
            "Truncatedotter starts a very long sentence that contains " +
                "word ".repeat(30) +
                "ending.",
        ],
        ["fuzzy title match", "Canonicalquokka"],
    ]);

    let spaceId = "";
    let apiKey = "";
    let postIdByCase: ReadonlyMap<string, string> = new Map();

    beforeAll(async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Example", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const channel = await TestChannel.create(session, {
            name: "Search Channel",
            access: "Public",
        });

        spaceId = space.id;
        apiKey = await bot.createApiKey(session);
        postIdByCase = new Map(
            await runAllPromises(
                Array.from(postContentByCase, async ([name, content]) => {
                    const post = await channel.createPost(session, content);
                    return [name, post.id] as const;
                }),
            ),
        );

        await runAllTimersAndWaitForTestTasks();
        await context.opensearch.refresh(SearchEntityKeywordIndex);
    });

    test("moves a body match at the start of the body into the overlapping title", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=startquokka`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("body match at start"),
                        title: "Alice in Search Channel: Startquokka appears in the opening title sentence",
                        bodySnippet: "A later sentence repeats startquokka in body context.",
                        matches: [
                            {type: "Title", index: 25, length: 11},
                            {type: "BodySnippet", index: 25, length: 11},
                        ],
                    }),
                ],
            },
        });
    });

    test("does not drop or reposition a body match in a non-overlapping end fragment", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=endwombat`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("body match at end"),
                        title: "Alice in Search Channel: Opening sentence creates the title",
                        bodySnippet: "Endwombat appears at the end.",
                        matches: [{type: "BodySnippet", index: 0, length: 9}],
                    }),
                ],
            },
        });
    });

    test("drops a partial title overlap separated by unordered-list formatting", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=unorderedyak`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("unordered list"),
                        title: "Alice in Search Channel: Unorderedyak title item",
                        bodySnippet: "A second unordered item contains unorderedyak.",
                        matches: [
                            {type: "Title", index: 25, length: 12},
                            {type: "BodySnippet", index: 33, length: 12},
                        ],
                    }),
                ],
            },
        });
    });

    test("unordered-list body snippet with only a title match", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=unorderedkoala`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("unordered list with only a title match"),
                        title: "Alice in Search Channel: Unorderedkoala title item",
                        bodySnippet: "A second unordered item has no match.",
                        matches: [{type: "Title", index: 25, length: 14}],
                    }),
                ],
            },
        });
    });

    test("drops and repositions matches around ordered-list formatting", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=orderedlynx`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("ordered list"),
                        title: "Alice in Search Channel: 1. Orderedlynx title item",
                        bodySnippet: "2. A second ordered item contains orderedlynx.",
                        matches: [
                            {type: "Title", index: 28, length: 11},
                            {type: "BodySnippet", index: 34, length: 11},
                        ],
                    }),
                ],
            },
        });
    });

    test("ordered-list body snippet with only a title match", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=orderedpanda`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("ordered list with only a title match"),
                        title: "Alice in Search Channel: 1. Orderedpanda title item",
                        bodySnippet: "2. A second ordered item has no match.",
                        matches: [{type: "Title", index: 28, length: 12}],
                    }),
                ],
            },
        });
    });

    test("drops and repositions matches around check-list formatting", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=checklistibis`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("check list"),
                        title: "Alice in Search Channel: Checklistibis title item",
                        bodySnippet: "A second checklist item contains checklistibis.",
                        matches: [
                            {type: "Title", index: 25, length: 13},
                            {type: "BodySnippet", index: 33, length: 13},
                        ],
                    }),
                ],
            },
        });
    });

    test("check-list body snippet with only a title match", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=checklisttern`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("check list with only a title match"),
                        title: "Alice in Search Channel: Checklisttern title item",
                        bodySnippet: "A second checklist item has no match.",
                        matches: [{type: "Title", index: 25, length: 13}],
                    }),
                ],
            },
        });
    });

    test("drops and repositions matches around table formatting", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=tableorca`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("table"),
                        title: "Alice in Search Channel: Tableorca title",
                        bodySnippet: "First row. A second cell. Last row contains tableorca",
                        matches: [
                            {type: "Title", index: 25, length: 9},
                            {type: "BodySnippet", index: 44, length: 9},
                        ],
                    }),
                ],
            },
        });
    });

    test("table body snippet with only a title match", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=tablebadger`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("table with only a title match"),
                        title: "Alice in Search Channel: Tablebadger title",
                        bodySnippet: "First row. A second cell. Last row has no match",
                        matches: [{type: "Title", index: 25, length: 11}],
                    }),
                ],
            },
        });
    });

    test("ignores the synthetic suffix when dropping a truncated title", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=truncatedfox`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("truncated title"),
                        title:
                            "Alice in Search Channel: This is a very long sentence that contains " +
                            "word word word word word word" +
                            contentMentionTextTruncatedSuffix,
                        bodySnippet:
                            "word word word word word word word word word word word word " +
                            "word word word word word word word word word word word word " +
                            "truncatedfox body match.",
                        matches: [{type: "BodySnippet", index: 120, length: 12}],
                    }),
                ],
            },
        });
    });

    test("truncated-title body snippet with only a title match", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=truncatedotter`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("truncated title with only a title match"),
                        title:
                            "Alice in Search Channel: Truncatedotter starts a very long sentence " +
                            "that contains word word word" +
                            contentMentionTextTruncatedSuffix,
                        bodySnippet:
                            "word word word word word word word word word word word word word word word word word word word word word word word word word word word ending.",
                        matches: [{type: "Title", index: 25, length: 14}],
                    }),
                ],
            },
        });
    });

    test("uses a fuzzy body match as the canonical title match after a full drop", async () => {
        expect(
            await server.GET(`/spaces/${spaceId}/search?query=canonicalquokko`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                results: [
                    expect.objectContaining({
                        type: "Post",
                        id: postIdByCase.get("fuzzy title match"),
                        title: "Alice in Search Channel: Canonicalquokka",
                        bodySnippet: null,
                        matches: [{type: "Title", index: 25, length: 15}],
                    }),
                ],
            },
        });
    });
});
