import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    DocumentContentCacheForUpdate,
    getDocumentContentPreviewIfExists,
    getGlobalDocumentContentCacheForUpdateForTest,
} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityDependentsJobTestCounter,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    searchByAffinity,
    searchByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    assertDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityId, SearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchAffinityEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchAffinityEntityResultModel} from "~/shared/search/search_entity_result_model.js";

// Needs to be before `afterEach()` hook where we err if there are remaining timers
// since the constructor adds an `afterEach()` hook to clear timers within this
// class.
const cache = getGlobalDocumentContentCacheForUpdateForTest();
const otherCache = new DocumentContentCacheForUpdate();

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

let indexSearchEntityJobCount = 0;

beforeEach(() => {
    indexSearchEntityJobCount = 0;
});

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime, span) => {
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

function getIndexedSearchEntity(entity: TestDocument) {
    const context = entity.context;
    const spaceId = entity.space.id;
    const entityId: SearchEntityId = `Document:${entity.id}`;

    return actuallyGetIndexedSearchEntity(context, spaceId, entityId);
}

async function actuallyGetIndexedSearchEntity(
    context: TestContext,
    spaceId: SpaceId,
    entityId: Exclude<SearchDynamicEntityId, `Account:${AccountId}`>,
): Promise<{
    title: string | null;
    body: string | null;
}> {
    const docForKeywordIndex = await context.opensearch.getDocWithoutSourceIfExists(
        SearchEntityKeywordIndex,
        spaceId,
        entityId,
        {storedFields: ["title", "body"]},
    );

    return {
        title: docForKeywordIndex?.fields.title?.[0] ?? null,
        body: docForKeywordIndex?.fields.body?.[0] ?? null,
    };
}

test("will index a document after a timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("will only index a document once if update happened within the timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("will only index a document once if update happened within timeout even across different caches", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.type(session, " This is the title", {cacheOverrideForTest: otherCache});

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.type(session, " of a game show from BoJack");

    await ProcessContextModule.waitForTestTasks();

    await document.type(session, " Horseman hosted by the", {cacheOverrideForTest: otherCache});

    await ProcessContextModule.waitForTestTasks();

    await document.type(session, " character Mr. Peanutbutter.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();
    otherCache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("will index a document again if update happened after timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    const {getCount: getUpdateTitleDependentsCount} =
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("will index a document again if update happened after timeout with more updates after first timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await ProcessContextModule.waitForTestTasks();

    const {getCount: getUpdateTitleDependentsCount} =
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });
    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual(expect.objectContaining({version: 0}));

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });
    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 0,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hollywoo Stars and Celebrities")]),
                schema.node("paragraph", null, [
                    schema.text("What Do They Know? Do They Know Things? Let\u2019s Find Out."),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    await document.type(session, " This is the title of a game show from BoJack");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });
    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 0,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hollywoo Stars and Celebrities")]),
                schema.node("paragraph", null, [
                    schema.text("What Do They Know? Do They Know Things? Let\u2019s Find Out."),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });
    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 0,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hollywoo Stars and Celebrities")]),
                schema.node("paragraph", null, [
                    schema.text("What Do They Know? Do They Know Things? Let\u2019s Find Out."),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    await document.type(session, " Horseman hosted by the character Mr. Peanutbutter.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });
    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 0,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hollywoo Stars and Celebrities")]),
                schema.node("paragraph", null, [
                    schema.text("What Do They Know? Do They Know Things? Let\u2019s Find Out."),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });
    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 2,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hollywoo Stars and Celebrities")]),
                schema.node("paragraph", null, [
                    schema.text(
                        "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
                    ),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("will not schedule another indexing job if document title is updated after creation", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    const {getCount: getUpdateTitleDependentsCount} =
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    await document.update(session, [
        new ReplaceStep(9, 9, new Slice(Fragment.from(schema.text("d (test)")), 0, 0)),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();
});

test("will schedule another indexing job if document title is updated after content update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    const {getCount: getUpdateTitleDependentsCount} =
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.update(session, [
        new ReplaceStep(9, 9, new Slice(Fragment.from(schema.text("d (test)")), 0, 0)),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateTitleDependentsCount()).toEqual(2);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("will not schedule another indexing job if document title is updated twice after content update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    const {getCount: getUpdateTitleDependentsCount} =
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentsCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    await document.update(session, [
        new ReplaceStep(9, 9, new Slice(Fragment.from(schema.text("d (test)")), 0, 0)),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(2.5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await document.update(session, [
        new ReplaceStep(9, 9, new Slice(Fragment.from(schema.text("oooooo")), 0, 0)),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentsCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(2.5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateTitleDependentsCount()).toEqual(2);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywooooooood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job and the
    // `AddFeedAccountCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.clearAllTimers();
});

test("document access policies are enforced in search", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4, session5, session6] =
        await space.createSessions(6);

    const documents = await runAllPromises([
        TestDocument.create(session1, {title: "test 1"}),
        TestDocument.create(session1, {title: "test 2"}),
        TestDocument.create(session1, {title: "test 3"}),
        TestDocument.create(session1, {title: "test 4"}),
        TestDocument.create(session1, {title: "test 5"}),
        TestDocument.create(session6, {title: "test 6"}),
        TestDocument.create(session6, {title: "test 7"}),
        TestDocument.create(session6, {title: "test 8"}),
    ]);

    const documentSearchEntityIdOrder = documents.map(document => `Document:${document.id}`);

    const [document1, document2, document3, document4, document5, document6, document7, document8] =
        documents;

    await document2.access.grant(session1, session6);

    await document3.access.grant(session1, session2, "View");
    await document3.access.grant(session1, session3, "Comment");
    await document3.access.grant(session1, session4, "Edit");
    await document3.access.grant(session1, session5, "Manage");

    await document4.access.grantDefault(session1);

    await document5.access.grantDefault(session1, "View");
    await document5.access.grant(session1, session2);
    await document5.access.grant(session1, session3);

    await document6.access.grantUrl(session6);

    await document7.access.grantUrl(session6);
    await document7.access.grant(session6, session5);

    await document8.access.grantUrl(session6);
    await document8.access.grantDefault(session6);

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
                    assertExists(documentSearchEntityIdOrder.findIndex(id => id === id1)) -
                    assertExists(documentSearchEntityIdOrder.findIndex(id => id === id2)),
            );
    };

    expect(await getSearchEntityIds(session1)).toEqual([
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    await document5.access.revoke(session1, session2);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    await document5.access.revokeDefault(session1);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    await document3.access.revoke(session1, session4);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);
});

test("document comment access policies are enforced in search", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4, session5, session6] =
        await space.createSessions(6);

    const documents = await runAllPromises([
        TestDocument.create(session1, {body: "test 1"}),
        TestDocument.create(session1, {body: "test 2"}),
        TestDocument.create(session1, {body: "test 3"}),
        TestDocument.create(session1, {body: "test 4"}),
        TestDocument.create(session1, {body: "test 5"}),
        TestDocument.create(session6, {body: "test 6"}),
        TestDocument.create(session6, {body: "test 7"}),
        TestDocument.create(session6, {body: "test 8"}),
    ]);

    const [document1, document2, document3, document4, document5, document6, document7, document8] =
        documents;

    const commentThreads = await runAllPromises([
        document1.createCommentThread(session1, {from: 3, to: 6}, "test comment 1"),
        document2.createCommentThread(session1, {from: 3, to: 6}, "test comment 2"),
        document3.createCommentThread(session1, {from: 3, to: 6}, "test comment 3"),
        document4.createCommentThread(session1, {from: 3, to: 6}, "test comment 4"),
        document5.createCommentThread(session1, {from: 3, to: 6}, "test comment 5"),
        document6.createCommentThread(session6, {from: 3, to: 6}, "test comment 6"),
        document7.createCommentThread(session6, {from: 3, to: 6}, "test comment 7"),
        document8.createCommentThread(session6, {from: 3, to: 6}, "test comment 8"),
    ]);

    const searchEntityIdOrder = [
        ...commentThreads.map(
            commentThread => `DocumentComment:${commentThread.document.id}-${commentThread.id}-0`,
        ),
        ...documents.map(document => `Document:${document.id}`),
    ];

    const [
        commentThread1,
        commentThread2,
        commentThread3,
        commentThread4,
        commentThread5,
        commentThread6,
        commentThread7,
        commentThread8,
    ] = commentThreads;

    await document2.access.grant(session1, session6);

    await document3.access.grant(session1, session2, "View");
    await document3.access.grant(session1, session3, "Comment");
    await document3.access.grant(session1, session4, "Edit");
    await document3.access.grant(session1, session5, "Manage");

    await document4.access.grantDefault(session1);

    await document5.access.grantDefault(session1, "View");
    await document5.access.grant(session1, session2);
    await document5.access.grant(session1, session3);

    await document6.access.grantUrl(session6);

    await document7.access.grantUrl(session6);
    await document7.access.grant(session6, session5);

    await document8.access.grantUrl(session6);
    await document8.access.grantDefault(session6);

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
        `DocumentComment:${document1.id}-${commentThread1.id}-0`,
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document6.id}-${commentThread6.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    await document5.access.revoke(session1, session2);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `DocumentComment:${document1.id}-${commentThread1.id}-0`,
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document6.id}-${commentThread6.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    await document5.access.revokeDefault(session1);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `DocumentComment:${document1.id}-${commentThread1.id}-0`,
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document6.id}-${commentThread6.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    await document3.access.revoke(session1, session4);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(session1)).toEqual([
        `DocumentComment:${document1.id}-${commentThread1.id}-0`,
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document1.id}`,
        `Document:${document2.id}`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session2)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session3)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document5.id}-${commentThread5.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document5.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session4)).toEqual([
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document4.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session5)).toEqual([
        `DocumentComment:${document3.id}-${commentThread3.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document3.id}`,
        `Document:${document4.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);

    expect(await getSearchEntityIds(session6)).toEqual([
        `DocumentComment:${document2.id}-${commentThread2.id}-0`,
        `DocumentComment:${document4.id}-${commentThread4.id}-0`,
        `DocumentComment:${document6.id}-${commentThread6.id}-0`,
        `DocumentComment:${document7.id}-${commentThread7.id}-0`,
        `DocumentComment:${document8.id}-${commentThread8.id}-0`,
        `Document:${document2.id}`,
        `Document:${document4.id}`,
        `Document:${document6.id}`,
        `Document:${document7.id}`,
        `Document:${document8.id}`,
    ]);
});

test("newly created documents will be visible in search even before indexing", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session1, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });
    await document.access.grantDefault(session1);

    await markSearchAffinityEntityInteraction(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    expect(await searchByAffinity(session2.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    expect(await searchByAffinity(session2.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    await document.access.revokeDefault(session1);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    expect(await searchByAffinity(session2.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [],
    });

    await document.access.grantDefault(session1);

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    expect(await searchByAffinity(session2.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    await document.access.revokeDefault(session1);

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    expect(await searchByAffinity(session2.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(1),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await searchByAffinity(session1.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [
            new SearchAffinityEntityResultModel({
                score: expect.closeTo(60),
                favoriteOrderKey: null,
                model: SearchAffinityEntityModel.new({
                    id: `Document:${document.id}`,
                    title: "Hollywoo Stars and Celebrities",
                    titleVersion: {type: "Integer", version: expect.any(Number)},
                    media: null,
                }),
            }),
        ],
    });

    expect(await searchByAffinity(session2.action(), space.id)).toEqual({
        hasMoreFavoriteResults: false,
        favoriteResults: [],
        results: [],
    });

    // Make sure there are no more jobs in the queue.
    cache.evictAllDocumentsForTest();

    // Clear the timer for the `IndexSearchEntityEmbeddingChunks` job, the
    // `AddFeedAccountCandidateEntry` job, and the `AddFeedCandidateEntry` job.
    expect(import.meta.jest.getTimerCount()).toEqual(2);
    import.meta.jest.clearAllTimers();
});

test("can\u2019t search documents with tables by HTML tags", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        content: assertDocumentContent(
            schema.node("doc", {}, [
                schema.node("title"),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("foo")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("bar")]),
                        ]),
                    ]),
                ]),
            ]),
        ),
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const getSearchEntityIds = async (session: TestSpaceSession, queryText: string) => {
        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText,
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .filter(result => !result.id.startsWith("Account:"))
            .map(result => ({id: result.id, bodyTextSnippet: result.bodyTextSnippet}));
    };

    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Untitled",
        body: `

foo



bar

`,
    });

    expect(await getSearchEntityIds(session, "foo")).toEqual([
        {
            id: `Document:${document.id}`,
            bodyTextSnippet: [
                {isHighlighted: true, text: "foo"},
                {isHighlighted: false, text: ". bar"},
            ],
        },
    ]);

    expect(await getSearchEntityIds(session, "qux")).toEqual([]);
    expect(await getSearchEntityIds(session, "<table>")).toEqual([]);
    expect(await getSearchEntityIds(session, "<tbody>")).toEqual([]);
    expect(await getSearchEntityIds(session, "<tr>")).toEqual([]);
    expect(await getSearchEntityIds(session, "<td>")).toEqual([]);
    expect(await getSearchEntityIds(session, "table")).toEqual([]);
    expect(await getSearchEntityIds(session, "tbody")).toEqual([]);
    expect(await getSearchEntityIds(session, "tr")).toEqual([]);
    expect(await getSearchEntityIds(session, "td")).toEqual([]);

    expect(await getSearchEntityIds(session, "bar")).toEqual([
        {
            id: `Document:${document.id}`,
            bodyTextSnippet: [
                {isHighlighted: false, text: "foo. "},
                {isHighlighted: true, text: "bar"},
            ],
        },
    ]);
});

test("can\u2019t search documents with table HTML tags in text", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        content: assertDocumentContent(
            schema.node("doc", {}, [
                schema.node("title"),
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("<table>bar</table>")]),
            ]),
        ),
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const getSearchEntityIds = async (session: TestSpaceSession, queryText: string) => {
        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText,
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .filter(result => !result.id.startsWith("Account:"))
            .map(result => ({id: result.id, bodyTextSnippet: result.bodyTextSnippet}));
    };

    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Untitled",
        body: `foo

\\<table>bar\\</table>`,
    });

    expect(await getSearchEntityIds(session, "foo")).toEqual([
        {
            id: `Document:${document.id}`,
            bodyTextSnippet: [
                {isHighlighted: true, text: "foo"},
                {isHighlighted: false, text: ". <table>bar</table>"},
            ],
        },
    ]);

    expect(await getSearchEntityIds(session, "bar")).toEqual([
        {
            id: `Document:${document.id}`,
            bodyTextSnippet: [
                {isHighlighted: false, text: "foo. <table>"},
                {isHighlighted: true, text: "bar"},
                {isHighlighted: false, text: "</table>"},
            ],
        },
    ]);

    expect(await getSearchEntityIds(session, "qux")).toEqual([]);
    expect(await getSearchEntityIds(session, "<tbody>")).toEqual([]);
    expect(await getSearchEntityIds(session, "<tr>")).toEqual([]);
    expect(await getSearchEntityIds(session, "<td>")).toEqual([]);
    expect(await getSearchEntityIds(session, "tbody")).toEqual([]);
    expect(await getSearchEntityIds(session, "tr")).toEqual([]);
    expect(await getSearchEntityIds(session, "td")).toEqual([]);

    expect(await getSearchEntityIds(session, "<table>")).toEqual([
        {
            id: `Document:${document.id}`,
            bodyTextSnippet: [
                {isHighlighted: false, text: "foo. <"},
                {isHighlighted: true, text: "table"},
                {isHighlighted: false, text: ">bar</"},
                {isHighlighted: true, text: "table"},
                {isHighlighted: false, text: ">"},
            ],
        },
    ]);

    expect(await getSearchEntityIds(session, "table")).toEqual([
        {
            id: `Document:${document.id}`,
            bodyTextSnippet: [
                {isHighlighted: false, text: "foo. <"},
                {isHighlighted: true, text: "table"},
                {isHighlighted: false, text: ">bar</"},
                {isHighlighted: true, text: "table"},
                {isHighlighted: false, text: ">"},
            ],
        },
    ]);
});
