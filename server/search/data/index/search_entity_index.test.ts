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
import {opensearchClientExecuteOperationTestCounter} from "~/server/opensearch/opensearch_client.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {getDocumentSearchEntityTestCheckpoint} from "~/server/search/data/index/internal/get_search_entity.js";
import {
    getSearchEntityIfPossible,
    getSearchEntityIndexesForTest,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
    searchMentionByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {
    favoriteSearchEntity,
    markSearchAffinityEntityInteraction,
    unfavoriteSearchEntity,
} from "~/server/search/data/table/search_entity_table.js";
import {updateSpaceAccountSettings} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {updateTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {wikipediaYoutubeDocumentContent} from "~/shared/documents/fixtures/wikipedia_youtube_document_content.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchAffinityEntityModel, SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
    SearchFavoriteEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Run all timers and any promises passed until `context.process.waitUntil()`
 * until there are no timers or `context.process.waitUntil()` promises.
 */
async function runAllTimersAndWaitForTestTasks() {
    await ProcessContextModule.waitForTestTasks();

    while (import.meta.jest.getTimerCount() > 0) {
        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    }
}

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
const {SearchEntityKeywordIndex, SearchEntityEmbeddingChunkIndex} = getSearchEntityIndexesForTest();

let languageModel: AllMiniLmL6V2LanguageModel;
beforeAll(async () => {
    languageModel = await AllMiniLmL6V2LanguageModel.new();
});

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime, span) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                await processIndexSearchEntityJob(actionContext, job, jobStartTime, span);
                break;
            }
            case "IndexSearchEntityDependents": {
                await processIndexSearchEntityDependentsJob(actionContext, job);
                break;
            }
            case "IndexSearchEntityEmbeddingChunks": {
                await processIndexSearchEntityEmbeddingChunksJob(
                    actionContext.clone({
                        languageModel: new LanguageModelContextModule(languageModel),
                    }),
                    job,
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

    await runAllTimersAndWaitForTestTasks();

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

    await runAllTimersAndWaitForTestTasks();

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

    await runAllTimersAndWaitForTestTasks();

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

    await runAllTimersAndWaitForTestTasks();

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

    const noopSpan = {addData: () => {}};

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
        noopSpan,
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
        noopSpan,
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
        noopSpan,
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

    const noopSpan = {addData: () => {}};

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
        noopSpan,
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
        noopSpan,
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

    const noopSpan = {addData: () => {}};

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
        noopSpan,
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
        noopSpan,
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${document.id}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({hits: []});

    const {newInvertedSteps} = await document.type(
        session,
        " Add enough content that we’ll need to embed. Should have more than thirty five tokens. I think I need another sentence.",
    );

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${document.id}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({
        hits: [{id: expect.any(String), score: 0, fields: {textHash: [-1995329297]}}],
    });

    await document.update(session, newInvertedSteps);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${document.id}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({hits: []});
});

test("goes from no embeddings to some embeddings to no embeddings again with race conditions", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    const noopSpan = {addData: () => {}};

    // Race 5 job processors...
    await runAllPromises(
        createArrayWithLength(5, () =>
            processIndexSearchEntityJob(
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
                noopSpan,
            ),
        ),
    );

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${document.id}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({hits: []});

    const {newInvertedSteps} = await document.type(
        session,
        " Add enough content that we’ll need to embed. Should have more than thirty five tokens. I think I need another sentence.",
    );

    // Race 5 job processors...
    await runAllPromises(
        createArrayWithLength(5, () =>
            processIndexSearchEntityJob(
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
                noopSpan,
            ),
        ),
    );

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${document.id}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({
        hits: [{id: expect.any(String), score: 0, fields: {textHash: [-1995329297]}}],
    });

    await document.update(session, newInvertedSteps);

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
        noopSpan,
    );

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${document.id}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({hits: []});
});

test("generates embeddings and only regenerates embeddings for chunks that changed", async () => {
    const {getCount} = allMiniLmL6V2LanguageModelEmbedTextTestCounter.recordForTest();

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    expect(getCount()).toEqual(0);

    expect(
        await context.opensearch.searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
            size: 100,
            storedFields: ["text", "textHash"],
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "entity.id": new OpensearchQueryValue(`Document:${documentId}`),
                            },
                        },
                    ],
                },
            },
        }),
    ).toEqual({hits: []});

    const document = await TestDocument.create(session, {
        id: documentId,
        content: wikipediaYoutubeDocumentContent.get(),
    });

    await runAllTimersAndWaitForTestTasks();

    expect(getCount()).toEqual(3);

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 100,
                storedFields: ["textHash"],
                query: {
                    bool: {
                        filter: [
                            {
                                term: {
                                    "entity.id": new OpensearchQueryValue(`Document:${documentId}`),
                                },
                            },
                        ],
                    },
                },
            })
            .then(result => ({
                ...result,
                hits: result.hits
                    .slice()
                    .sort(
                        (hit1, hit2) =>
                            assertExists(hit1.fields.textHash?.[0]) -
                            assertExists(hit2.fields.textHash?.[0]),
                    ),
            })),
    ).toEqual({
        hits: [
            {id: expect.any(String), score: 0, fields: {textHash: [-550977725]}},
            {id: expect.any(String), score: 0, fields: {textHash: [-547555059]}},
            {id: expect.any(String), score: 0, fields: {textHash: [1468629499]}},
        ],
    });

    await document.update(session, [
        new ReplaceStep(2700, 2710, new Slice(Fragment.from(schema.text("ASDASDASDA")), 0, 0)),
    ]);

    await runAllTimersAndWaitForTestTasks();

    expect(getCount()).toEqual(4);

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 100,
                storedFields: ["textHash"],
                query: {
                    bool: {
                        filter: [
                            {
                                term: {
                                    "entity.id": new OpensearchQueryValue(`Document:${documentId}`),
                                },
                            },
                        ],
                    },
                },
            })
            .then(result => ({
                ...result,
                hits: result.hits
                    .slice()
                    .sort(
                        (hit1, hit2) =>
                            assertExists(hit1.fields.textHash?.[0]) -
                            assertExists(hit2.fields.textHash?.[0]),
                    ),
            })),
    ).toEqual({
        hits: [
            {id: expect.any(String), score: 0, fields: {textHash: [-550977725]}},
            {id: expect.any(String), score: 0, fields: {textHash: [-547555059]}},
            {id: expect.any(String), score: 0, fields: {textHash: [530046731]}},
        ],
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

    await TestDocument.create(session, {
        id: documentId,
        content: wikipediaYoutubeDocumentContent.get(),
    });

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 1,
                storedFields: ["text"],
                query: {
                    knn: {
                        "vector.allMiniLmL6V2": {
                            vector: new OpensearchQueryValue(
                                await embedQuery("where did the founders meet"),
                            ),
                            k: 100,
                            filter: {
                                term: {
                                    spaceId: new OpensearchQueryValue(space.id),
                                },
                            },
                        },
                    },
                },
            })
            .then(({hits}) => hits),
    ).toEqual([
        {
            id: expect.any(String),
            score: expect.closeTo(0.3615967),
            fields: {
                text: [
                    `This is from the “YouTube” document:

## History

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim. The trio were early employees of PayPal, which left them enriched after the company was bought by eBay. Hurley had studied design at the Indiana University of Pennsylvania, and Chen and Karim studied computer science together at the University of Illinois Urbana-Champaign.

According to a story that has often been repeated in the media, Hurley and Chen developed the idea for YouTube during the early months of 2005, after they had experienced difficulty sharing videos that had been shot at a dinner party at Chen’s apartment in San Francisco. Karim did not attend the party and denied that it had occurred, but Chen remarked that the idea that YouTube was founded after a dinner party “was probably very strengthened by marketing ideas around creating a story that was very digestible”.

YouTube began as a venture capital–funded technology startup. Between November 2005 and April 2006, the company raised money from various investors, with Sequoia Capital and Artis Capital Management being the largest two. YouTube’s early headquarters were situated above a pizzeria and a Japanese restaurant in San Mateo, California. In February 2005, the company activated www.youtube.com. The first video was uploaded on April 23, 2005. Titled “Me at the zoo”, it shows co-founder Jawed Karim at the San Diego Zoo and can still be viewed on the site. In May, the company launched a public beta and by November, a Nike ad featuring Ronaldinho became the first video to reach one million total views. The site launched officially on December 15, 2005, by which time the site was receiving 8 million views a day. Clips at the time were limited to 100 megabytes, as little as 30 seconds of footage.`,
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 100,
                storedFields: ["entity.id"],
                query: {
                    knn: {
                        "vector.allMiniLmL6V2": {
                            vector: new OpensearchQueryValue(await embedQuery("video site")),
                            k: 100,
                            filter: {
                                term: {
                                    spaceId: new OpensearchQueryValue(space.id),
                                },
                            },
                        },
                    },
                },
            })
            .then(({hits}) => hits),
    ).toEqual([
        {
            id: expect.any(String),
            score: expect.any(Number),
            fields: {"entity.id": [`Document:${document1.id}`]},
        },
        {
            id: expect.any(String),
            score: expect.any(Number),
            fields: {"entity.id": [`Document:${document2.id}`]},
        },
    ]);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 100,
                storedFields: ["entity.id"],
                query: {
                    knn: {
                        "vector.allMiniLmL6V2": {
                            vector: new OpensearchQueryValue(
                                // These words aren't in our source material but the model should figure out
                                // that "dungeon master" is associated with tabletop games and "scary" is
                                // associated with suspense or running away.
                                await embedQuery("scary tabletop game"),
                            ),
                            k: 100,
                            filter: {
                                term: {
                                    spaceId: new OpensearchQueryValue(space.id),
                                },
                            },
                        },
                    },
                },
            })
            .then(({hits}) => hits),
    ).toEqual([
        {
            id: expect.any(String),
            score: expect.any(Number),
            fields: {"entity.id": [`Document:${document2.id}`]},
        },
        {
            id: expect.any(String),
            score: expect.any(Number),
            fields: {"entity.id": [`Document:${document1.id}`]},
        },
    ]);
});

test("will reindex if a dependency changes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {name: "Test"});

    await runAllTimersAndWaitForTestTasks();

    const post1 = await channel.createPost(
        session,
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.",
    );

    const post2 = await channel.createPost(
        session,
        "Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.",
    );

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 100,
                storedFields: ["entity.id", "text"],
                query: {
                    term: {spaceId: new OpensearchQueryValue(space.id)},
                },
            })
            .then(({hits}) =>
                hits.sort((doc1, doc2) =>
                    defaultCompareStrings(
                        doc1.fields["entity.id"]?.[0] ?? "",
                        doc2.fields["entity.id"]?.[0] ?? "",
                    ),
                ),
            ),
    ).toEqual(
        [
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Post:${post1.id}`],
                    text: [
                        `This is a post in the “Test” channel:

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.`,
                    ],
                },
            },
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Post:${post2.id}`],
                    text: [
                        `This is a post in the “Test” channel:

Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.`,
                    ],
                },
            },
        ].sort((doc1, doc2) =>
            defaultCompareStrings(
                doc1.fields["entity.id"][0] ?? "",
                doc2.fields["entity.id"][0] ?? "",
            ),
        ),
    );

    await updateChannelName(session.action(), {
        channelId: channel.id,
        name: "Lorem Ipsum",
    });

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await context.opensearch
            .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                size: 100,
                storedFields: ["entity.id", "text"],
                query: {
                    term: {spaceId: new OpensearchQueryValue(space.id)},
                },
            })
            .then(({hits}) =>
                hits.sort((doc1, doc2) =>
                    defaultCompareStrings(
                        doc1.fields["entity.id"]?.[0] ?? "",
                        doc2.fields["entity.id"]?.[0] ?? "",
                    ),
                ),
            ),
    ).toEqual(
        [
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Post:${post1.id}`],
                    text: [
                        `This is a post in the “Lorem Ipsum” channel:

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.`,
                    ],
                },
            },
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Post:${post2.id}`],
                    text: [
                        `This is a post in the “Lorem Ipsum” channel:

Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.`,
                    ],
                },
            },
        ].sort((doc1, doc2) =>
            defaultCompareStrings(
                doc1.fields["entity.id"][0] ?? "",
                doc2.fields["entity.id"][0] ?? "",
            ),
        ),
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

    await runAllTimersAndWaitForTestTasks();

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

    await runAllTimersAndWaitForTestTasks();

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
                "Grossman commented on his non-conservative play style in a 2017 interview stating, ”Coach Spurrier instilled in me, don’t check down if the big play’s there. So that’s kind of how I was born. I always wanted to shoot a three-pointer in basketball, hit a home run in baseball. I don’t know why, that’s just, like, who I am.” During Week 12 of the 2006 season, Grossman threw a game-ending interception while attempting a deep pass to Rashied Davis.",
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

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
        )
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
        )
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
        )
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

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
        )
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
        )
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
        )
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    const getSearchEntityIds = async (context: TestSessionActionContext, space: TestSpace) => {
        const entityIds: Array<SearchDynamicEntityId> = [
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
        ];

        const entityResults = await runAllPromises(
            entityIds.map(entityId => getSearchEntityIfPossible(context, space.id, entityId)),
        );

        return filterMapArray(entityResults, entityResult =>
            entityResult && !entityResult.isPrivate
                ? entityResult.entity.getSearchEntityId()
                : undefined,
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

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
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document.id}`,
                title: "This is a test",
                titleVersion: expect.anything(),
                media: null,
            }),
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
        }),
    ]);
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
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
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document1.id}`,
                title: "Test 1",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document4.id}`,
                title: "Test 4",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document2.id}`,
                title: "Test 2",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document1.id}`,
                title: "Test 1",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document4.id}`,
                title: "Test 4",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document2.id}`,
                title: "Test 2",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
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
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "my documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document4.id}`,
                title: "Test 4",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: John. Trains! Trains!"}],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document3.id}`,
                title: "Test 3",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: Sara"}],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document1.id}`,
                title: "Test 1",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "Trains! Trains!"}],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "Check out this trains "},
                {isHighlighted: true, text: "document"},
                {isHighlighted: false, text: "."},
            ],
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "my documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document1.id}`,
                title: "Test 1",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document4.id}`,
                title: "Test 4",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
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
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "sara’s documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document2.id}`,
                title: "Test 2",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
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
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "sara’s documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document5.id}`,
                title: "Test 5",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "Sara"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document2.id}`,
                title: "Test 2",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: John. Trains!"}],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: await session2.get(),
            bodyTextSnippet: [],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document3.id}`,
                title: "Test 3",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "Sara"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "Check out this trains "},
                {isHighlighted: true, text: "document"},
                {isHighlighted: false, text: "."},
            ],
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "johns’s documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document4.id}`,
                title: "Test 4",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "John"},
                {isHighlighted: false, text: ". Trains! Trains!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document3.id}`,
                title: "Test 3",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: Sara"}],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document1.id}`,
                title: "Test 1",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "Trains! Trains!"}],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: await session1.get(),
            bodyTextSnippet: [],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document2.id}`,
                title: "Test 2",
                titleVersion: expect.anything(),
                media: null,
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "John"},
                {isHighlighted: false, text: ". Trains!"},
            ],
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Post:${post.id}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: await session1.get(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "Check out this trains "},
                {isHighlighted: true, text: "document"},
                {isHighlighted: false, text: "."},
            ],
        }),
    ]);
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

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "locally sourced",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                id: `Document:${document.id}`,
                title: "Document with bullet points that have strong titles",
                titleVersion: expect.anything(),
                media: null,
            }),
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
        }),
    ]);
});

test("search by affinity can include my tasks", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "Test Document 1"});
    const document2 = await TestDocument.create(session2, {title: "Test Document 2"});
    await document2.access.grantDefault(session2);

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: "TaskPersonal",
        interaction: {type: "HighIntentUpdate"},
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: "TaskPersonal",
                    title: "My tasks",
                    titleVersion: null,
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });
});

test("search by affinity can include the task personal view in favorites", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "Test Document 1"});
    const document2 = await TestDocument.create(session2, {title: "Test Document 2"});
    await document2.access.grantDefault(session2);

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: "TaskPersonal",
        interaction: {type: "HighIntentUpdate"},
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: "TaskPersonal",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3),
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: "TaskPersonal",
                    title: "My tasks",
                    titleVersion: null,
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });
});

test("search by affinity can include the task personal view in favorites even if it doesn’t have affinity points", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "Test Document 1"});
    const document2 = await TestDocument.create(session2, {title: "Test Document 2"});
    await document2.access.grantDefault(session2);

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: "TaskPersonal",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: "TaskPersonal",
                    title: "My tasks",
                    titleVersion: null,
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });
});

test("search by affinity will also return up to five favorites", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "Test Document 1"});
    const document2 = await TestDocument.create(session2, {title: "Test Document 2"});
    await document2.access.grantDefault(session2);
    const document3 = await TestDocument.create(session2, {title: "Test Document 3"});
    await document3.access.grantDefault(session2);
    const document4 = await TestDocument.create(session2, {title: "Test Document 4"});
    await document4.access.grantDefault(session2);
    const document5 = await TestDocument.create(session2, {title: "Test Document 5"});
    await document5.access.grantDefault(session2);
    const document6 = await TestDocument.create(session2, {title: "Test Document 6"});
    await document6.access.grantDefault(session2);
    const document7 = await TestDocument.create(session2, {title: "Test Document 7"});
    await document7.access.grantDefault(session2);
    const document8 = await TestDocument.create(session2, {title: "Test Document 8"});
    await document8.access.grantDefault(session2);
    const document9 = await TestDocument.create(session2, {title: "Test Document 9"});
    await document9.access.grantDefault(session2);
    const document10 = await TestDocument.create(session2, {title: "Test Document 10"});
    await document10.access.grantDefault(session2);
    const document11 = await TestDocument.create(session2, {title: "Test Document 11"});
    await document11.access.grantDefault(session2);
    const document12 = await TestDocument.create(session2, {title: "Test Document 12"});
    await document12.access.grantDefault(session2);
    const document13 = await TestDocument.create(session2, {title: "Test Document 13"});
    await document13.access.grantDefault(session2);
    const document14 = await TestDocument.create(session2, {title: "Test Document 14"});
    await document14.access.grantDefault(session2);

    await updateSpaceAccountSettings(session1.action(), space.id, {
        searchShortcutFavoriteEntityCount: 5,
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document4.id}`,
        interaction: {type: "HighIntentUpdate"},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document3.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document4.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a1"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document5.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a1"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a2"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await unfavoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document4.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a2"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document4.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a2"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await unfavoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document5.id}`,
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document5.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document6.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document7.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document8.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document9.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document5.access.revokeDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document8.id}`,
                    title: "Test Document 8",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document4.access.revokeDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document8.id}`,
                    title: "Test Document 8",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a8"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document9.id}`,
                    title: "Test Document 9",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document6.access.revokeDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document8.id}`,
                    title: "Test Document 8",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a8"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document9.id}`,
                    title: "Test Document 9",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document5.access.grantDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document8.id}`,
                    title: "Test Document 8",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a8"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document9.id}`,
                    title: "Test Document 9",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document4.access.grantDefault(session2);
    await document6.access.grantDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document10.id}`,
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document11.id}`,
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document12.id}`,
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document13.id}`,
    });

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document14.id}`,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document7.id}`,
                    title: "Test Document 7",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document14.access.revokeDefault(session2);
    await document13.access.revokeDefault(session2);
    await document12.access.revokeDefault(session2);
    await document11.access.revokeDefault(session2);
    await document10.access.revokeDefault(session2);
    await document9.access.revokeDefault(session2);
    await document8.access.revokeDefault(session2);
    await document7.access.revokeDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Admittedly, this is an edge case. Ideally `hasMoreFavoriteResults` would be
    // `false` because there are truly only 4 favorites the user has access to. But
    // because there are >11 favorited entities and we don't check whether the user
    // has access to all of them we can't be certain there aren't more favorites.
    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document5.id}`,
                    title: "Test Document 5",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document6.id}`,
                    title: "Test Document 6",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });

    await document6.access.revokeDefault(session2);
    await document5.access.revokeDefault(session2);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Admittedly, this is an edge case. Ideally `hasMoreFavoriteResults` would be
    // `false` because there are truly only 2 favorites the user has access to. But
    // because there are >11 favorited entities and we don't check whether the user
    // has access to all of them we can't be certain there aren't more favorites.
    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document3.id}`,
                    title: "Test Document 3",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document4.id}`,
                    title: "Test Document 4",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document1.id}`,
                    title: "Test Document 1",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document2.id}`,
                    title: "Test Document 2",
                    titleVersion: expect.anything(),
                    media: null,
                }),
            }),
        ],
    });
});

test(
    "prefix matches and typo matches on search entity titles are allowed",
    async () => {
        const names = [
            "Old Man’s War",
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
            const results = await searchByKeywords(testSearchSession.action(), {
                spaceId: testSearchSpace.id,
                queryText,
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            });

            return filterMapArray(results, result =>
                result.id.startsWith("Channel:") && result.model instanceof SearchEntityModel
                    ? result.model.initialData.title
                    : undefined,
            );
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
                "The Book of Samson",
                "The Grand Design",
                "The Book of Lies",
                "The Lost Symbol",
                "The Silmarillion",
                "The DaVinci Code",
                "The Code of the Wooster",
                "The Lock Artist",
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
                "Old Man’s War",
            ]);
            expect(await testSearch("test ma")).toEqual([
                "Test Mabc",
                "Old Man’s War",
                "Test Mxyz",
            ]);
            expect(await testSearch("test mab")).toEqual([
                "Test Mabc",
                "Test Mxyz",
                "Old Man’s War",
            ]);
            expect(await testSearch("test mabc")).toEqual(["Test Mabc", "Test Mxyz"]);
            expect(await testSearch("test mx")).toEqual(["Test Mxyz", "Test Mabc"]);
            expect(await testSearch("tes m")).toEqual([
                "Test Mxyz",
                "Test Mabc",
                "Monster 1959",
                "Old Man’s War",
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
    },
    // Increase test timeout since we've found that sometimes this test is slow to
    // run in CI.
    30 * 1000,
);

test("make sure cross space reads don’t work", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const session1 = await space1.createSession();
    const session2 = await space2.createSession();

    const channel = await TestChannel.create(session1, {name: "test"});

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const testSearch = async (session: TestSpaceSession) => {
        const results = await searchByKeywords(session.action(), {
            spaceId: session.space.id,
            queryText: "test",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return filterMapArray(results, result =>
            result.id.startsWith("Channel:") ? result.id : undefined,
        );
    };

    expect(await testSearch(session1)).toEqual([`Channel:${channel.id}`]);
    expect(await testSearch(session2)).toEqual([]);

    expect(
        await getSearchEntityIfPossible(session1.action(), space1.id, `Channel:${channel.id}`),
    ).not.toBeNull();
    expect(
        await getSearchEntityIfPossible(session2.action(), space2.id, `Channel:${channel.id}`),
    ).toBeNull();
    await expect(
        getSearchEntityIfPossible(session2.action(), space1.id, `Channel:${channel.id}`),
    ).rejects.toThrow(PermissionDeniedError);
});

test("reading search entities is batched and cached", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [channel1, channel2, channel3, channel4, channel5] = await runAllPromises([
        TestChannel.create(session, {name: "Test 1"}),
        TestChannel.create(session, {name: "Test 2"}),
        TestChannel.create(session, {name: "Test 3"}),
        TestChannel.create(session, {name: "Test 4"}),
        TestChannel.create(session, {name: "Test 5"}),
    ]);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const {getCount} = opensearchClientExecuteOperationTestCounter.recordAllForTest();
    opensearchClientExecuteOperationTestCounter.resetForTest();

    expect(getCount()).toEqual(0);

    const actionContext = session.action();

    await runAllPromises([
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel1.id}`),
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel2.id}`),
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel3.id}`),
    ]);

    expect(getCount()).toEqual(1);

    await getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel2.id}`);

    expect(getCount()).toEqual(1);

    await runAllPromises([
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel4.id}`),
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel5.id}`),
    ]);

    expect(getCount()).toEqual(2);

    await getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel2.id}`);

    expect(getCount()).toEqual(2);

    await runAllPromises([
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel2.id}`),
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel3.id}`),
        getSearchEntityIfPossible(actionContext, space.id, `Channel:${channel5.id}`),
    ]);

    expect(getCount()).toEqual(2);
});

test("searching mentions requires space access", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();

    // Create a document in the other space
    await TestDocument.create(session, {
        title: "Test Document",
        body: "This is a test document.",
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Try to search in the other space without access
    await expect(
        searchMentionByKeywords(session.action(), {
            spaceId: otherSpace.id,
            queryText: "Test",
            limit: 10,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("searching mentions excludes entities user doesn’t have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const privatePersonalDocument1 = await TestDocument.create(session1, {
        title: "Private Personal Document 1",
    });

    const privateSharedDocument1 = await TestDocument.create(session1, {
        title: "Private Shared Document 1",
    });

    const publicDocument1 = await TestDocument.create(session1, {
        title: "Public Document 1",
    });

    const privatePersonalDocument2 = await TestDocument.create(session2, {
        title: "Private Personal Document 2",
    });

    const privateSharedDocument2 = await TestDocument.create(session2, {
        title: "Private Shared Document 2",
    });

    const publicDocument2 = await TestDocument.create(session2, {
        title: "Public Document 2",
    });

    await privateSharedDocument1.access.grant(session1, session2);
    await publicDocument1.access.grantDefault(session1);

    await privateSharedDocument2.access.grant(session2, session1);
    await publicDocument2.access.grantDefault(session2);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchMentionByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "document",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${publicDocument1.id}`,
                    title: "Public Document 1",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${publicDocument2.id}`,
                    title: "Public Document 2",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${privatePersonalDocument1.id}`,
                    title: "Private Personal Document 1",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${privateSharedDocument1.id}`,
                    title: "Private Shared Document 1",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${privateSharedDocument2.id}`,
                    title: "Private Shared Document 2",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchMentionByKeywords(session2.action(), {
            spaceId: space.id,
            queryText: "document",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${publicDocument1.id}`,
                    title: "Public Document 1",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${publicDocument2.id}`,
                    title: "Public Document 2",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${privatePersonalDocument2.id}`,
                    title: "Private Personal Document 2",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${privateSharedDocument2.id}`,
                    title: "Private Shared Document 2",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${privateSharedDocument1.id}`,
                    title: "Private Shared Document 1",
                    titleVersion: {type: "Integer", version: 1},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );
});

test("searching mentions supports prefix matching", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document1 = await TestDocument.create(session, {
        title: "foobar document",
    });

    const document2 = await TestDocument.create(session, {
        title: "barfoo document",
    });

    const channel = await TestChannel.create(session, {
        name: "foobaz channel",
    });

    const task = await TestTask.create(session, {
        title: "fooqux task",
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "fo",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document1.id}`,
                    title: "foobar document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Channel:${channel.id}`,
                    title: "foobaz channel",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Task:${task.id}`,
                    title: "fooqux task",
                    titleVersion: {type: "TaskTitle", snapshot: expect.any(Uint8Array)},
                    media: {
                        type: "TaskDisplayStatus",
                        displayStatus: "OpenInactive",
                        version: expect.any(Array),
                    },
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "foo",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document1.id}`,
                    title: "foobar document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Channel:${channel.id}`,
                    title: "foobaz channel",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Task:${task.id}`,
                    title: "fooqux task",
                    titleVersion: {type: "TaskTitle", snapshot: expect.any(Uint8Array)},
                    media: {
                        type: "TaskDisplayStatus",
                        displayStatus: "OpenInactive",
                        version: expect.any(Array),
                    },
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "foob",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document1.id}`,
                    title: "foobar document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Channel:${channel.id}`,
                    title: "foobaz channel",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "bar",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document2.id}`,
                    title: "barfoo document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "docu",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document1.id}`,
                    title: "foobar document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document2.id}`,
                    title: "barfoo document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    // Should return "foobaz" as a typo match
    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "foobar",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document1.id}`,
                    title: "foobar document",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Channel:${channel.id}`,
                    title: "foobaz channel",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );
});

test("searching mentions excludes accounts and chats even if keywords match", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "foo"});
    const session2 = await space.createSession({name: "bar"});
    const session3 = await space.createSession({name: "qux"});

    const chat = await TestChat.get(session, session2, session3);
    await chat.sendMessage(session, "foo");

    const document = await TestDocument.create(session, {title: "foo bar qux"});

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "foo",
            limit: 10,
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document.id}`,
                    title: "foo bar qux",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );

    expect(
        await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "foo",
            limit: 10,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }).then(results => results.sort((a, b) => defaultCompareStrings(a.model.id, b.model.id))),
    ).toEqual(
        [
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: await session.get(),
                bodyTextSnippet: [],
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Chat:${chat.id}`,
                    title: "bar, foo, and qux",
                    titleVersion: null,
                    media: {
                        type: "AccountPile",
                        previewAccounts: expect.any(Array),
                        accountCount: 2,
                    },
                }),
                bodyTextSnippet: [],
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `ChatMessage:${chat.id}-0`,
                    title: null,
                    titleVersion: null,
                    media: {type: "Account", account: expect.any(AccountModel)},
                }),
                bodyTextSnippet: [{isHighlighted: true, text: "foo"}],
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    id: `Document:${document.id}`,
                    title: "foo bar qux",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
                bodyTextSnippet: [],
            }),
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );
});

test("searching mentions has effective name fuzzy searching", async () => {
    const bookNames = [
        "Old Man’s War",
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
    ];

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    let lastCollection: TestTaskCollection | null = null;

    for (let i = 0; i < bookNames.length; i++) {
        const bookName = bookNames[i]!;

        const j = i % 4;
        switch (j) {
            case 0: {
                const document = await TestDocument.create(session, {title: bookName});
                await document.access.grantDefault(session);
                break;
            }
            case 1: {
                const channel = await TestChannel.create(session, {name: bookName});
                await channel.access.grantDefault(session);
                break;
            }
            case 2: {
                const collection = await TestTaskCollection.create(session, {name: bookName});
                await collection.access.grantDefault(session);
                lastCollection = collection;
                break;
            }
            case 3: {
                const task = await TestTask.create(session, {title: bookName});
                await task.addCollection(session, assertExists(lastCollection));
                break;
            }
            default:
                throw new InternalError(`Unexpected: ${j}`);
        }

        import.meta.jest.advanceTimersByTime(1000);
        await runAllTimersAndWaitForTestTasks();
    }

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const testSearch = async (queryText: string) => {
        const results = await searchMentionByKeywords(session.action(), {
            spaceId: space.id,
            queryText,
            limit: 100,
        });

        return results.map(result => result.model.initialData.title);
    };

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
        "The Silmarillion",
        "The Code of the Wooster",
        "The Lock Artist",
        "The Book of Samson",
        "The Grand Design",
        "The Book of Lies",
        "The Lost Symbol",
        "The DaVinci Code",
        "Thank You Jeeves",
    ]);
    expect(await testSearch("t")).toEqual([
        "Test Mxyz",
        "The Preservationist",
        "The Silmarillion",
        "The Code of the Wooster",
        "The Lock Artist",
        "Test Mabc",
        "The Book of Samson",
        "The Grand Design",
        "The Book of Lies",
        "The Lost Symbol",
        "The DaVinci Code",
        "Thank You Jeeves",
    ]);
    expect(await testSearch("the")).toEqual([
        "The Preservationist",
        "The Silmarillion",
        "The Code of the Wooster",
        "The Lock Artist",
        "The Book of Samson",
        "The Grand Design",
        "The Book of Lies",
        "The Lost Symbol",
        "The DaVinci Code",
    ]);

    // Testing word position swaps
    expect(await testSearch("Backwards, Red Dwarf")).toEqual(["Backwards, Red Dwarf"]);
    expect(await testSearch("Backwards Red Dwarf")).toEqual(["Backwards, Red Dwarf"]);
    expect(await testSearch("Backwards Dwarf Red")).toEqual(["Backwards, Red Dwarf"]);
    expect(await testSearch("Red Backwards Dwarf")).toEqual(["Backwards, Red Dwarf"]);
    expect(await testSearch("Dwarf Red Backwards")).toEqual(["Backwards, Red Dwarf"]);
    expect(await testSearch("thank jeeves")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves thank")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves thank you")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves you thank")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);

    // Testing word in different positions
    expect(await testSearch("code")).toEqual([
        "The Code of the Wooster",
        "The DaVinci Code",
        "Core Product FY2024Q3",
        "Core Product FY2024Q2",
        "Core Product FY2023Q3",
    ]);

    // Testing last word prefix matching
    expect(await testSearch("test")).toEqual(["Test Mxyz", "Test Mabc"]);
    expect(await testSearch("test m")).toEqual([
        "Test Mxyz",
        "Test Mabc",
        "Monster 1959",
        "Old Man’s War",
    ]);
    expect(await testSearch("test ma")).toEqual(["Test Mabc", "Old Man’s War", "Test Mxyz"]);
    expect(await testSearch("test mab")).toEqual(["Test Mabc", "Test Mxyz", "Old Man’s War"]);
    expect(await testSearch("test mabc")).toEqual(["Test Mabc", "Test Mxyz"]);
    expect(await testSearch("test mx")).toEqual(["Test Mxyz", "Test Mabc"]);
    expect(await testSearch("tes m")).toEqual([
        "Test Mxyz",
        "Test Mabc",
        "Monster 1959",
        "Old Man’s War",
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
        "Core Product FY2024Q3",
        "Core Product FY2024Q2",
        "Core Product FY2023Q3",
    ]);
    expect(await testSearch("Q3")).toEqual([
        "Core Product FY2024Q3",
        "Core Product FY2023Q3",
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
});
