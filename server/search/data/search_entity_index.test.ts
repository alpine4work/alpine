import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    deleteChatMessage,
    getOrCreateChatForAccounts,
    sendChatMessage,
} from "~/server/chat/data/chat_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createChannel, createPost, updateChannelName} from "~/server/forum/data/forum_table.js";
import {JobConsumer} from "~/server/jobs/core/job_consumer.js";
import {
    AllMiniLmL6V2Model,
    allMiniLmL6V2ModelEmbedTextTestCounter,
} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_model.js";
import {LanguageModelBase} from "~/server/language_models/core/language_model_base.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {SearchEntityId} from "~/server/search/core/search_entity_id.js";
import {getDocumentSearchEntityTestCheckpoint} from "~/server/search/data/internal/get_search_entity.js";
import {SearchEntityIndexDefaultGrantTypeIntegerMapping} from "~/server/search/data/internal/search_entity_index_doc.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    processSearchEntityJobFinishedTestCheckpoint,
} from "~/server/search/data/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {wikipediaYoutubeDocumentContent} from "~/shared/documents/fixtures/wikipedia_youtube_document_content.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const schema = DocumentContentProsemirrorSchema;
const {SearchEntityKeywordIndex, SearchEntitySemanticIndex} = getSearchEntityIndexesForTest();

const context = createTestContext({shouldStartOpensearch: true});

function startTestJobConsumer({languageModel}: {languageModel: LanguageModelBase}) {
    const consumer = JobConsumer.start(context, {
        queueUrl: context.getSqsLocalJobQueueUrl(),
        processJob: async (actionContext, job, jobSendTime) => {
            switch (job.type) {
                case "IndexSearchEntity": {
                    await processIndexSearchEntityJob(
                        actionContext.clone({
                            tasks: new TestTaskContextModule({
                                shouldSkipIndexing: !context.isOpensearchEnabled,
                                dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
                            }),
                            languageModel: new LanguageModelContextModule(languageModel),
                        }),
                        job,
                        jobSendTime,
                    );
                    break;
                }
                default: {
                    // Ignore other jobs...
                    break;
                }
            }
        },
    });

    afterTestEnds(async () => {
        consumer.stop();
        await ProcessContextModule.waitForTestTasks();
    });
}

test("can index and reindex a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityKeywordIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
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
            SearchEntityKeywordIndex,
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

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityKeywordIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
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
            SearchEntityKeywordIndex,
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

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityKeywordIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
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
            SearchEntityKeywordIndex,
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

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityKeywordIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
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
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual(null);

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
        new Date(Date.now() - 2 * 60 * 1000),
    );

    const {primaryTerm, sequenceNumber: sequenceNumberBase} = assertExists(
        (
            await context.opensearch.client.getDocWithoutSourceIfExists(
                context.tracer.getTracer(),
                SearchEntityKeywordIndex,
                space.id,
                `Document:${document.id}`,
            )
        )?.version,
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
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

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityKeywordIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
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

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntityKeywordIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
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

test("goes from no embeddings to some embeddings to no embeddings again", async () => {
    const languageModel = await AllMiniLmL6V2Model.new();

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Hello, world!",
        body: "This is a document. Very cool.",
    });

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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        version: expect.any(Object),
        fields: {},
    });
});

test("goes from no embeddings to some embeddings to no embeddings again with race conditions", async () => {
    const languageModel = await AllMiniLmL6V2Model.new();

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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
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
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
        version: expect.any(Object),
        fields: {},
    });
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

    expect(getCount()).toEqual(3);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
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
        SearchEntitySemanticIndex,
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

    expect(getCount()).toEqual(4);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            `Document:${document.id}`,
            {storedFields: ["embeddingChunksVectorCache.allMiniLmL6V2"]},
        ),
    ).toEqual({
        id: `Document:${document.id}`,
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

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntitySemanticIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
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
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: document2.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntitySemanticIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
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
            SearchEntitySemanticIndex,
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

test("will reindex if a dependency changes", async () => {
    const languageModel = await AllMiniLmL6V2Model.new();

    startTestJobConsumer({languageModel});

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await createChannel(session.action(), {
        spaceId: space.id,
        name: "Test",
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Channel",
                channelId: channel.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    const post1 = await createPost(session.action(), {
        channelId: channel.id,
        content: createSimplePostContent(
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Cras et lorem a lorem laoreet condimentum. Duis feugiat nec risus hendrerit convallis. Aenean luctus ipsum sagittis elit accumsan suscipit.",
        ),
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Post",
                postId: post1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    const post2 = await createPost(session.action(), {
        channelId: channel.id,
        content: createSimplePostContent(
            "Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.",
        ),
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Post",
                postId: post2.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntitySemanticIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            {
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
            },
        ),
    ).toEqual([
        {
            id: `Post:${post1.id}`,
            score: expect.any(Number),
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
    ]);

    const pause1Promise = processSearchEntityJobFinishedTestCheckpoint.pauseForTest(
        `Post:${post1.id}`,
    );
    const pause2Promise = processSearchEntityJobFinishedTestCheckpoint.pauseForTest(
        `Post:${post2.id}`,
    );

    await updateChannelName(session.action(), {
        channelId: channel.id,
        name: "Lorem Ipsum",
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        }),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Channel",
                channelId: channel.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    (await pause1Promise).unpause();
    (await pause2Promise).unpause();

    await context.opensearch.client.refresh(context.tracer.getTracer(), SearchEntitySemanticIndex);

    expect(
        await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntitySemanticIndex,
            space.id,
            {
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
            },
        ),
    ).toEqual([
        {
            id: `Post:${post1.id}`,
            score: expect.any(Number),
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
    ]);
});

test("deleting a chat message will clear out its indexed content", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId,
        parentMessageIndex: null,
        content: createSimpleMessageContent(
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id.",
        ),
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex: 0,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chatId}-0`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chatId}-0`,
        version: expect.any(Object),
        fields: {
            body: [
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque pellentesque erat quam, id varius lacus dapibus id.",
            ],
        },
    });

    await deleteChatMessage(session1.action(), {
        chatId,
        messageIndex: 0,
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex: 0,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chatId}-0`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chatId}-0`,
        version: expect.any(Object),
        fields: {},
    });
});

test.only("tasks update their access policies appropriately after indexing", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const [
        task,
        parentTask1,
        parentTask2a,
        parentTask2b,
        parentTask2c,
        privateCollection,
        publicCollection,
        sharedCollection,
    ] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1, {title: "foobar"}),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPrivate(session1),
        TestTaskCollection.createPublic(session1, {name: "buzqux"}),
        TestTaskCollection.createPrivate(session1, {otherGrantedAccounts: [session3.account]}),
    ]);

    await runAllPromises([
        parentTask2a.addCollection(session1, privateCollection),
        parentTask2b.addCollection(session1, publicCollection),
        parentTask2c.addCollection(session1, sharedCollection),
        task.updateParentTask(session1, parentTask1),
        parentTask1.updateParentTask(session1, parentTask2a),
    ]);

    const taskSearchEntityIdOrder: Array<SearchEntityId> = [
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ];

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.client.refresh(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
        );

        const docs = await context.opensearch.client.searchWithoutSource(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            {
                size: 100,
                query: {
                    bool: {
                        filter: {
                            bool: {
                                must: [{term: {spaceId: new OpensearchQueryValue(space.id)}}],
                                minimum_should_match: 1,
                                should: [
                                    {
                                        term: {
                                            "accessPolicy.accountGrantAccountIds":
                                                new OpensearchQueryValue(session.account.id),
                                        },
                                    },
                                    {
                                        term: {
                                            "accessPolicy.defaultGrantType":
                                                new OpensearchQueryValue(
                                                    SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                        "Space",
                                                    ),
                                                ),
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        );

        return docs
            .map(doc => doc.id)
            .sort(
                (id1, id2) =>
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id1)) -
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id2)),
            );
    };

    await runAllPromises([
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "Task",
                    taskId: task.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "Task",
                    taskId: parentTask1.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "Task",
                    taskId: parentTask2a.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "Task",
                    taskId: parentTask2b.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "Task",
                    taskId: parentTask2c.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "TaskCollection",
                    collectionId: publicCollection.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "TaskCollection",
                    collectionId: privateCollection.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
        processIndexSearchEntityJob(
            TestTask.systemAction(space),
            {
                type: "IndexSearchEntity",
                spaceId: space.id,
                update: {
                    type: "TaskCollection",
                    collectionId: sharedCollection.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
        ),
    ]);

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await parentTask1.updateParentTask(session1, parentTask2b);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Task",
                taskId: parentTask1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await parentTask1.updateParentTask(session1, parentTask2c);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Task",
                taskId: parentTask1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await sharedCollection.setPublicAccessPolicy(session1);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "TaskCollection",
                collectionId: sharedCollection.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await parentTask2c.removeCollection(session1, sharedCollection);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Task",
                taskId: parentTask2c.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await sharedCollection.setPrivateAccessPolicy(session1, {
        otherGrantedAccounts: [session3.account],
    });

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "TaskCollection",
                collectionId: sharedCollection.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await parentTask1.addCollection(session1, publicCollection);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Task",
                taskId: parentTask1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Task:${parentTask1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Task:${parentTask1.id}`,
        version: expect.any(Object),
        fields: {
            title: ["foobar"],
        },
    });

    await parentTask1.delete(session1);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Task",
                taskId: parentTask1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Task:${parentTask1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Task:${parentTask1.id}`,
        version: expect.any(Object),
        fields: {},
    });

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    await parentTask1.undelete(session1);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Task",
                taskId: parentTask1.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `Task:${parentTask1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Task:${parentTask1.id}`,
        version: expect.any(Object),
        fields: {
            title: ["foobar"],
        },
    });

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2b.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `TaskCollection:${publicCollection.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `TaskCollection:${publicCollection.id}`,
        version: expect.any(Object),
        fields: {
            title: ["buzqux"],
        },
    });

    await publicCollection.delete(session1);

    await processIndexSearchEntityJob(
        TestTask.systemAction(space),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "TaskCollection",
                collectionId: publicCollection.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {shouldImmediatelyProcessDependentsForTest: true},
    );

    expect(
        await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityKeywordIndex,
            space.id,
            `TaskCollection:${publicCollection.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `TaskCollection:${publicCollection.id}`,
        version: expect.any(Object),
        fields: {},
    });

    expect(await getSearchEntityIds(session1)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
        `Task:${parentTask2a.id}`,
        `Task:${parentTask2b.id}`,
        `Task:${parentTask2c.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${sharedCollection.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([]);

    expect(await getSearchEntityIds(session3)).toEqual([`TaskCollection:${sharedCollection.id}`]);
});
