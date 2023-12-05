import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    AllMiniLmL6V2Model,
    allMiniLmL6V2ModelEmbedTextTestCounter,
} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {getDocumentSearchEntityTestCheckpoint} from "~/server/search/data/internal/get_search_entity.js";
import {
    getSearchEntityIndexForTest,
    processIndexSearchEntityJob,
} from "~/server/search/data/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {wikipediaYoutubeDocumentContent} from "~/shared/documents/fixtures/wikipedia_youtube_document_content.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const schema = DocumentContentProsemirrorSchema;
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
                                    body: {query: new OpensearchQueryValue("cool")},
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
                                    body: {query: new OpensearchQueryValue("wow")},
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
                                    body: {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number)}]);

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
                                    body: {query: new OpensearchQueryValue("wow")},
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
                                    body: {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number)}]);

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
                                    body: {query: new OpensearchQueryValue("wow")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number)}]);
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
                                    body: {query: new OpensearchQueryValue("cool")},
                                },
                            },
                        ],
                    },
                },
                highlight: {
                    type: "unified",
                    fields: {
                        body: {},
                    },
                },
            },
        ),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            score: expect.any(Number),
            highlight: {body: ["Very <em>cool</em>."]},
        },
    ]);
});

test("will skip indexing if already indexed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual(null);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        new Date(Date.now() - 2 * 60 * 1000),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: "Any",
            },
        },
    );

    const {primaryTerm, sequenceNumber: sequenceNumberBase} = assertExists(
        (
            await context.opensearch.client.getDocWithoutSourceIfExists(
                context.tracer.getTracer(),
                SearchEntityIndex,
                space.id,
                `Document:${document.id}`,
            )
        )?.version,
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        version: {primaryTerm, sequenceNumber: sequenceNumberBase},
        fields: {},
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

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        version: {primaryTerm, sequenceNumber: sequenceNumberBase + 1},
        fields: {},
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

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        version: {primaryTerm, sequenceNumber: sequenceNumberBase + 2},
        fields: {},
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        new Date(Date.now() - 4 * 60 * 1000),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: "Any",
            },
        },
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        version: {primaryTerm, sequenceNumber: sequenceNumberBase + 2},
        fields: {},
    });
});

test("will correctly index during race condition (scenario 1)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    const pause1Promise = getDocumentSearchEntityTestCheckpoint.pauseForTest(document.id);

    const job1Promise = processIndexSearchEntityJob(TestTask.systemAction(space), new Date(), {
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Document",
            documentId: document.id,
            updatedTraits: "Any",
        },
    });

    const pause1 = await pause1Promise;
    pause1.stopPausing();

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

    pause1.unpause();
    await job1Promise;

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
                                    body: {query: new OpensearchQueryValue("wow")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number)}]);
});

test("will correctly index during race condition (scenario 2)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    const pause1Promise = getDocumentSearchEntityTestCheckpoint.pauseForTest(document.id);

    const job1Promise = processIndexSearchEntityJob(TestTask.systemAction(space), new Date(), {
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Document",
            documentId: document.id,
            updatedTraits: "Any",
        },
    });

    const pause1 = await pause1Promise;
    pause1.stopPausing();

    await document.type(session, " A new sentence, wow.");

    const pause2Promise = getDocumentSearchEntityTestCheckpoint.pauseForTest(document.id);

    const job2Promise = processIndexSearchEntityJob(TestTask.systemAction(space), new Date(), {
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Document",
            documentId: document.id,
            updatedTraits: "Any",
        },
    });

    const pause2 = await pause2Promise;
    pause2.stopPausing();

    pause1.unpause();
    await job1Promise;

    pause2.unpause();
    await job2Promise;

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
                                    body: {query: new OpensearchQueryValue("wow")},
                                },
                            },
                        ],
                    },
                },
            },
        ),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number)}]);
});

test("generates embeddings and only regenerates embeddings for chunks that changed", async () => {
    const {getCount} = allMiniLmL6V2ModelEmbedTextTestCounter.recordForTest();

    const languageModel = await AllMiniLmL6V2Model.new();

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    expect(getCount()).toEqual(0);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${documentId}`,
            {storedFields: ["embeddingChunks.text", "embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual(null);

    const document = await TestDocument.create(session, {
        id: documentId,
        content: wikipediaYoutubeDocumentContent.get(),
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        new Date(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: "Any",
            },
        },
    );

    expect(getCount()).toEqual(3);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        version: expect.any(Object),
        fields: {
            "embeddingChunksVectorCache.allMiniLmL6V2": [
                new Map([
                    [3903773671, expect.any(Array)],
                    [2338772678, expect.any(Array)],
                    [2963917712, expect.any(Array)],
                ]),
            ],
        },
    });

    const doc = await context.opensearch.client.getDocWithoutSourceIfExists(
        context.tracer.getTracer(),
        SearchEntityIndex,
        space.id,
        `Document:${document.id}`,
        {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
    );

    await document.update(session, [
        new ReplaceStep(2700, 2710, new Slice(Fragment.from(schema.text("ASDASDASDA")), 0, 0)),
    ]);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        new Date(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: "Any",
            },
        },
    );

    expect(getCount()).toEqual(4);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        version: expect.any(Object),
        fields: {
            "embeddingChunksVectorCache.allMiniLmL6V2": [
                new Map([
                    [
                        3903773671,
                        doc?.fields["embeddingChunksVectorCache.allMiniLmL6V2"]?.[0]?.get(
                            3903773671,
                        ),
                    ],
                    [2125688697, expect.any(Array)],
                    [
                        2963917712,
                        doc?.fields["embeddingChunksVectorCache.allMiniLmL6V2"]?.[0]?.get(
                            2963917712,
                        ),
                    ],
                ]),
            ],
        },
    });
});

test("returns the right chunk when searching for embeddings", async () => {
    const languageModel = await AllMiniLmL6V2Model.new();

    const embedQuery = async (query: string) => {
        const [vector] = await languageModel.embed(context.tracer.getTracer(), query);
        assert(vector);
        return Array.from(vector);
    };

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    const document = await TestDocument.create(session, {
        id: documentId,
        content: wikipediaYoutubeDocumentContent.get(),
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        new Date(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: "Any",
            },
        },
    );

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 1,
                query: {
                    nested: {
                        path: "embeddingChunks",
                        inner_hits: {
                            size: 1,
                            _source: false,
                            stored_fields: ["embeddingChunks.text"],
                        },
                        query: {
                            knn: {
                                "embeddingChunks.vector.allMiniLmL6V2": {
                                    vector: new OpensearchQueryValue(
                                        await embedQuery("where did the founders meet"),
                                    ),
                                    k: 100,
                                    filter: {
                                        term: {
                                            "embeddingChunks.spaceId": new OpensearchQueryValue(
                                                space.id,
                                            ),
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            score: expect.any(Number),
            innerHits: {
                embeddingChunks: [
                    {
                        offset: 1,
                        fields: {
                            "embeddingChunks.text": [
                                `This is from the “YouTube” document:

## History

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim. The trio were early employees of PayPal, which left them enriched after the company was bought by eBay. Hurley had studied design at the Indiana University of Pennsylvania, and Chen and Karim studied computer science together at the University of Illinois Urbana-Champaign.

According to a story that has often been repeated in the media, Hurley and Chen developed the idea for YouTube during the early months of 2005, after they had experienced difficulty sharing videos that had been shot at a dinner party at Chen's apartment in San Francisco. Karim did not attend the party and denied that it had occurred, but Chen remarked that the idea that YouTube was founded after a dinner party "was probably very strengthened by marketing ideas around creating a story that was very digestible".

YouTube began as a venture capital–funded technology startup. Between November 2005 and April 2006, the company raised money from various investors, with Sequoia Capital and Artis Capital Management being the largest two. YouTube's early headquarters were situated above a pizzeria and a Japanese restaurant in San Mateo, California. In February 2005, the company activated www.youtube.com. The first video was uploaded on April 23, 2005. Titled "Me at the zoo", it shows co-founder Jawed Karim at the San Diego Zoo and can still be viewed on the site. In May, the company launched a public beta and by November, a Nike ad featuring Ronaldinho became the first video to reach one million total views. The site launched officially on December 15, 2005, by which time the site was receiving 8 million views a day. Clips at the time were limited to 100 megabytes, as little as 30 seconds of footage.`,
                            ],
                        },
                    },
                ],
            },
        },
    ]);
});

test("can search based on vector embeddings", async () => {
    const languageModel = await AllMiniLmL6V2Model.new();

    const embedQuery = async (query: string) => {
        const [vector] = await languageModel.embed(context.tracer.getTracer(), query);
        assert(vector);
        return Array.from(vector);
    };

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document1 = await TestDocument.create(session, {
        // Part of the YouTube Wikipedia article:
        // https://en.wikipedia.org/wiki?curid=3524766
        content: assertDocumentContent(
            schema.node("doc", {}, [
                schema.node("title", {}, [schema.text("YouTube")]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "YouTube is an American online video sharing and social media platform. It is owned by Google and is the second most visited website in the world. YouTube has more than 2.5 billion monthly users, who collectively watch more than one billion hours of videos every day.",
                    ),
                ]),
            ]),
        ),
    });

    const document2 = await TestDocument.create(session, {
        // From the Reddit clustering dataset in the MTEB evaluation:
        // https://huggingface.co/datasets/mteb/reddit-clustering-p2p
        content: assertDocumentContent(
            schema.node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [
                    schema.text(
                        "How do you build suspense as a dungeon master? How do i make a foe so strong or scary that my players dont want to fight it but run instead just from meeting it?",
                    ),
                ]),
            ]),
        ),
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        new Date(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document1.id,
                updatedTraits: "Any",
            },
        },
    );

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        new Date(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document2.id,
                updatedTraits: "Any",
            },
        },
    );

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    nested: {
                        path: "embeddingChunks",
                        query: {
                            knn: {
                                "embeddingChunks.vector.allMiniLmL6V2": {
                                    vector: new OpensearchQueryValue(
                                        await embedQuery("video site"),
                                    ),
                                    k: 100,
                                    filter: {
                                        term: {
                                            "embeddingChunks.spaceId": new OpensearchQueryValue(
                                                space.id,
                                            ),
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ),
    ).toEqual([
        {id: `Document:${document1.id}`, score: expect.any(Number)},
        {id: `Document:${document2.id}`, score: expect.any(Number)},
    ]);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityIndex,
            space.id,
            {
                size: 100,
                query: {
                    nested: {
                        path: "embeddingChunks",
                        query: {
                            knn: {
                                "embeddingChunks.vector.allMiniLmL6V2": {
                                    vector: new OpensearchQueryValue(
                                        // These words aren't in our source material but the model should figure out
                                        // that "dungeon master" is associated with tabletop games and "scary" is
                                        // associated with suspense or running away.
                                        await embedQuery("scary tabletop game"),
                                    ),
                                    k: 100,
                                    filter: {
                                        term: {
                                            "embeddingChunks.spaceId": new OpensearchQueryValue(
                                                space.id,
                                            ),
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ),
    ).toEqual([
        {id: `Document:${document2.id}`, score: expect.any(Number)},
        {id: `Document:${document1.id}`, score: expect.any(Number)},
    ]);
});
