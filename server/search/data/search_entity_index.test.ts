import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {
    getSearchEntityIndexForTest,
    processIndexSearchEntityJob,
} from "~/server/search/data/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";

const SearchEntityIndex = getSearchEntityIndexForTest();

const context = createTestContext({shouldStartOpensearch: true});

test("can index and reindex a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([]);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("wow")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([]);

    await processIndexSearchEntityJob(TestTask.systemAction(space), new Date(), {
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Document",
            documentId: document.id,
            updatedTraits: "Any",
        },
    });

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}:0`, score: expect.any(Number)}]);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("wow")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([]);

    await document.type(session, " A new sentence, wow.");

    await processIndexSearchEntityJob(TestTask.systemAction(space), new Date(), {
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Document",
            documentId: document.id,
            updatedTraits: "Any",
        },
    });

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}:0`, score: expect.any(Number)}]);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("wow")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}:0`, score: expect.any(Number)}]);
});

test("can highlight a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    await processIndexSearchEntityJob(TestTask.systemAction(space), new Date(), {
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Document",
            documentId: document.id,
            updatedTraits: "Any",
        },
    });

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        must: [
                            {term: {spaceId: new OpensearchQueryValue(space.id)}},
                            {
                                match_phrase: {
                                    "data.body": {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
                highlight: {
                    type: "unified",
                    fields: {
                        "data.body": {},
                    },
                },
            },
        ),
    ).toEqual([
        {
            id: `Document:${document.id}:0`,
            score: expect.any(Number),
            highlight: {"data.body": ["Very <em>cool</em>."]},
        },
    ]);
});
