import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {
    TestSessionActionContext,
    createTestContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {updateChannelName} from "~/server/forum/data/forum_table.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    AllMiniLmL6V2LanguageModel,
    allMiniLmL6V2LanguageModelEmbedTextTestCounter,
} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {opensearchIndexEnglishWithWordDelimiterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {getDocumentSearchEntityTestCheckpoint} from "~/server/search/data/index/internal/get_search_entity.js";
import {
    getSearchEntitiesTitleAndMediaIfExist,
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    processSearchEntityJobFinishedTestCheckpoint,
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
} from "~/server/search/data/index/search_entity_index.js";
import {markSearchAffinityInteraction} from "~/server/search/data/table/search_entity_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {updateTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {wikipediaYoutubeDocumentContent} from "~/shared/documents/fixtures/wikipedia_youtube_document_content.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

const schema = DocumentContentProsemirrorSchema;
const {SearchEntityKeywordIndex, SearchEntitySemanticIndex} = getSearchEntityIndexesForTest();

let languageModel: AllMiniLmL6V2LanguageModel;
beforeAll(async () => {
    languageModel = await AllMiniLmL6V2LanguageModel.new();
});

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                await processIndexSearchEntityJob(
                    actionContext.clone({
                        languageModel: new LanguageModelContextModule(languageModel),
                    }),
                    job,
                    jobStartTime,
                );
                break;
            }
            default: {
                // Ignore all other jobs...
                break;
            }
        }
    },
});

test("can index and reindex a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([]);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([]);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            score: expect.any(Number),
            fields: {},
        },
    ]);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([]);

    await document.type(session, " A new sentence, wow.");

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number), fields: {}}]);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number), fields: {}}]);
});

test("can highlight a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            score: expect.any(Number),
            fields: {},
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
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual(null);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    const {primaryTerm, sequenceNumber: sequenceNumberBase} = assertExists(
        (
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `Document:${document.id}`,
            )
        )?.version,
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        version: {primaryTerm, sequenceNumber: sequenceNumberBase},
        fields: {},
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        version: {primaryTerm, sequenceNumber: sequenceNumberBase + 1},
        fields: {},
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        version: {primaryTerm, sequenceNumber: sequenceNumberBase + 2},
        fields: {},
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(Date.now() - 4 * 60 * 1000),
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({
        id: `Document:${document.id}`,
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

    const job1Promise = processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    const pause1 = await pause1Promise;
    pause1.stopPausing();

    await document.type(session, " A new sentence, wow.");

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    pause1.unpause();
    await job1Promise;

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number), fields: {}}]);
});

test("will correctly index during race condition (scenario 2)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    const pause1Promise = getDocumentSearchEntityTestCheckpoint.pauseForTest(document.id);

    const job1Promise = processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    const pause1 = await pause1Promise;
    pause1.stopPausing();

    await document.type(session, " A new sentence, wow.");

    const pause2Promise = getDocumentSearchEntityTestCheckpoint.pauseForTest(document.id);

    const job2Promise = processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    const pause2 = await pause2Promise;
    pause2.stopPausing();

    pause1.unpause();
    await job1Promise;

    pause2.unpause();
    await job2Promise;

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityKeywordIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([{id: `Document:${document.id}`, score: expect.any(Number), fields: {}}]);
});

test("goes from no embeddings to some embeddings to no embeddings again", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual(null);

    const {newInvertedSteps} = await document.type(
        session,
        " Add enough content that we'll need to embed. Should have more than thirty five tokens. I think I need another sentence.",
    );

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            "embeddingChunksVectorCache.allMiniLmL6V2": [new Map([[673655517, expect.any(Array)]])],
        },
    });

    await document.update(session, newInvertedSteps);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {},
    });
});

test("goes from no embeddings to some embeddings to no embeddings again with race conditions", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    // Race 5 job processors...
    await runAllPromises(
        createArrayWithLength(5, () =>
            processIndexSearchEntityJob(
                TestTask.systemAction(space).clone({
                    languageModel: new LanguageModelContextModule(languageModel),
                }),
                {
                    type: "IndexSearchEntity",
                    spaceId: space.id,
                    update: {
                        type: "Document",
                        documentId: document.id,
                        updatedTraits: {type: "Any"},
                    },
                },
                new Date(),
            ),
        ),
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual(null);

    const {newInvertedSteps} = await document.type(
        session,
        " Add enough content that we'll need to embed. Should have more than thirty five tokens. I think I need another sentence.",
    );

    // Race 5 job processors...
    await runAllPromises(
        createArrayWithLength(5, () =>
            processIndexSearchEntityJob(
                TestTask.systemAction(space).clone({
                    languageModel: new LanguageModelContextModule(languageModel),
                }),
                {
                    type: "IndexSearchEntity",
                    spaceId: space.id,
                    update: {
                        type: "Document",
                        documentId: document.id,
                        updatedTraits: {type: "Any"},
                    },
                },
                new Date(),
            ),
        ),
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            "embeddingChunksVectorCache.allMiniLmL6V2": [new Map([[673655517, expect.any(Array)]])],
        },
    });

    await document.update(session, newInvertedSteps);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {},
    });
});

test("generates embeddings and only regenerates embeddings for chunks that changed", async () => {
    const {getCount} = allMiniLmL6V2LanguageModelEmbedTextTestCounter.recordForTest();

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    expect(getCount()).toEqual(0);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${documentId}`,
            {storedFields: ["embeddingChunks.text", "embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual(null);

    const document = await TestDocument.create(session, {
        id: documentId,
        content: wikipediaYoutubeDocumentContent.get(),
    });

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(getCount()).toEqual(3);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        routing: space.id,
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

    const doc = await context.opensearch.getDocWithoutSourceIfExists(
        SearchEntitySemanticIndex,
        space.id,
        `Document:${document.id}`,
        {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
    );

    await document.update(session, [
        new ReplaceStep(2700, 2710, new Slice(Fragment.from(schema.text("ASDASDASDA")), 0, 0)),
    ]);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(getCount()).toEqual(4);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        routing: space.id,
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

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntitySemanticIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntitySemanticIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            score: expect.any(Number),
            fields: {},
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

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntitySemanticIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntitySemanticIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([
        {id: `Document:${document1.id}`, score: expect.any(Number), fields: {}},
        {id: `Document:${document2.id}`, score: expect.any(Number), fields: {}},
    ]);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntitySemanticIndex, space.id, {
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
            })
            .then(({hits}) => hits),
    ).toEqual([
        {id: `Document:${document2.id}`, score: expect.any(Number), fields: {}},
        {id: `Document:${document1.id}`, score: expect.any(Number), fields: {}},
    ]);
});

test("will reindex if a dependency changes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {name: "Test"});

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    const post1 = await channel.createPost(
        session,
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.",
    );

    const post2 = await channel.createPost(
        session,
        "Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.",
    );

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntitySemanticIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntitySemanticIndex, space.id, {
                size: 100,
                query: {
                    nested: {
                        path: "embeddingChunks",
                        query: {
                            term: {"embeddingChunks.spaceId": new OpensearchQueryValue(space.id)},
                        },
                        inner_hits: {
                            size: 100,
                            _source: false,
                            stored_fields: ["embeddingChunks.text"],
                        },
                    },
                },
            })
            .then(({hits}) => hits.sort((doc1, doc2) => defaultCompareStrings(doc1.id, doc2.id))),
    ).toEqual(
        [
            {
                id: `Post:${post1.id}`,
                score: expect.any(Number),
                fields: {},
                innerHits: {
                    embeddingChunks: [
                        {
                            offset: 0,
                            fields: {
                                "embeddingChunks.text": [
                                    `This is a post in the “Test” channel:

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.`,
                                ],
                            },
                        },
                    ],
                },
            },
            {
                id: `Post:${post2.id}`,
                score: expect.any(Number),
                fields: {},
                innerHits: {
                    embeddingChunks: [
                        {
                            offset: 0,
                            fields: {
                                "embeddingChunks.text": [
                                    `This is a post in the “Test” channel:

Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.`,
                                ],
                            },
                        },
                    ],
                },
            },
        ].sort((doc1, doc2) => defaultCompareStrings(doc1.id, doc2.id)),
    );

    const pause1Promise = processSearchEntityJobFinishedTestCheckpoint.pauseForTest(
        `Channel:${channel.id}`,
    );
    const pause2Promise = processSearchEntityJobFinishedTestCheckpoint.pauseForTest(
        `Post:${post1.id}`,
    );
    const pause3Promise = processSearchEntityJobFinishedTestCheckpoint.pauseForTest(
        `Post:${post2.id}`,
    );

    await updateChannelName(session.action(), {
        channelId: channel.id,
        name: "Lorem Ipsum",
    });

    import.meta.jest.runOnlyPendingTimers();

    (await pause1Promise).unpause();
    (await pause2Promise).unpause();
    (await pause3Promise).unpause();

    await context.opensearch.refresh(SearchEntitySemanticIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntitySemanticIndex, space.id, {
                size: 100,
                query: {
                    nested: {
                        path: "embeddingChunks",
                        query: {
                            term: {"embeddingChunks.spaceId": new OpensearchQueryValue(space.id)},
                        },
                        inner_hits: {
                            size: 100,
                            _source: false,
                            stored_fields: ["embeddingChunks.text"],
                        },
                    },
                },
            })
            .then(({hits}) => hits.sort((doc1, doc2) => defaultCompareStrings(doc1.id, doc2.id))),
    ).toEqual(
        [
            {
                id: `Post:${post1.id}`,
                score: expect.any(Number),
                fields: {},
                innerHits: {
                    embeddingChunks: [
                        {
                            offset: 0,
                            fields: {
                                "embeddingChunks.text": [
                                    `This is a post in the “Lorem Ipsum” channel:

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.`,
                                ],
                            },
                        },
                    ],
                },
            },
            {
                id: `Post:${post2.id}`,
                score: expect.any(Number),
                fields: {},
                innerHits: {
                    embeddingChunks: [
                        {
                            offset: 0,
                            fields: {
                                "embeddingChunks.text": [
                                    `This is a post in the “Lorem Ipsum” channel:

Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.`,
                                ],
                            },
                        },
                    ],
                },
            },
        ].sort((doc1, doc2) => defaultCompareStrings(doc1.id, doc2.id)),
    );
});

test("deleting a chat message will clear out its indexed content", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const chat = await TestChat.get(session1, session2);

    const message = await chat.sendMessage(
        session1,
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id.",
    );

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-0`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-0`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id.",
            ],
        },
    });

    await message.delete(session1);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-0`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-0`,
        routing: space.id,
        version: expect.any(Object),
        fields: {},
    });
});

test("ignores formatting characters when analyzing text", async () => {
    expect(
        await context.opensearch
            .analyze(
                SearchEntityKeywordIndex,
                opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
                "This is some **bold text**, wow",
            )
            .then(tokens => tokens.map(({token}) => token)),
    ).toEqual(["thi", "is", "some", "bold", "text", "wow"]);

    expect(
        await context.opensearch
            .analyze(
                SearchEntityKeywordIndex,
                opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
                "This asterisk\\* is referring to some note\n\n\\* That would be here la la la",
            )
            .then(tokens => tokens.map(({token}) => token)),
    ).toEqual([
        "thi",
        "asterisk",
        "is",
        "refer",
        "to",
        "some",
        "note",
        "that",
        "would",
        "be",
        "here",
        "la",
        "la",
        "la",
    ]);

    expect(
        await context.opensearch
            .analyze(
                SearchEntityKeywordIndex,
                opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
                `\
# A header

> A quote block by some wise person

- Followed by a list
- Of a couple items
- Another one

Or an ordered list?

1. Do this first
2. Then this second
3. Maybe something else third
`,
            )
            .then(tokens => tokens.map(({token}) => token)),
    ).toEqual([
        "a",
        "header",
        "a",
        "quot",
        "block",
        "by",
        "some",
        "wise",
        "person",
        "follow",
        "by",
        "a",
        "list",
        "of",
        "a",
        "coupl",
        "item",
        "anoth",
        "on",
        "or",
        "an",
        "order",
        "list",
        "1",
        "do",
        "thi",
        "first",
        "2",
        "then",
        "thi",
        "second",
        "3",
        "mayb",
        "someth",
        "els",
        "third",
    ]);
});

test("contractions stay when analyzing text", async () => {
    expect(
        await context.opensearch
            .analyze(
                SearchEntityKeywordIndex,
                opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
                "Grossman commented on his non-conservative play style in a 2017 interview stating, \"Coach Spurrier instilled in me, don't check down if the big play's there. So that’s kind of how I was born. I always wanted to shoot a three-pointer in basketball, hit a home run in baseball. I don't know why, that's just, like, who I am.\" During Week 12 of the 2006 season, Grossman threw a game-ending interception while attempting a deep pass to Rashied Davis.",
            )
            .then(tokens => tokens.map(({token}) => token)),
    ).toEqual([
        "grossman",
        "comment",
        "on",
        "hi",
        "non",
        "conserv",
        "plai",
        "style",
        "in",
        "a",
        "2017",
        "interview",
        "state",
        "coach",
        "spurrier",
        "instil",
        "in",
        "me",
        "don",
        "t",
        "check",
        "down",
        "if",
        "the",
        "big",
        "plai",
        "there",
        "so",
        "that",
        "kind",
        "of",
        "how",
        "i",
        "wa",
        "born",
        "i",
        "alwai",
        "want",
        "to",
        "shoot",
        "a",
        "three",
        "pointer",
        "in",
        "basketbal",
        "hit",
        "a",
        "home",
        "run",
        "in",
        "basebal",
        "i",
        "don",
        "t",
        "know",
        "why",
        "that",
        "just",
        "like",
        "who",
        "i",
        "am",
        "dure",
        "week",
        "12",
        "of",
        "the",
        "2006",
        "season",
        "grossman",
        "threw",
        "a",
        "game",
        "end",
        "intercept",
        "while",
        "attempt",
        "a",
        "deep",
        "pass",
        "to",
        "rashi",
        "davi",
    ]);
});

test("search by keywords only sees entities the account has access to", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1, {title: "test"});
    await document.access.grantDefault(session1);
    const otherDocument = await TestDocument.create(otherSession, {title: "test"});
    await otherDocument.access.grantDefault(otherSession);
    const task1 = await TestTask.create(session1, {title: "test"});
    const task2 = await TestTask.create(session2, {title: "test"});
    const task3 = await TestTask.create(session2, {title: "test"});
    const task4 = await TestTask.create(session2, {title: "test"});
    const task5 = await TestTask.create(session2, {title: "test"});
    const collection1 = await TestTaskCollection.create(session2, {name: "test"});
    await collection1.access.grantDefault(session2);
    const collection2 = await TestTaskCollection.create(session2, {name: "test"});
    const collection3 = await TestTaskCollection.create(session2, {name: "test"});
    await collection3.access.grant(session2, session1);

    await task3.addCollection(session2, collection1);
    await task4.addCollection(session2, collection2);
    await task5.addCollection(session2, collection3);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntitySemanticIndex);

    await expect(
        searchByKeywords(otherSession.action(), {
            spaceId: space.id,
            queryText: "test",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        (
            await searchByKeywords(otherSession.action(), {
                spaceId: otherSpace.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        ).results
            .map(result => result.id)
            .sort(defaultCompareStrings),
    ).toEqual(
        [`Account:${otherSession.account.id}`, `Document:${otherDocument.id}`].sort(
            defaultCompareStrings,
        ),
    );

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
            .sort(defaultCompareStrings),
    ).toEqual(
        [
            `Account:${session1.account.id}`,
            `Account:${session2.account.id}`,
            `Document:${document.id}`,
            `Task:${task1.id}`,
            `Task:${task3.id}`,
            `Task:${task5.id}`,
            `TaskCollection:${collection1.id}`,
            `TaskCollection:${collection3.id}`,
        ].sort(defaultCompareStrings),
    );

    expect(
        (
            await searchByKeywords(session2.action(), {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            })
        ).results
            .map(result => result.id)
            .sort(defaultCompareStrings),
    ).toEqual(
        [
            `Account:${session1.account.id}`,
            `Account:${session2.account.id}`,
            `Document:${document.id}`,
            `Task:${task2.id}`,
            `Task:${task3.id}`,
            `Task:${task4.id}`,
            `Task:${task5.id}`,
            `TaskCollection:${collection1.id}`,
            `TaskCollection:${collection2.id}`,
            `TaskCollection:${collection3.id}`,
        ].sort(defaultCompareStrings),
    );
});

test("search by semantics only sees entities the account has access to", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const testBody = createArrayWithLength(100, () => "test").join(" ");

    const document = await TestDocument.create(session1, {body: testBody});
    await document.access.grantDefault(session1);
    const otherDocument = await TestDocument.create(otherSession, {body: testBody});
    await otherDocument.access.grantDefault(otherSession);
    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session2);
    const task3 = await TestTask.create(session2);
    const task4 = await TestTask.create(session2);
    const task5 = await TestTask.create(session2);
    const collection1 = await TestTaskCollection.create(session2);
    await collection1.access.grantDefault(session2);
    const collection2 = await TestTaskCollection.create(session2);
    const collection3 = await TestTaskCollection.create(session2);
    await collection3.access.grant(session2, session1);

    for (const taskId of [task1.id, task2.id, task3.id, task4.id, task5.id]) {
        await updateTaskNotesContent(task1.id === taskId ? session1.action() : session2.action(), {
            spaceId: space.id,
            taskId,
            version: 0,
            steps: [
                new ReplaceStep(
                    1,
                    1,
                    new Slice(
                        Fragment.from([TaskNotesContentProsemirrorSchema.text(testBody)]),
                        0,
                        0,
                    ),
                ),
            ],
        });
    }

    await task3.addCollection(session2, collection1);
    await task4.addCollection(session2, collection2);
    await task5.addCollection(session2, collection3);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntitySemanticIndex);

    await expect(
        searchBySemantics(
            otherSession
                .action()
                .clone({languageModel: new LanguageModelContextModule(languageModel)}),
            {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        (
            await searchBySemantics(
                otherSession
                    .action()
                    .clone({languageModel: new LanguageModelContextModule(languageModel)}),
                {
                    spaceId: otherSpace.id,
                    queryText: "test",
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                },
            )
        ).results
            .map(result => result.id)
            .sort(defaultCompareStrings),
    ).toEqual([`Document:${otherDocument.id}`].sort(defaultCompareStrings));

    expect(
        (
            await searchBySemantics(
                session1
                    .action()
                    .clone({languageModel: new LanguageModelContextModule(languageModel)}),
                {
                    spaceId: space.id,
                    queryText: "test",
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                },
            )
        ).results
            .map(result => result.id)
            .sort(defaultCompareStrings),
    ).toEqual(
        [
            `Document:${document.id}`,
            `Task:${task1.id}`,
            `Task:${task3.id}`,
            `Task:${task5.id}`,
        ].sort(defaultCompareStrings),
    );

    expect(
        (
            await searchBySemantics(
                session2
                    .action()
                    .clone({languageModel: new LanguageModelContextModule(languageModel)}),
                {
                    spaceId: space.id,
                    queryText: "test",
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                },
            )
        ).results
            .map(result => result.id)
            .sort(defaultCompareStrings),
    ).toEqual(
        [
            `Document:${document.id}`,
            `Task:${task2.id}`,
            `Task:${task3.id}`,
            `Task:${task4.id}`,
            `Task:${task5.id}`,
        ].sort(defaultCompareStrings),
    );
});

test("get search entities only sees entities the account has access to", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);
    const otherDocument = await TestDocument.create(otherSession, {title: "test"});
    await otherDocument.access.grantDefault(otherSession);
    const task1 = await TestTask.create(session1, {title: "test"});
    const task2 = await TestTask.create(session2, {title: "test"});
    const task3 = await TestTask.create(session2, {title: "test"});
    const task4 = await TestTask.create(session2, {title: "test"});
    const task5 = await TestTask.create(session2, {title: "test"});
    const collection1 = await TestTaskCollection.create(session2);
    await collection1.access.grantDefault(session2);
    const collection2 = await TestTaskCollection.create(session2, {name: "test"});
    const collection3 = await TestTaskCollection.create(session2, {name: "test"});
    await collection3.access.grant(session2, session1);

    await task3.addCollection(session2, collection1);
    await task4.addCollection(session2, collection2);
    await task5.addCollection(session2, collection3);

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntitySemanticIndex);

    const getSearchEntityIds = async (context: TestSessionActionContext, space: TestSpace) => {
        const entities = await getSearchEntitiesTitleAndMediaIfExist(context, {
            spaceId: space.id,
            entityIds: [
                `Document:${document.id}`,
                `Document:${otherDocument.id}`,
                `Task:${task1.id}`,
                `Task:${task2.id}`,
                `Task:${task3.id}`,
                `Task:${task4.id}`,
                `Task:${task5.id}`,
                `TaskCollection:${collection1.id}`,
                `TaskCollection:${collection2.id}`,
                `TaskCollection:${collection3.id}`,
            ],
        });

        return filterMapArray(entities, entity =>
            typeof entity !== "string" ? entity.id : undefined,
        ).sort(defaultCompareStrings);
    };

    await expect(getSearchEntityIds(otherSession.action(), space)).rejects.toThrow(
        PermissionDeniedError,
    );

    expect(await getSearchEntityIds(otherSession.action(), otherSpace)).toEqual(
        [`Document:${otherDocument.id}`].sort(defaultCompareStrings),
    );

    expect(await getSearchEntityIds(session1.action(), space)).toEqual(
        [
            `Document:${document.id}`,
            `Task:${task1.id}`,
            `Task:${task3.id}`,
            `Task:${task5.id}`,
            `TaskCollection:${collection1.id}`,
            `TaskCollection:${collection3.id}`,
        ].sort(defaultCompareStrings),
    );

    expect(await getSearchEntityIds(session2.action(), space)).toEqual(
        [
            `Document:${document.id}`,
            `Task:${task2.id}`,
            `Task:${task3.id}`,
            `Task:${task4.id}`,
            `Task:${task5.id}`,
            `TaskCollection:${collection1.id}`,
            `TaskCollection:${collection2.id}`,
            `TaskCollection:${collection3.id}`,
        ].sort(defaultCompareStrings),
    );
});

test("search by semantics will highlight matching words", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "This is a test",
        body: `The body also contains the word “test.” Nice. ${createArrayWithLength(
            100,
            () => "test",
        ).join(" ")}`,
    });

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntitySemanticIndex);

    expect(
        await searchBySemantics(
            session.action().clone({languageModel: new LanguageModelContextModule(languageModel)}),
            {
                spaceId: space.id,
                queryText: "test",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            },
        ),
    ).toEqual({
        results: [
            {
                id: `Document:${document.id}`,
                score: expect.any(Number),
                title: "This is a test",
                bodyTextSnippet: [
                    {text: "The body also contains the word “", isHighlighted: false},
                    {text: "test", isHighlighted: true},
                    {text: ".” Nice. ", isHighlighted: false},
                    ...createArrayWithLength(100, i =>
                        i === 0
                            ? [{text: "test", isHighlighted: true}]
                            : [
                                  {text: " ", isHighlighted: false},
                                  {text: "test", isHighlighted: true},
                              ],
                    ).flat(),
                ],
                media: null,
            },
        ],
    });
});

test("searches with natural language parsing works", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "John Smith"});
    const session2 = await space.createSession({name: "Sara Smith"});

    const document1 = await TestDocument.create(session1, {
        title: "Test 1",
        body: "Trains! Trains!",
    });
    await document1.access.grantDefault(session1);

    // So the next `createdTime` is larger...
    import.meta.jest.advanceTimersByTime(1000);

    const document2 = await TestDocument.create(session2, {
        title: "Test 2",
        body: "By: John. Trains!",
    });
    await document2.access.grantDefault(session2);

    // So the next `createdTime` is larger...
    import.meta.jest.advanceTimersByTime(1000);

    const document3 = await TestDocument.create(session1, {
        title: "Test 3",
        body: "By: Sara",
    });
    await document3.access.grantDefault(session1);

    // So the next `createdTime` is larger...
    import.meta.jest.advanceTimersByTime(1000);

    const document4 = await TestDocument.create(session1, {
        title: "Test 4",
        body: "By: John. Trains! Trains!",
    });
    await document4.access.grantDefault(session1);

    // So the next `createdTime` is larger...
    import.meta.jest.advanceTimersByTime(1000);

    const document5 = await TestDocument.create(session2, {
        title: "Test 5",
        body: "By: Sara",
    });
    await document5.access.grantDefault(session2);

    // So the next `createdTime` is larger...
    import.meta.jest.advanceTimersByTime(1000);

    const channel = await TestChannel.create(session1, {
        name: "Transit Enjoyers",
    });

    const post = await channel.createPost(
        session1,
        "Trains! Trains! Trains! Trains! Trains! Trains! Trains! Trains! Trains! Check out this trains document.",
    );

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! Check out this "},
                    {isHighlighted: true, text: "trains"},
                    {isHighlighted: false, text: " document."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
            {
                id: `Document:${document1.id}`,
                score: expect.any(Number),
                title: "Test 1",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Document:${document4.id}`,
                score: expect.any(Number),
                title: "Test 4",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Document:${document2.id}`,
                score: expect.any(Number),
                title: "Test 2",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
        ],
    });

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document1.id}`,
                score: expect.any(Number),
                title: "Test 1",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Document:${document4.id}`,
                score: expect.any(Number),
                title: "Test 4",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Document:${document2.id}`,
                score: expect.any(Number),
                title: "Test 2",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! Check out this "},
                    {isHighlighted: true, text: "trains"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "document"},
                    {isHighlighted: false, text: "."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
        ],
    });

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "my documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document4.id}`,
                score: expect.any(Number),
                title: "Test 4",
                bodyTextSnippet: [{isHighlighted: false, text: "By: John. Trains! Trains!"}],
                media: null,
            },
            {
                id: `Document:${document3.id}`,
                score: expect.any(Number),
                title: "Test 3",
                bodyTextSnippet: [{isHighlighted: false, text: "By: Sara"}],
                media: null,
            },
            {
                id: `Document:${document1.id}`,
                score: expect.any(Number),
                title: "Test 1",
                bodyTextSnippet: [{isHighlighted: false, text: "Trains! Trains!"}],
                media: null,
            },
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: false, text: "Check out this trains "},
                    {isHighlighted: true, text: "document"},
                    {isHighlighted: false, text: "."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
        ],
    });

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "my documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document1.id}`,
                score: expect.any(Number),
                title: "Test 1",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Document:${document4.id}`,
                score: expect.any(Number),
                title: "Test 4",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! Check out this "},
                    {isHighlighted: true, text: "trains"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "document"},
                    {isHighlighted: false, text: "."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
        ],
    });

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "sara's documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document2.id}`,
                score: expect.any(Number),
                title: "Test 2",
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "!"},
                ],
                media: null,
            },
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! "},
                    {isHighlighted: true, text: "Trains"},
                    {isHighlighted: false, text: "! Check out this "},
                    {isHighlighted: true, text: "trains"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "document"},
                    {isHighlighted: false, text: "."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
        ],
    });

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "sara's documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document5.id}`,
                score: expect.any(Number),
                title: "Test 5",
                bodyTextSnippet: [
                    {isHighlighted: false, text: "By: "},
                    {isHighlighted: true, text: "Sara"},
                ],
                media: null,
            },
            {
                id: `Document:${document2.id}`,
                score: expect.any(Number),
                title: "Test 2",
                bodyTextSnippet: [{isHighlighted: false, text: "By: John. Trains!"}],
                media: null,
            },
            {
                id: `Account:${session2.account.id}`,
                score: expect.any(Number),
                title: "Sara Smith",
                bodyTextSnippet: [],
                media: {
                    type: "Account",
                    account: await session2.get(),
                },
            },
            {
                id: `Document:${document3.id}`,
                score: expect.any(Number),
                title: "Test 3",
                bodyTextSnippet: [
                    {isHighlighted: false, text: "By: "},
                    {isHighlighted: true, text: "Sara"},
                ],
                media: null,
            },
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: false, text: "Check out this trains "},
                    {isHighlighted: true, text: "document"},
                    {isHighlighted: false, text: "."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
        ],
    });

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "johns's documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document4.id}`,
                score: expect.any(Number),
                title: "Test 4",
                bodyTextSnippet: [
                    {isHighlighted: false, text: "By: "},
                    {isHighlighted: true, text: "John"},
                    {isHighlighted: false, text: ". Trains! Trains!"},
                ],
                media: null,
            },
            {
                id: `Document:${document3.id}`,
                score: expect.any(Number),
                title: "Test 3",
                bodyTextSnippet: [{isHighlighted: false, text: "By: Sara"}],
                media: null,
            },
            {
                id: `Document:${document1.id}`,
                score: expect.any(Number),
                title: "Test 1",
                bodyTextSnippet: [{isHighlighted: false, text: "Trains! Trains!"}],
                media: null,
            },
            {
                id: `Account:${session1.account.id}`,
                score: expect.any(Number),
                title: "John Smith",
                bodyTextSnippet: [],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
            {
                id: `Document:${document2.id}`,
                score: expect.any(Number),
                title: "Test 2",
                bodyTextSnippet: [
                    {isHighlighted: false, text: "By: "},
                    {isHighlighted: true, text: "John"},
                    {isHighlighted: false, text: ". Trains!"},
                ],
                media: null,
            },
            {
                id: `Post:${post.id}`,
                score: expect.any(Number),
                title: null,
                bodyTextSnippet: [
                    {isHighlighted: false, text: "Check out this trains "},
                    {isHighlighted: true, text: "document"},
                    {isHighlighted: false, text: "."},
                ],
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            },
        ],
    });
});

test("highlighting bullet points with bold formatting works well", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        content: assertDocumentContent(
            schema.node("doc", null, [
                schema.node("title", null, [
                    schema.text("Document with bullet points that have strong titles"),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Culinary Delights:", [schema.mark("bold")]),
                        schema.text(" Exploring diverse cuisines to satisfy your taste buds"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Healthy Habits:", [schema.mark("bold")]),
                        schema.text(" Incorporating nutrient-rich foods for a balanced diet"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Kitchen Adventures:", [schema.mark("bold")]),
                        schema.text(" Trying out new recipes and cooking techniques"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Global Gastronomy:", [schema.mark("bold")]),
                        schema.text(" Sampling iconic dishes from around the world"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Foodie Travel:", [schema.mark("bold")]),
                        schema.text(" Discovering the best eats while traveling"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Farm-to-Table Experience:", [schema.mark("bold")]),
                        schema.text(" Enjoying the freshness of locally sourced ingredients"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Sweet Indulgences:", [schema.mark("bold")]),
                        schema.text(" Exploring the world of decadent desserts and sweets"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Spice Chronicles:", [schema.mark("bold")]),
                        schema.text(" Delving into the diverse world of spices and their uses"),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", null, [
                        schema.text("Homemade Happiness:", [schema.mark("bold")]),
                        schema.text(" Finding joy in preparing and sharing home-cooked meals"),
                    ]),
                ]),
            ]),
        ),
    });

    import.meta.jest.runOnlyPendingTimers();
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "locally sourced",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document.id}`,
                score: expect.any(Number),
                title: "Document with bullet points that have strong titles",
                bodyTextSnippet: [
                    {
                        isHighlighted: false,
                        text: "Culinary Delights: Exploring diverse cuisines to satisfy your taste buds. Healthy Habits: Incorporating nutrient-rich foods for a balanced diet. Kitchen Adventures: Trying out new recipes and cooking techniques. Global Gastronomy: Sampling iconic dishes from around the world. Foodie Travel: Discovering the best eats while traveling. Farm-to-Table Experience: Enjoying the freshness of ",
                    },
                    {isHighlighted: true, text: "locally"},
                    {isHighlighted: false, text: " "},
                    {isHighlighted: true, text: "sourced"},
                    {
                        isHighlighted: false,
                        text: " ingredients. Sweet Indulgences: Exploring the world of decadent desserts and sweets",
                    },
                ],
                media: null,
            },
        ],
    });
});

test("search by affinity can include the task notepad", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "Test Document 1"});
    const document2 = await TestDocument.create(session2, {title: "Test Document 2"});
    await document2.access.grantDefault(session2);

    await markSearchAffinityInteraction(session1.action(), {
        spaceId: space.id,
        affinityId: "TaskNotepad",
        interaction: {type: "HighIntentUpdate"},
    });

    await markSearchAffinityInteraction(session1.action(), {
        spaceId: space.id,
        affinityId: `Document:${document2.id}`,
        interaction: {type: "View"},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        await searchByAffinity(session1.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual({
        results: [
            {
                id: `Document:${document1.id}`,
                score: expect.closeTo(60),
                title: "Test Document 1",
                bodyTextSnippet: [],
                media: null,
            },
            {
                id: "TaskNotepad",
                score: expect.closeTo(3),
                title: "Task notepad",
                bodyTextSnippet: [],
                media: null,
            },
            {
                id: `Document:${document2.id}`,
                score: expect.closeTo(1),
                title: "Test Document 2",
                bodyTextSnippet: [],
                media: null,
            },
        ],
    });
});
