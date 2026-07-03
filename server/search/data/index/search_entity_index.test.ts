import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createChatForTest} from "~/server/chat/data/create_chat_for_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {captureAfterTestEndsCallbacks} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {updateChannelName} from "~/server/forum/data/update_channel_name.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    AllMiniLmL6V2LanguageModel,
    allMiniLmL6V2LanguageModelEmbedTextTestCounter,
} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {LanguageModelsNoopDevelopmentContextModule} from "~/server/language_models/language_models_noop_development_context_module.js";
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
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {
    favoriteSearchEntity,
    markSearchAffinityEntityInteraction,
    unfavoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {addSpaceAccount} from "~/server/spaces/add_space_account.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {generateEmailAddressForTest} from "~/server/spaces/test_helpers/generate_email_address_for_test.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSessionActionContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {updateSpaceAccountSettings} from "~/server/spaces/update_space_account_settings.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
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
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {ContentEditorClientId, DocumentId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchAffinityEntityModel, SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
    SearchFavoriteEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";
import {runAllTimersAndWaitForTestTasks} from "~/shared/test_helpers/run_all_timers_and_wait_for_test_tasks.js";

const schema = DocumentContentProsemirrorSchema;
const {SearchEntityKeywordIndex, SearchEntityEmbeddingChunkIndex} = getSearchEntityIndexesForTest();

let languageModel: AllMiniLmL6V2LanguageModel;
beforeAll(async () => {
    languageModel = await AllMiniLmL6V2LanguageModel.new();
});

function createLanguageModelsContextModuleForTest(): LanguageModelsNoopDevelopmentContextModule {
    return new LanguageModelsNoopDevelopmentContextModule({embeddingModel: languageModel});
}

const context = createTestContext({
    shouldStartOpensearch: true,
    documentsInjection,
    searchInjection,
    spacesInjection,
    tasksInjection,
    chatInjection,
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
                        languageModels: createLanguageModelsContextModuleForTest(),
                    }),
                    job,
                    span,
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

beforeAll(() => {
    import.meta.jest.useFakeTimers();
});

// Important that this goes after `createTestContext()` which will register
// `afterEach` hooks that clean up some timers (specifically `TestLocalJobSender`
// which cleans up any delayed jobs).
afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
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
        space.systemAction(),
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
        space.systemAction(),
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
        space.systemAction(),
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
        space.systemAction(),
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
        space.systemAction(),
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
        space.systemAction(),
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
        space.systemAction(),
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
        " Add enough content that we\u2019ll need to embed. Should have more than thirty five tokens. I think I need another sentence.",
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
                space.systemAction(),
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
        " Add enough content that we\u2019ll need to embed. Should have more than thirty five tokens. I think I need another sentence.",
    );

    // Race 5 job processors...
    await runAllPromises(
        createArrayWithLength(5, () =>
            processIndexSearchEntityJob(
                space.systemAction(),
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
        space.systemAction(),
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
                    `This is from the \u201CYouTube\u201D document:

## History

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim. The trio were early employees of PayPal, which left them enriched after the company was bought by eBay. Hurley had studied design at the Indiana University of Pennsylvania, and Chen and Karim studied computer science together at the University of Illinois Urbana-Champaign.

According to a story that has often been repeated in the media, Hurley and Chen developed the idea for YouTube during the early months of 2005, after they had experienced difficulty sharing videos that had been shot at a dinner party at Chen\u2019s apartment in San Francisco. Karim did not attend the party and denied that it had occurred, but Chen remarked that the idea that YouTube was founded after a dinner party \u201Cwas probably very strengthened by marketing ideas around creating a story that was very digestible\u201D.

YouTube began as a venture capital–funded technology startup. Between November 2005 and April 2006, the company raised money from various investors, with Sequoia Capital and Artis Capital Management being the largest two. YouTube\u2019s early headquarters were situated above a pizzeria and a Japanese restaurant in San Mateo, California. In February 2005, the company activated www.youtube.com. The first video was uploaded on April 23, 2005. Titled \u201CMe at the zoo\u201D, it shows co-founder Jawed Karim at the San Diego Zoo and can still be viewed on the site. In May, the company launched a public beta and by November, a Nike ad featuring Ronaldinho became the first video to reach one million total views. The site launched officially on December 15, 2005, by which time the site was receiving 8 million views a day. Clips at the time were limited to 100 megabytes, as little as 30 seconds of footage.`,
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
                                // These words aren't in our source material but the model should figure out that
                                // "dungeon master" is associated with tabletop games and "scary" is associated
                                // with suspense or running away.
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
                        `This is a post in the \u201CTest\u201D channel:

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
                        `This is a post in the \u201CTest\u201D channel:

Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.`,
                    ],
                },
            },
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Channel:${channel.id}`],
                    text: [
                        `# Test

This is a channel.`,
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
                        `This is a post in the \u201CLorem Ipsum\u201D channel:

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
                        `This is a post in the \u201CLorem Ipsum\u201D channel:

Donec euismod augue dolor, eget feugiat arcu ultrices et. Vestibulum consequat sollicitudin lectus. Donec ultricies, odio in tempus commodo, lacus elit lacinia turpis, vel pretium risus sapien at libero. Morbi tristique finibus sem, quis ullamcorper eros feugiat mattis.`,
                    ],
                },
            },
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Channel:${channel.id}`],
                    text: [
                        `# Lorem Ipsum

This is a channel.`,
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
                "Grossman commented on his non-conservative play style in a 2017 interview stating, \u201DCoach Spurrier instilled in me, don\u2019t check down if the big play\u2019s there. So that\u2019s kind of how I was born. I always wanted to shoot a three-pointer in basketball, hit a home run in baseball. I don\u2019t know why, that\u2019s just, like, who I am.\u201D During Week 12 of the 2006 season, Grossman threw a game-ending interception while attempting a deep pass to Rashied Davis.",
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
            clientVersion: 0,
            clientSteps: [
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
            clientId: generateId<ContentEditorClientId>(),
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
                .clone({languageModels: createLanguageModelsContextModuleForTest()}),
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
                    .clone({languageModels: createLanguageModelsContextModuleForTest()}),
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
                    .clone({languageModels: createLanguageModelsContextModuleForTest()}),
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
            `TaskCollection:${collection1.id}`,
            `TaskCollection:${collection3.id}`,
        ].sort(defaultCompareStrings),
    );

    expect(
        (
            await searchBySemantics(
                session2
                    .action()
                    .clone({languageModels: createLanguageModelsContextModuleForTest()}),
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
            `TaskCollection:${collection1.id}`,
            `TaskCollection:${collection2.id}`,
            `TaskCollection:${collection3.id}`,
        ].sort(defaultCompareStrings),
    );
});

test("semantic search stops returning post and comment entities after channel is made private", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const semanticPhrase = "orchard astronaut lighthouse";
    const semanticFiller = createArrayWithLength(100, () => "semantic").join(" ");

    const channel = await TestChannel.create(session1, {
        name: "Channel visibility test",
        access: "Public",
    });

    const post1 = await channel.createPost(
        session1,
        `${semanticPhrase} post one ${semanticFiller}`,
    );
    const post2 = await channel.createPost(
        session1,
        `${semanticPhrase} post two ${semanticFiller}`,
    );

    await runAllPromises([
        post1.createComment(session1, `${semanticPhrase} comment one ${semanticFiller}`),
        post2.createComment(session1, `${semanticPhrase} comment two ${semanticFiller}`),
    ]);

    const entityIds = [
        `Post:${post1.id}`,
        `Post:${post2.id}`,
        `PostComment:${post1.id}-0`,
        `PostComment:${post2.id}-0`,
    ];
    const entityIdSet = new Set(entityIds);

    const searchEntityIdsBySemantics = async (session: TestSpaceSession) =>
        (
            await searchBySemantics(
                session
                    .action()
                    .clone({languageModels: createLanguageModelsContextModuleForTest()}),
                {
                    spaceId: space.id,
                    queryText: semanticPhrase,
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                },
            )
        )
            .map(result => result.id)
            .filter(resultId => entityIdSet.has(resultId))
            .sort(defaultCompareStrings);

    await runAllTimersAndWaitForTestTasks();
    await runAllPromises([
        context.opensearch.refresh(SearchEntityKeywordIndex),
        context.opensearch.refresh(SearchEntityEmbeddingChunkIndex),
    ]);

    const embeddingChunkCounts = await runAllPromises(
        entityIds.map(entityId =>
            context.opensearch
                .searchWithoutSource(SearchEntityEmbeddingChunkIndex, space.id, {
                    size: 1,
                    query: {
                        bool: {
                            filter: [
                                {
                                    term: {
                                        "entity.id": new OpensearchQueryValue(entityId),
                                    },
                                },
                            ],
                        },
                    },
                })
                .then(({hits}) => hits.length),
        ),
    );

    expect(embeddingChunkCounts.length).toBe(4);
    for (const embeddingChunkCount of embeddingChunkCounts) {
        expect(embeddingChunkCount).toBeGreaterThan(0);
    }

    expect(await searchEntityIdsBySemantics(session2)).toEqual(
        entityIds.sort(defaultCompareStrings),
    );

    await channel.access.revokeDefault(session1);

    await runAllTimersAndWaitForTestTasks();
    await runAllPromises([
        context.opensearch.refresh(SearchEntityKeywordIndex),
        context.opensearch.refresh(SearchEntityEmbeddingChunkIndex),
    ]);

    expect(await searchEntityIdsBySemantics(session2)).toEqual([]);
});

test("semantic search updates document title for matches across embedding chunks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const semanticPhrase1 = "orchard astronaut lighthouse";
    const semanticPhrase2 = "volcano violin nebula";
    const semanticFiller = createArrayWithLength(450, () => "semantic").join(" ");
    const initialDocumentTitle = "Hollywoo Stars and Celebrities";
    const updatedDocumentTitle = "Hollywood (semantic update) Stars and Celebrities";

    const document = await TestDocument.create(session, {
        title: initialDocumentTitle,
        body: `${semanticPhrase1} ${semanticFiller}\n\n${semanticPhrase2} ${semanticFiller}`,
    });
    const documentEntityId = `Document:${document.id}`;

    const searchDocumentBySemantics = async (queryText: string) => {
        const results = await searchBySemantics(
            session.action().clone({languageModels: createLanguageModelsContextModuleForTest()}),
            {
                spaceId: space.id,
                queryText,
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            },
        );

        const result = assertExists(
            results.find(searchResult => searchResult.id === documentEntityId),
        );
        assert(result.model instanceof SearchEntityModel);
        return result;
    };

    await runAllTimersAndWaitForTestTasks();
    await runAllPromises([
        context.opensearch.refresh(SearchEntityKeywordIndex),
        context.opensearch.refresh(SearchEntityEmbeddingChunkIndex),
    ]);

    {
        const semanticResult1Before = await searchDocumentBySemantics(semanticPhrase1);
        const semanticResult2Before = await searchDocumentBySemantics(semanticPhrase2);

        expect(semanticResult1Before.model.initialData).toMatchObject({
            title: initialDocumentTitle,
        });
        expect(semanticResult2Before.model.initialData).toMatchObject({
            title: initialDocumentTitle,
        });
        expect(
            semanticResult1Before.bodyTextSnippet
                .map(bodyTextSnippetSegment => bodyTextSnippetSegment.text)
                .join("")
                .toLowerCase(),
        ).toContain("orchard");
        expect(
            semanticResult2Before.bodyTextSnippet
                .map(bodyTextSnippetSegment => bodyTextSnippetSegment.text)
                .join("")
                .toLowerCase(),
        ).toContain("volcano");
    }

    await document.update(session, [
        new ReplaceStep(9, 9, new Slice(Fragment.from(schema.text("d (semantic update)")), 0, 0)),
    ]);

    await runAllTimersAndWaitForTestTasks();
    await runAllPromises([
        context.opensearch.refresh(SearchEntityKeywordIndex),
        context.opensearch.refresh(SearchEntityEmbeddingChunkIndex),
    ]);

    {
        const semanticResult1After = await searchDocumentBySemantics(semanticPhrase1);
        const semanticResult2After = await searchDocumentBySemantics(semanticPhrase2);

        expect(semanticResult1After.model.initialData).toMatchObject({title: updatedDocumentTitle});
        expect(semanticResult2After.model.initialData).toMatchObject({title: updatedDocumentTitle});
        expect(
            semanticResult1After.bodyTextSnippet
                .map(bodyTextSnippetSegment => bodyTextSnippetSegment.text)
                .join("")
                .toLowerCase(),
        ).toContain("orchard");
        expect(
            semanticResult2After.bodyTextSnippet
                .map(bodyTextSnippetSegment => bodyTextSnippetSegment.text)
                .join("")
                .toLowerCase(),
        ).toContain("volcano");
    }
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

    // Doesn't throw, but returns nothing.
    expect(await getSearchEntityIds(otherSession.action(), space)).toEqual([]);

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

test("search by task modifiers", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const activeOpenUrgentTask = await TestTask.create(session, {
        title: "test1",
        assignee: session,
        priority: "Urgent",
    });
    await activeOpenUrgentTask.updateStatus(session, "Open");
    await activeOpenUrgentTask.updateAssigneeStatus(session, "Active");

    const inactiveOpenUrgentTask = await TestTask.create(session, {
        title: "test2",
        assignee: session,
        priority: "Urgent",
    });
    await inactiveOpenUrgentTask.updateStatus(session, "Open");
    await inactiveOpenUrgentTask.updateAssigneeStatus(session, "Inactive");

    const activeOpenTask = await TestTask.create(session, {title: "test3", assignee: session});
    await activeOpenTask.updateStatus(session, "Open");
    await activeOpenTask.updateAssigneeStatus(session, "Active");

    const closedUrgentTask = await TestTask.create(session, {
        title: "test4",
        assignee: session,
        priority: "Urgent",
    });
    await closedUrgentTask.updateStatus(session, "Closed");

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    const expectSearchToReturnTasks = async (queryText: string, tasks: Array<TestTask>) => {
        expect(
            (
                await searchByKeywords(session.action(), {
                    spaceId: space.id,
                    queryText,
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                })
            )
                .filter(result => result.id.startsWith("Task:"))
                .map(result => result.id)
                .sort(defaultCompareStrings),
        ).toEqual(tasks.map(t => `Task:${t.id}`).sort(defaultCompareStrings));
    };

    // First check our search works

    await expectSearchToReturnTasks("test", [
        activeOpenUrgentTask,
        inactiveOpenUrgentTask,
        activeOpenTask,
        closedUrgentTask,
    ]);

    await expectSearchToReturnTasks("urgent tasks", [
        activeOpenUrgentTask,
        inactiveOpenUrgentTask,
        closedUrgentTask,
    ]);

    await expectSearchToReturnTasks("open tasks", [
        activeOpenUrgentTask,
        inactiveOpenUrgentTask,
        activeOpenTask,
    ]);

    await expectSearchToReturnTasks("closed tasks", [closedUrgentTask]);

    await expectSearchToReturnTasks("active tasks", [activeOpenUrgentTask, activeOpenTask]);

    await expectSearchToReturnTasks("open and urgent tasks", [
        activeOpenUrgentTask,
        inactiveOpenUrgentTask,
    ]);

    await expectSearchToReturnTasks("open urgent and active tasks", [activeOpenUrgentTask]);
});

test("search by semantics will highlight matching words", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "This is a test",
        body: `The body also contains the word \u201Ctest.\u201D Nice. ${createArrayWithLength(
            100,
            () => "test",
        ).join(" ")}`,
    });

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);
    await context.opensearch.refresh(SearchEntityEmbeddingChunkIndex);

    expect(
        await searchBySemantics(
            session.action().clone({languageModels: createLanguageModelsContextModuleForTest()}),
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
                type: "Document",
                title: "This is a test",
                document: {
                    id: document.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {text: "The body also contains the word \u201C", isHighlighted: false},
                {text: "test", isHighlighted: true},
                {text: ".\u201D Nice. ", isHighlighted: false},
                ...createArrayWithLength(100, i =>
                    i === 0
                        ? [{text: "test", isHighlighted: true}]
                        : [
                              {text: " ", isHighlighted: false},
                              {text: "test", isHighlighted: true},
                          ],
                ).flat(),
            ],
            parsedFilter: null,
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
    const author1 = await session1.get();

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
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "in Transit Enjoyers: "},
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
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 1",
                document: {
                    id: document1.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 4",
                document: {
                    id: document4.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 2",
                document: {
                    id: document2.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: null,
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
                type: "Document",
                title: "Test 1",
                document: {
                    id: document1.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: {summary: "documents"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 4",
                document: {
                    id: document4.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: {summary: "documents"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 2",
                document: {
                    id: document2.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: {summary: "documents"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "in Transit Enjoyers: "},
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
            parsedFilter: null,
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
                type: "Document",
                title: "Test 4",
                document: {
                    id: document4.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: John. Trains! Trains!"}],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 3",
                document: {
                    id: document3.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: Sara"}],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 1",
                document: {
                    id: document1.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "Trains! Trains!"}],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "Check out this trains "},
                {isHighlighted: true, text: "document"},
                {isHighlighted: false, text: "."},
            ],
            parsedFilter: null,
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
                type: "Document",
                title: "Test 1",
                document: {
                    id: document1.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 4",
                document: {
                    id: document4.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "! "},
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "in Transit Enjoyers: "},
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
            parsedFilter: null,
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "sara\u2019s documents about trains",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 2",
                document: {
                    id: document2.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: true, text: "Trains"},
                {isHighlighted: false, text: "!"},
            ],
            parsedFilter: {summary: "documents by Sara Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "in Transit Enjoyers: "},
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
            parsedFilter: null,
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "sara\u2019s documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 5",
                document: {
                    id: document5.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "Sara"},
            ],
            parsedFilter: {summary: "documents by Sara Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 2",
                document: {
                    id: document2.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: John. Trains!"}],
            parsedFilter: {summary: "documents by Sara Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: await session2.get(),
            bodyTextSnippet: [],
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 3",
                document: {
                    id: document3.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "Sara"},
            ],
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "Check out this trains "},
                {isHighlighted: true, text: "document"},
                {isHighlighted: false, text: "."},
            ],
            parsedFilter: null,
        }),
    ]);

    expect(
        await searchByKeywords(session1.action(), {
            spaceId: space.id,
            queryText: "johns\u2019s documents",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).toEqual([
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 4",
                document: {
                    id: document4.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "John"},
                {isHighlighted: false, text: ". Trains! Trains!"},
            ],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 3",
                document: {
                    id: document3.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "By: Sara"}],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 1",
                document: {
                    id: document1.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [{isHighlighted: false, text: "Trains! Trains!"}],
            parsedFilter: {summary: "documents by John Smith"},
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: await session1.get(),
            bodyTextSnippet: [],
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Document",
                title: "Test 2",
                document: {
                    id: document2.id,
                    version: expect.anything(),
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "By: "},
                {isHighlighted: true, text: "John"},
                {isHighlighted: false, text: ". Trains!"},
            ],
            parsedFilter: null,
        }),
        new SearchEntityResultModel({
            score: expect.any(Number),
            model: new SearchEntityModel({
                type: "Post",
                title: "in Transit Enjoyers: Trains!",
                post: {
                    id: post.id,
                    version: 0,
                    channelVersion: 0,
                    author: author1,
                },
            }),
            bodyTextSnippet: [
                {isHighlighted: false, text: "Check out this trains "},
                {isHighlighted: true, text: "document"},
                {isHighlighted: false, text: "."},
            ],
            parsedFilter: null,
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
                type: "Document",
                title: "Document with bullet points that have strong titles",
                document: {
                    id: document.id,
                    version: expect.anything(),
                },
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
            parsedFilter: null,
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
        siteId: null,
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
        siteId: null,
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
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Static",
                    id: "TaskPersonal",
                    title: "My tasks",
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
        siteId: null,
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
        siteId: null,
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
                    type: "Static",
                    id: "TaskPersonal",
                    title: "My tasks",
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
    });
});

test("search by affinity can include the task personal view in favorites even if it doesn\u2019t have affinity points", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "Test Document 1"});
    const document2 = await TestDocument.create(session2, {title: "Test Document 2"});
    await document2.access.grantDefault(session2);

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        interaction: {type: "View"},
        siteId: null,
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
                    type: "Static",
                    id: "TaskPersonal",
                    title: "My tasks",
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
        siteId: null,
    });

    await markSearchAffinityEntityInteraction(session1.action(), {
        spaceId: space.id,
        entityId: `Document:${document4.id}`,
        interaction: {type: "HighIntentUpdate"},
        siteId: null,
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
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a1"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a1"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a2"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a2"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a2"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 8",
                    document: {
                        id: document8.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 8",
                    document: {
                        id: document8.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a8"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 9",
                    document: {
                        id: document9.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 8",
                    document: {
                        id: document8.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a8"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 9",
                    document: {
                        id: document9.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a7"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 8",
                    document: {
                        id: document8.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a8"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 9",
                    document: {
                        id: document9.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a6"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 7",
                    document: {
                        id: document7.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
    // because there are >11 favorited entities and we don't check whether the user has
    // access to all of them we can't be certain there aren't more favorites.
    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a4"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 5",
                    document: {
                        id: document5.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a5"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 6",
                    document: {
                        id: document6.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
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
    // because there are >11 favorited entities and we don't check whether the user has
    // access to all of them we can't be certain there aren't more favorites.
    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: true,
        favoriteResults: [
            new SearchFavoriteEntityResultModel({
                score: 0,
                favoriteOrderKey: assertOrderKey("a0"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 3",
                    document: {
                        id: document3.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchFavoriteEntityResultModel({
                score: expect.closeTo(3, 0),
                favoriteOrderKey: assertOrderKey("a3"),
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 4",
                    document: {
                        id: document4.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60, -1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 1",
                    document: {
                        id: document1.id,
                        version: expect.anything(),
                    },
                }),
            }),
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1, 0),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    type: "Document",
                    title: "Test Document 2",
                    document: {
                        id: document2.id,
                        version: expect.anything(),
                    },
                }),
            }),
        ],
    });
});

test(
    "prefix matches and typo matches on search entity titles are allowed",
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
                "Old Man\u2019s War",
                "Test Mxyz",
            ]);
            expect(await testSearch("test mab")).toEqual([
                "Test Mabc",
                "Old Man\u2019s War",
                "Test Mxyz",
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

test("make sure cross space reads don\u2019t work", async () => {
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
    expect(
        await getSearchEntityIfPossible(session2.action(), space1.id, `Channel:${channel.id}`),
    ).toEqual({isPrivate: true});
});

test("cannot read entities with no urlGrant as anonymous actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);

    expect(
        await getSearchEntityIfPossible(
            context.anonymousAction(),
            space.id,
            `Document:${document.id}`,
        ),
    ).toEqual({isPrivate: true});
});

test("allow reading entities with urlGrant = View as session actor in another space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session1 = await space1.createSession();
    const session2 = await space2.createSession();

    const document = await TestDocument.create(session1);
    await document.access.grantUrl(session1, "View");

    expect(
        await getSearchEntityIfPossible(session2.action(), space1.id, `Document:${document.id}`),
    ).not.toBeNull();
});

test("allow reading entities with urlGrant = View as anonymous actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);
    await document.access.grantUrl(session, "View");

    expect(
        await getSearchEntityIfPossible(
            context.anonymousAction(),
            space.id,
            `Document:${document.id}`,
        ),
    ).not.toBeNull();
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

test("searching mentions excludes entities user doesn\u2019t have access to", async () => {
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
                    type: "Document",
                    title: "Public Document 1",
                    document: {
                        id: publicDocument1.id,
                        version: 1,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Public Document 2",
                    document: {
                        id: publicDocument2.id,
                        version: 1,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Private Personal Document 1",
                    document: {
                        id: privatePersonalDocument1.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Private Shared Document 1",
                    document: {
                        id: privateSharedDocument1.id,
                        version: 1,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Private Shared Document 2",
                    document: {
                        id: privateSharedDocument2.id,
                        version: 1,
                    },
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
                    type: "Document",
                    title: "Public Document 1",
                    document: {
                        id: publicDocument1.id,
                        version: 1,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Public Document 2",
                    document: {
                        id: publicDocument2.id,
                        version: 1,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Private Personal Document 2",
                    document: {
                        id: privatePersonalDocument2.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Private Shared Document 2",
                    document: {
                        id: privateSharedDocument2.id,
                        version: 1,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "Private Shared Document 1",
                    document: {
                        id: privateSharedDocument1.id,
                        version: 1,
                    },
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
                    type: "Document",
                    title: "foobar document",
                    document: {
                        id: document1.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "foobaz channel",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Task",
                    title: "fooqux task",
                    task: {
                        id: task.id,
                        titleSnapshot: expect.any(Uint8Array),
                        displayStatus: {
                            value: "OpenInactive",
                            version: expect.any(Array),
                        },
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
                    type: "Document",
                    title: "foobar document",
                    document: {
                        id: document1.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "foobaz channel",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Task",
                    title: "fooqux task",
                    task: {
                        id: task.id,
                        titleSnapshot: expect.any(Uint8Array),
                        displayStatus: {
                            value: "OpenInactive",
                            version: expect.any(Array),
                        },
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
                    type: "Document",
                    title: "foobar document",
                    document: {
                        id: document1.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "foobaz channel",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
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
                    type: "Document",
                    title: "barfoo document",
                    document: {
                        id: document2.id,
                        version: 0,
                    },
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
                    type: "Document",
                    title: "foobar document",
                    document: {
                        id: document1.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "barfoo document",
                    document: {
                        id: document2.id,
                        version: 0,
                    },
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
                    type: "Document",
                    title: "foobar document",
                    document: {
                        id: document1.id,
                        version: 0,
                    },
                }),
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Channel",
                    title: "foobaz channel",
                    channel: {
                        id: channel.id,
                        version: 0,
                    },
                }),
            },
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );
});

test("searching mentions excludes accounts and includes chats when keywords match", async () => {
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
                    type: "Chat",
                    title: expect.stringMatching(/^(bar and qux|qux and bar)$/),
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
            },
            {
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "foo bar qux",
                    document: {
                        id: document.id,
                        version: 0,
                    },
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
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Chat",
                    title: expect.stringMatching(/^(bar and qux|qux and bar)$/),
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
                bodyTextSnippet: [],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "ChatMessage",
                    message: {
                        chatId: chat.id,
                        index: 0,
                        author: expect.any(AccountModel),
                    },
                    title: null,
                }),
                bodyTextSnippet: [{isHighlighted: true, text: "foo"}],
                parsedFilter: null,
            }),
            new SearchEntityResultModel({
                score: expect.any(Number),
                model: new SearchEntityModel({
                    type: "Document",
                    title: "foo bar qux",
                    document: {
                        id: document.id,
                        version: 0,
                    },
                }),
                bodyTextSnippet: [],
                parsedFilter: null,
            }),
        ].sort((a, b) => defaultCompareStrings(a.model.id, b.model.id)),
    );
});

test("searching mentions demotes direct chats below room chats", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Priority Actor"});
    const session2 = await space.createSession({name: "Priority One"});
    const session3 = await space.createSession({name: "Priority Two"});

    const directChat = await TestChat.get(session1, session2, session3);
    await directChat.sendMessage(session1, "direct chat message");

    const room1Chat = await TestChat.createRoom(session1, {name: "Priority Room"});
    await room1Chat.sendMessage(session2, "room chat message");

    const room2Chat = await TestChat.createRoom(session1, {name: "Proirity Room"});
    await room2Chat.sendMessage(session2, "room chat message");

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const results = await searchMentionByKeywords(session1.action(), {
        spaceId: space.id,
        queryText: "priority other",
        limit: 10,
    });

    expect(results.map(result => result.model.id)).toEqual([
        `Chat:${room1Chat.id}`,
        `Chat:${room2Chat.id}`,
        `Chat:${directChat.id}`,
    ]);
});

test("searching mentions has effective name fuzzy searching", async () => {
    const bookNames = [
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
        "The Grand Design",
        "The Lost Symbol",
        "The DaVinci Code",
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
    expect(await testSearch("jeeves thank you")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves you thank")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);

    // Testing word in different positions
    expect(await testSearch("code")).toEqual([
        "The DaVinci Code",
        "The Code of the Wooster",
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
        "Old Man\u2019s War",
    ]);
    expect(await testSearch("test ma")).toEqual(["Test Mabc", "Old Man\u2019s War", "Test Mxyz"]);
    expect(await testSearch("test mab")).toEqual(["Test Mabc", "Old Man\u2019s War", "Test Mxyz"]);
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
        "The Lock Artist",
        "The Grand Design",
        "The Lost Symbol",
        "The DaVinci Code",
        "The Book of Samson",
        "The Book of Lies",
    ]);
    expect(await testSearch("the preserv")).toEqual([
        "The Preservationist",
        "The Silmarillion",
        "The Code of the Wooster",
        "The Lock Artist",
        "The Grand Design",
        "The Lost Symbol",
        "The DaVinci Code",
        "The Book of Samson",
        "The Book of Lies",
    ]);
    expect(await testSearch("the dav")).toEqual([
        "The DaVinci Code",
        "The Preservationist",
        "The Silmarillion",
        "The Code of the Wooster",
        "The Lock Artist",
        "The Grand Design",
        "The Lost Symbol",
        "The Book of Samson",
        "The Book of Lies",
    ]);

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
});

test("you can still search for removed accounts but you can\u2019t see name updates", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    await space1.createSession({role: "Owner"});
    const session2 = await space2.createSession({role: "Owner"});

    const sharedAccount = await TestAccount.create(context, {name: "Alice"});
    const sharedSession = await TestSession.create(sharedAccount);

    await space1.addAccount(sharedAccount);
    await space2.addAccount(sharedAccount);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space1.id,
            `Account:${sharedAccount.id}~${space1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space1.id}`,
        routing: space1.id,
        version: expect.any(Object),
        fields: {title: ["Alice"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space2.id,
            `Account:${sharedAccount.id}~${space2.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space2.id}`,
        routing: space2.id,
        version: expect.any(Object),
        fields: {title: ["Alice"]},
    });

    await updateOurAccountName(sharedSession.action(), "Bob");

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space1.id,
            `Account:${sharedAccount.id}~${space1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space1.id}`,
        routing: space1.id,
        version: expect.any(Object),
        fields: {title: ["Bob"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space2.id,
            `Account:${sharedAccount.id}~${space2.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space2.id}`,
        routing: space2.id,
        version: expect.any(Object),
        fields: {title: ["Bob"]},
    });

    await removeSpaceAccount(session2.action(), {
        spaceId: space2.id,
        accountId: sharedAccount.id,
    });

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space1.id,
            `Account:${sharedAccount.id}~${space1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space1.id}`,
        routing: space1.id,
        version: expect.any(Object),
        fields: {title: ["Bob"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space2.id,
            `Account:${sharedAccount.id}~${space2.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space2.id}`,
        routing: space2.id,
        version: expect.any(Object),
        fields: {title: ["Bob"]},
    });

    await updateOurAccountName(sharedSession.action(), "Carol");

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space1.id,
            `Account:${sharedAccount.id}~${space1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space1.id}`,
        routing: space1.id,
        version: expect.any(Object),
        fields: {title: ["Carol"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space2.id,
            `Account:${sharedAccount.id}~${space2.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space2.id}`,
        routing: space2.id,
        version: expect.any(Object),
        fields: {title: ["Bob"]},
    });

    await addSpaceAccount(session2.action(), {
        spaceId: space2.id,
        accountId: sharedAccount.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(sharedSession.action(), space2.id);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space1.id,
            `Account:${sharedAccount.id}~${space1.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space1.id}`,
        routing: space1.id,
        version: expect.any(Object),
        fields: {title: ["Carol"]},
    });

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space2.id,
            `Account:${sharedAccount.id}~${space2.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${sharedAccount.id}~${space2.id}`,
        routing: space2.id,
        version: expect.any(Object),
        fields: {title: ["Carol"]},
    });
});

test("you can search for invited accounts by email, then by name once they\u2019ve accepted their invite", async () => {
    const space = await TestSpace.create(context);

    const ownerSession = await space.createSession({role: "Owner"});

    const invitedAccountEmailAddress = generateEmailAddressForTest();
    const invitedAccount = await TestAccount.create(context, {name: "Alice"});
    await invitedAccount.createEmailAddress(invitedAccountEmailAddress);

    // Add the account by email
    const result = await inviteEmailAddressesToSpace(ownerSession.action(), {
        spaceId: space.id,
        emailAddresses: [invitedAccountEmailAddress],
    });

    expect(result.accounts).toHaveLength(1);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // We should first see the user's email
    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Account:${invitedAccount.id}~${space.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${invitedAccount.id}~${space.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {title: [invitedAccountEmailAddress]},
    });

    await acceptSpaceAccountInvite((await TestSession.create(invitedAccount)).action(), space.id);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // After acceptance, we should convert this to their name
    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Account:${invitedAccount.id}~${space.id}`,
            {storedFields: ["title"]},
        ),
    ).toEqual({
        id: `Account:${invitedAccount.id}~${space.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {title: ["Alice"]},
    });
});

test("will index a large table into multiple chunks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        content: assertDocumentContent(
            schema.node("doc", {}, [
                schema.node("title", {}, [schema.text("Large Table")]),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "a1: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aenean accumsan sapien tempor dignissim posuere. Cras dapibus arcu at nisi porta condimentum. Nam eleifend tortor purus. Nulla eget vulputate libero. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Donec faucibus velit elit. Phasellus non cursus felis.",
                                ),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "a2: Mauris egestas nulla eget turpis pulvinar dictum. Sed eget ornare libero. Sed sit amet turpis non metus congue maximus nec quis orci. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Sed id fermentum eros. Nulla porta augue non quam fringilla, ac pulvinar lectus consequat. Aliquam auctor vulputate bibendum. Nulla in nibh mauris. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Nunc porttitor augue vel eros rutrum tristique. Cras ligula diam, pulvinar vel rutrum sed, rhoncus a lorem. Donec gravida tempus elit vitae congue. Fusce rhoncus non arcu vitae sagittis. In tristique ullamcorper lectus ac dignissim. Morbi faucibus, ipsum efficitur auctor aliquet, orci sapien iaculis augue, at vehicula libero eros id risus.",
                                ),
                            ]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "b1: Morbi sed eros id ligula placerat euismod. Phasellus congue, ex eget consectetur efficitur, leo lacus ullamcorper odio, sed mollis nulla dolor nec ex. Maecenas gravida imperdiet mattis. Nulla elementum id nulla sed sodales. Curabitur vel urna ullamcorper, faucibus nunc ut, scelerisque purus. Etiam auctor finibus tortor eu ullamcorper. Etiam sit amet sem nisl.",
                                ),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "b2: Quisque vestibulum felis quam, in congue lacus porta sed. Fusce non mattis nisl. Quisque rhoncus neque quis nunc finibus sollicitudin et id nisl. Quisque non urna sapien. Duis quam tellus, mollis ut leo cursus, venenatis mollis orci. Donec dapibus, libero eu aliquet ultrices, turpis massa suscipit augue, a auctor nulla risus sit amet ipsum. Donec leo elit, tincidunt ac lectus vitae, scelerisque commodo lectus. Integer pulvinar blandit sem, et interdum turpis maximus sit amet.",
                                ),
                            ]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "c1: Ut at risus rhoncus, pretium justo a, gravida mauris. In luctus tellus eu sodales aliquam. Etiam vel velit rhoncus, efficitur sem ut, euismod sapien. Vivamus ut vulputate enim. Nulla fringilla diam purus, vitae imperdiet sapien porta a. Aenean vitae euismod elit. Morbi vel blandit nisl. Donec tempor vehicula nulla, eu facilisis nibh malesuada quis.",
                                ),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "c2: Donec massa ante, viverra sed tellus a, euismod vulputate lorem. Donec id porttitor dolor, ut finibus nunc. Phasellus velit ligula, aliquet nec erat non, mattis iaculis est. Sed ipsum risus, porta non quam non, mattis faucibus nisl. Donec ornare, metus eu rhoncus congue, eros felis rutrum massa, nec pulvinar risus est nec nisl. Curabitur nec libero eu odio mollis ultrices ut vel dui. Aliquam iaculis finibus mattis. In efficitur felis nec dolor ornare interdum. Vivamus pellentesque sapien vel ligula aliquet commodo. Aenean ac mauris eget eros convallis sagittis nec in lorem. Maecenas et massa in sem ultricies elementum. Suspendisse nibh lacus, dapibus non nisi non, ultrices varius nisi. Nunc ac ipsum aliquet, ullamcorper mi sed, hendrerit libero. Praesent vitae tortor blandit, sodales odio a, rhoncus mauris.",
                                ),
                            ]),
                        ]),
                    ]),
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
                    "entity.id": [`Document:${document.id}`],
                    text: [
                        `# Large Table

<table><tbody><tr><td>

a1: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aenean accumsan sapien tempor dignissim posuere. Cras dapibus arcu at nisi porta condimentum. Nam eleifend tortor purus. Nulla eget vulputate libero. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Donec faucibus velit elit. Phasellus non cursus felis.

</td><td>

a2: Mauris egestas nulla eget turpis pulvinar dictum. Sed eget ornare libero. Sed sit amet turpis non metus congue maximus nec quis orci. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Sed id fermentum eros. Nulla porta augue non quam fringilla, ac pulvinar lectus consequat. Aliquam auctor vulputate bibendum. Nulla in nibh mauris. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Nunc porttitor augue vel eros rutrum tristique. Cras ligula diam, pulvinar vel rutrum sed, rhoncus a lorem. Donec gravida tempus elit vitae congue. Fusce rhoncus non arcu vitae sagittis. In tristique ullamcorper lectus ac dignissim. Morbi faucibus, ipsum efficitur auctor aliquet, orci sapien iaculis augue, at vehicula libero eros id risus.

</td></tr>`,
                    ],
                },
            },
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Document:${document.id}`],
                    text: [
                        `This is from the \u201CLarge Table\u201D document:

<tr><td>

b1: Morbi sed eros id ligula placerat euismod. Phasellus congue, ex eget consectetur efficitur, leo lacus ullamcorper odio, sed mollis nulla dolor nec ex. Maecenas gravida imperdiet mattis. Nulla elementum id nulla sed sodales. Curabitur vel urna ullamcorper, faucibus nunc ut, scelerisque purus. Etiam auctor finibus tortor eu ullamcorper. Etiam sit amet sem nisl.

</td><td>

b2: Quisque vestibulum felis quam, in congue lacus porta sed. Fusce non mattis nisl. Quisque rhoncus neque quis nunc finibus sollicitudin et id nisl. Quisque non urna sapien. Duis quam tellus, mollis ut leo cursus, venenatis mollis orci. Donec dapibus, libero eu aliquet ultrices, turpis massa suscipit augue, a auctor nulla risus sit amet ipsum. Donec leo elit, tincidunt ac lectus vitae, scelerisque commodo lectus. Integer pulvinar blandit sem, et interdum turpis maximus sit amet.

</td></tr>`,
                    ],
                },
            },
            {
                id: expect.any(String),
                score: expect.any(Number),
                fields: {
                    "entity.id": [`Document:${document.id}`],
                    text: [
                        `This is from the \u201CLarge Table\u201D document:

<tr><td>

c1: Ut at risus rhoncus, pretium justo a, gravida mauris. In luctus tellus eu sodales aliquam. Etiam vel velit rhoncus, efficitur sem ut, euismod sapien. Vivamus ut vulputate enim. Nulla fringilla diam purus, vitae imperdiet sapien porta a. Aenean vitae euismod elit. Morbi vel blandit nisl. Donec tempor vehicula nulla, eu facilisis nibh malesuada quis.

</td><td>

c2: Donec massa ante, viverra sed tellus a, euismod vulputate lorem. Donec id porttitor dolor, ut finibus nunc. Phasellus velit ligula, aliquet nec erat non, mattis iaculis est. Sed ipsum risus, porta non quam non, mattis faucibus nisl. Donec ornare, metus eu rhoncus congue, eros felis rutrum massa, nec pulvinar risus est nec nisl. Curabitur nec libero eu odio mollis ultrices ut vel dui. Aliquam iaculis finibus mattis. In efficitur felis nec dolor ornare interdum. Vivamus pellentesque sapien vel ligula aliquet commodo. Aenean ac mauris eget eros convallis sagittis nec in lorem. Maecenas et massa in sem ultricies elementum. Suspendisse nibh lacus, dapibus non nisi non, ultrices varius nisi. Nunc ac ipsum aliquet, ullamcorper mi sed, hendrerit libero. Praesent vitae tortor blandit, sodales odio a, rhoncus mauris.

</td></tr></tbody></table>`,
                    ],
                },
            },
        ].sort(
            (doc1, doc2) =>
                defaultCompareStrings(
                    doc1.fields["entity.id"][0] ?? "",
                    doc2.fields["entity.id"][0] ?? "",
                ) ||
                defaultCompareStrings(doc1.fields["text"][0] ?? "", doc2.fields["text"][0] ?? ""),
        ),
    );

    expect(
        await searchBySemantics(
            session.action().clone({languageModels: createLanguageModelsContextModuleForTest()}),
            {
                spaceId: space.id,
                queryText: "lorem ipsum",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            },
        ),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            model: new SearchEntityModel({
                type: "Document",
                title: "Large Table",
                document: {
                    id: document.id,
                    version: 0,
                },
            }),
            score: expect.closeTo(0.40715873),
            bodyTextSnippet: [
                {isHighlighted: false, text: "a1: "},
                {isHighlighted: true, text: "Lorem"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "ipsum"},
                {
                    isHighlighted: false,
                    text: " dolor sit amet, consectetur adipiscing elit. Aenean accumsan sapien tempor dignissim posuere. Cras dapibus arcu at nisi porta condimentum. Nam eleifend tortor purus. Nulla eget vulputate libero. Vestibulum ante ",
                },
                {isHighlighted: true, text: "ipsum"},
                {
                    isHighlighted: false,
                    text: " primis in faucibus orci luctus et ultrices posuere cubilia curae; Donec faucibus velit elit. Phasellus non cursus felis. a2: Mauris egestas nulla eget turpis pulvinar dictum. Sed eget ornare libero. Sed sit amet turpis non metus congue maximus nec quis orci. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Sed id fermentum eros. Nulla porta augue non quam fringilla, ac pulvinar lectus consequat. Aliquam auctor vulputate bibendum. Nulla in nibh mauris. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Nunc porttitor augue vel eros rutrum tristique. Cras ligula diam, pulvinar vel rutrum sed, rhoncus a ",
                },
                {isHighlighted: true, text: "lorem"},
                {
                    isHighlighted: false,
                    text: ". Donec gravida tempus elit vitae congue. Fusce rhoncus non arcu vitae sagittis. In tristique ullamcorper lectus ac dignissim. Morbi faucibus, ",
                },
                {isHighlighted: true, text: "ipsum"},
                {
                    isHighlighted: false,
                    text: " efficitur auctor aliquet, orci sapien iaculis augue, at vehicula libero eros id risus.",
                },
            ],
            parsedFilter: null,
        },
    ]);

    expect(
        await searchBySemantics(
            session.action().clone({languageModels: createLanguageModelsContextModuleForTest()}),
            {
                spaceId: space.id,
                queryText: "morbi sed eros id ligula",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            },
        ),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            model: new SearchEntityModel({
                type: "Document",
                title: "Large Table",
                document: {
                    id: document.id,
                    version: 0,
                },
            }),
            score: expect.closeTo(0.40590352),
            bodyTextSnippet: [
                {isHighlighted: false, text: "b1: "},
                {isHighlighted: true, text: "Morbi"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "sed"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "eros"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "id"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "ligula"},
                {
                    isHighlighted: false,
                    text: " placerat euismod. Phasellus congue, ex eget consectetur efficitur, leo lacus ullamcorper odio, ",
                },
                {isHighlighted: true, text: "sed"},
                {
                    isHighlighted: false,
                    text: " mollis nulla dolor nec ex. Maecenas gravida imperdiet mattis. Nulla elementum ",
                },
                {isHighlighted: true, text: "id"},
                {isHighlighted: false, text: " nulla "},
                {isHighlighted: true, text: "sed"},
                {
                    isHighlighted: false,
                    text: " sodales. Curabitur vel urna ullamcorper, faucibus nunc ut, scelerisque purus. Etiam auctor finibus tortor eu ullamcorper. Etiam sit amet sem nisl. b2: Quisque vestibulum felis quam, in congue lacus porta ",
                },
                {isHighlighted: true, text: "sed"},
                {
                    isHighlighted: false,
                    text: ". Fusce non mattis nisl. Quisque rhoncus neque quis nunc finibus sollicitudin et ",
                },
                {isHighlighted: true, text: "id"},
                {
                    isHighlighted: false,
                    text: " nisl. Quisque non urna sapien. Duis quam tellus, mollis ut leo cursus, venenatis mollis orci. Donec dapibus, libero eu aliquet ultrices, turpis massa suscipit augue, a auctor nulla risus sit amet ipsum. Donec leo elit, tincidunt ac lectus vitae, scelerisque commodo lectus. Integer pulvinar blandit sem, et interdum turpis maximus sit amet.",
                },
            ],
            parsedFilter: null,
        },
    ]);

    expect(
        await searchBySemantics(
            session.action().clone({languageModels: createLanguageModelsContextModuleForTest()}),
            {
                spaceId: space.id,
                queryText: "donec massa ante",
                limit: 100,
                timeZone: defaultTimeZone,
                currentTime: new Date(),
            },
        ),
    ).toEqual([
        {
            id: `Document:${document.id}`,
            model: new SearchEntityModel({
                type: "Document",
                title: "Large Table",
                document: {
                    id: document.id,
                    version: 0,
                },
            }),
            score: expect.closeTo(0.43615812),
            bodyTextSnippet: [
                {
                    isHighlighted: false,
                    text: "c1: Ut at risus rhoncus, pretium justo a, gravida mauris. In luctus tellus eu sodales aliquam. Etiam vel velit rhoncus, efficitur sem ut, euismod sapien. Vivamus ut vulputate enim. Nulla fringilla diam purus, vitae imperdiet sapien porta a. Aenean vitae euismod elit. Morbi vel blandit nisl. ",
                },
                {isHighlighted: true, text: "Donec"},
                {
                    isHighlighted: false,
                    text: " tempor vehicula nulla, eu facilisis nibh malesuada quis. c2: ",
                },
                {isHighlighted: true, text: "Donec"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "massa"},
                {isHighlighted: false, text: " "},
                {isHighlighted: true, text: "ante"},
                {isHighlighted: false, text: ", viverra sed tellus a, euismod vulputate lorem. "},
                {isHighlighted: true, text: "Donec"},
                {
                    isHighlighted: false,
                    text: " id porttitor dolor, ut finibus nunc. Phasellus velit ligula, aliquet nec erat non, mattis iaculis est. Sed ipsum risus, porta non quam non, mattis faucibus nisl. ",
                },
                {isHighlighted: true, text: "Donec"},
                {
                    isHighlighted: false,
                    text: " ornare, metus eu rhoncus congue, eros felis rutrum ",
                },
                {isHighlighted: true, text: "massa"},
                {
                    isHighlighted: false,
                    text: ", nec pulvinar risus est nec nisl. Curabitur nec libero eu odio mollis ultrices ut vel dui. Aliquam iaculis finibus mattis. In efficitur felis nec dolor ornare interdum. Vivamus pellentesque sapien vel ligula aliquet commodo. Aenean ac mauris eget eros convallis sagittis nec in lorem. Maecenas et ",
                },
                {isHighlighted: true, text: "massa"},
                {
                    isHighlighted: false,
                    text: " in sem ultricies elementum. Suspendisse nibh lacus, dapibus non nisi non, ultrices varius nisi. Nunc ac ipsum aliquet, ullamcorper mi sed, hendrerit libero. Praesent vitae tortor blandit, sodales odio a, rhoncus mauris.",
                },
            ],
            parsedFilter: null,
        },
    ]);
});

describe("`getSearchEntityIfPossible()`", () => {
    describe("bot actor", () => {
        let scenario: Awaited<ReturnType<typeof createScenario>>;
        let runAfterTestEndsCallbacks: () => Promise<void>;

        beforeAll(async () => {
            runAfterTestEndsCallbacks = await captureAfterTestEndsCallbacks(async () => {
                scenario = await createScenario();
            });
        });

        afterAll(async () => {
            await runAfterTestEndsCallbacks();
        });

        async function createScenario() {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const [session2, session3, session4] = await space.createSessions(3);
            const botAccount = await TestBot.createAndInstantiate(session1);

            const document1 = await TestDocument.create(session1, {title: "Test 1"});
            await document1.access.grant(session1, session2);

            const document2 = await TestDocument.create(session1, {title: "Test 2"});
            await document2.access.grant(session1, session3);

            const document3 = await TestDocument.create(session1, {title: "Test 2"});
            await document3.access.grant(session1, session2);
            await document3.access.grant(session1, session3);

            const document4 = await TestDocument.create(session1, {title: "Test 2"});
            await document4.access.grantDefault(session1);

            await runAllTimersAndWaitForTestTasks();

            await context.opensearch.refresh(SearchEntityKeywordIndex);

            return {
                space,
                session1,
                session2,
                session3,
                session4,
                botAccount,
                document1,
                document2,
                document3,
                document4,
            };
        }

        type ExpectedResult = boolean;
        type DocumentName = keyof typeof scenario & `document${string}`;
        type AccountName = keyof typeof scenario & `session${string}`;

        const testCases: Record<
            DocumentName,
            {
                space: ExpectedResult;
                account: Record<AccountName, ExpectedResult>;
                document: Record<DocumentName, ExpectedResult>;
            }
        > = {
            document1: {
                space: false,
                account: {
                    session1: true,
                    session2: true,
                    session3: false,
                    session4: false,
                },
                document: {
                    document1: true,
                    document2: false,
                    document3: false,
                    document4: false,
                },
            },
            document2: {
                space: false,
                account: {
                    session1: true,
                    session2: false,
                    session3: true,
                    session4: false,
                },
                document: {
                    document1: false,
                    document2: true,
                    document3: false,
                    document4: false,
                },
            },
            document3: {
                space: false,
                account: {
                    session1: true,
                    session2: true,
                    session3: true,
                    session4: false,
                },
                document: {
                    document1: true,
                    document2: true,
                    document3: true,
                    document4: false,
                },
            },
            document4: {
                space: true,
                account: {
                    session1: true,
                    session2: true,
                    session3: true,
                    session4: true,
                },
                document: {
                    document1: true,
                    document2: true,
                    document3: true,
                    document4: true,
                },
            },
        };

        for (const [documentName, testCases2] of getObjectEntriesWithKeyofType(testCases)) {
            // eslint-disable-next-line jest/valid-title
            test(quote`${documentName} loaded with space scope`, async () => {
                expect(
                    await getSearchEntityIfPossible(
                        scenario.botAccount.action({type: "Space"}),
                        scenario.space.id,
                        `Document:${scenario[documentName].id}`,
                    ).then(entity => entity?.isPrivate),
                ).toEqual(!testCases2.space);
            });

            for (const [accountName, expectedResult] of getObjectEntriesWithKeyofType(
                testCases2.account,
            )) {
                // eslint-disable-next-line jest/valid-title
                test(quote`${documentName} loaded with ${accountName} account scope`, async () => {
                    expect(
                        await getSearchEntityIfPossible(
                            scenario.botAccount.action({
                                type: "Account",
                                accountId: scenario[accountName].account.id,
                            }),
                            scenario.space.id,
                            `Document:${scenario[documentName].id}`,
                        ).then(entity => entity?.isPrivate),
                    ).toEqual(!expectedResult);
                });
            }

            for (const [otherDocumentName, expectedResult] of getObjectEntriesWithKeyofType(
                testCases2.document,
            )) {
                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${documentName} loaded with ${otherDocumentName} document scope`,
                    async () => {
                        expect(
                            await getSearchEntityIfPossible(
                                scenario.botAccount.action({
                                    type: "Document",
                                    documentId: scenario[otherDocumentName].id,
                                }),
                                scenario.space.id,
                                `Document:${scenario[documentName].id}`,
                            ).then(entity => entity?.isPrivate),
                        ).toEqual(!expectedResult);
                    },
                );
            }
        }
    });
});

describe("bot with space-level access can access space-level content", () => {
    const testSearch = (searchType: "keywords" | "semantics"): void => {
        const searchFunction = searchType === "keywords" ? searchByKeywords : searchBySemantics;
        const searchIndex =
            searchType === "keywords" ? SearchEntityKeywordIndex : SearchEntityEmbeddingChunkIndex;

        test(`${searchType}`, async () => {
            const space = await TestSpace.create(context);
            const botSession = await space.createSession({role: "Admin"});
            const humanSession = await space.createSession();
            const botAccount = await TestBot.createAndInstantiate(botSession);

            // For semantic search, we need enough content to generate embeddings
            const testBody = createArrayWithLength(100, () => "test").join(" ");

            const publicDocument = await TestDocument.create(humanSession, {
                title: "test",
                body: testBody,
            });
            await publicDocument.access.grantDefault(humanSession);

            const publicChannel = await TestChannel.create(humanSession, {
                name: "Public channel",
                access: "Public",
            });
            const privateChannel = await TestChannel.create(humanSession, {
                name: "Private channel",
                access: "Private",
            });

            const publicPost = await publicChannel.createPost(humanSession, testBody);
            await privateChannel.createPost(humanSession, testBody);

            await runAllTimersAndWaitForTestTasks();

            await context.opensearch.refresh(searchIndex);

            const results = await searchFunction(
                botAccount
                    .action({type: "Space"})
                    .clone({languageModels: createLanguageModelsContextModuleForTest()}),
                {
                    spaceId: space.id,
                    queryText: "test",
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                },
            );

            expect(
                results
                    .map(result => result.id)
                    .filter(id => !id.startsWith("Account:") && !id.startsWith("Channel:"))
                    .sort(defaultCompareStrings),
            ).toEqual(
                [`Document:${publicDocument.id}`, `Post:${publicPost.id}`].sort(
                    defaultCompareStrings,
                ),
            );
        });
    };

    testSearch("keywords");
    testSearch("semantics");
});

describe("bot with account-specific grants has access to entities that every account has access to and space-level content", () => {
    const testSearch = (searchType: "keywords" | "semantics"): void => {
        const searchFunction = searchType === "keywords" ? searchByKeywords : searchBySemantics;
        const searchIndex =
            searchType === "keywords" ? SearchEntityKeywordIndex : SearchEntityEmbeddingChunkIndex;

        test(`${searchType}`, async () => {
            const space = await TestSpace.create(context);
            const botSession = await space.createSession({role: "Admin"});
            const humanSession1 = await space.createSession();
            const humanSession2 = await space.createSession();
            const botAccount = await TestBot.createAndInstantiate(botSession);
            const botAccount2 = await TestBot.createAndInstantiate(botSession);
            // Human 3 is _not_ in the chat.
            const humanSession3 = await space.createSession();

            const testBody = createArrayWithLength(100, () => "test").join(" ");

            // Document is private but human 1 and human 2 have access
            const document1 = await TestDocument.create(humanSession1, {
                title: "test",
                body: testBody,
            });
            await document1.access.grant(humanSession1, humanSession2);

            // Document 2 is only accessible to human 1 (creator)
            await TestDocument.create(humanSession1, {title: "test", body: testBody});

            // Document 3 is publicly accessible within space
            const document3 = await TestDocument.create(humanSession1, {
                title: "test",
                body: testBody,
            });
            await document3.access.grantDefault(humanSession1);

            // Document 4 is created by a human that is not in the chat and only one member of
            // the chat (human 1) has access. Document 4 should then not be accessible to the
            // bot.
            const document4 = await TestDocument.create(humanSession3, {
                title: "test",
                body: testBody,
            });
            await document4.access.grant(humanSession3, humanSession1);

            // Chat between human 1, human 2, and bot 1 and bot 2
            const chat = await createChatForTest(humanSession1.action(), {
                spaceId: space.id,
                otherAccountIds: [humanSession2.account.id, botAccount.id, botAccount2.id],
            });

            // Private channel where both human 1 and human 2 have access
            const privateChannel = await TestChannel.create(humanSession1, {
                name: "Private channel",
                access: "Private",
            });
            await privateChannel.access.grantAccounts(humanSession1, [humanSession2]);
            const post1 = await privateChannel.createPost(humanSession1, testBody);

            const publicChannel = await TestChannel.create(humanSession1, {
                name: "Public channel",
                access: "Public",
            });
            const post2 = await publicChannel.createPost(humanSession1, testBody);

            // Only human 1 has access (creator)
            const privateChannel2 = await TestChannel.create(humanSession1, {
                name: "Private channel 2",
                access: "Private",
            });
            await privateChannel2.createPost(humanSession1, testBody);

            await runAllTimersAndWaitForTestTasks();

            await context.opensearch.refresh(searchIndex);

            const results = await searchFunction(
                botAccount
                    .action({
                        type: "Chat",
                        chatId: chat.id,
                    })
                    .clone({languageModels: createLanguageModelsContextModuleForTest()}),
                {
                    spaceId: space.id,
                    queryText: "test",
                    limit: 100,
                    timeZone: defaultTimeZone,
                    currentTime: new Date(),
                },
            );

            expect(
                results
                    .map(result => result.id)
                    .filter(id => !id.startsWith("Account:") && !id.startsWith("Channel:"))
                    .sort(defaultCompareStrings),
            ).toEqual(
                [
                    `Document:${document1.id}`,
                    `Document:${document3.id}`,
                    `Post:${post1.id}`,
                    `Post:${post2.id}`,
                ].sort(defaultCompareStrings),
            );
        });
    };

    testSearch("keywords");
    testSearch("semantics");
});

test("bot in a chat with all bots has access to space-level content", async () => {
    const space = await TestSpace.create(context);
    const botSession = await space.createSession({role: "Admin"});
    const humanSession = await space.createSession();
    const bot1 = await TestBot.createAndInstantiate(botSession);
    const bot2 = await TestBot.createAndInstantiate(botSession);
    const bot3 = await TestBot.createAndInstantiate(botSession);

    // Document granted only to bot2 and bot3 (should not appear after filtering)
    await TestDocument.create(humanSession, {title: "test"});

    // Document with default grant (should appear)
    const document2 = await TestDocument.create(humanSession, {title: "test"});
    await document2.access.grantDefault(humanSession);

    // Task granted only to bot2 (should not appear after filtering)
    const task1 = await TestTask.create(humanSession, {title: "test"});
    await task1.addCollection(
        humanSession,
        await TestTaskCollection.create(humanSession, {name: "test"}),
    );

    // Collection with default grant (should appear)
    const collection = await TestTaskCollection.create(humanSession, {name: "test"});
    await collection.access.grantDefault(humanSession);

    // Create a chat with only bot accounts This shouldn't be possible but is worth
    // testing
    const chat = await createChatForTest(botSession.action(), {
        spaceId: space.id,
        otherAccountIds: [bot2.id, bot3.id],
    });

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const results = await searchByKeywords(
        bot1.action({
            type: "Chat",
            chatId: chat.id,
        }),
        {
            spaceId: space.id,
            queryText: "test",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        },
    );

    // Should only see entities with default grants, not those granted only to bots
    expect(
        results
            .map(result => result.id)
            .filter(id => !id.startsWith("Account:"))
            .sort(defaultCompareStrings),
    ).toEqual(
        [`Document:${document2.id}`, `TaskCollection:${collection.id}`].sort(defaultCompareStrings),
    );
});

test("bot cannot search entities from a different space even with account grants", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const space1Session = await space1.createSession({role: "Admin"});
    const space2Session = await space2.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(space1Session);

    // Create entities in space1 (bot's space)
    const document1 = await TestDocument.create(space1Session, {title: "test in space1"});
    await document1.access.grantDefault(space1Session);

    // Create entities in space2 (different space)
    const document2 = await TestDocument.create(space2Session, {title: "test in space2"});
    await document2.access.grantDefault(space2Session);

    await runAllTimersAndWaitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Bot should only see entities from space1
    const space1Results = await searchByKeywords(botAccount.action({type: "Space"}), {
        spaceId: space1.id,
        queryText: "test",
        limit: 100,
        timeZone: defaultTimeZone,
        currentTime: new Date(),
    });

    expect(
        space1Results
            .map(result => result.id)
            .filter(id => !id.startsWith("Account:"))
            .sort(defaultCompareStrings),
    ).toEqual([`Document:${document1.id}`]);

    // Bot should not have access to space2
    await expect(
        searchByKeywords(botAccount.action({type: "Space"}), {
            spaceId: space2.id,
            queryText: "test",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        }),
    ).rejects.toThrow(PermissionDeniedError);
});
