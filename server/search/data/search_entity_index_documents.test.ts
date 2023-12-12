import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {DocumentContentCacheForUpdate} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {OpensearchGetDocWithoutSourceCommand} from "~/server/opensearch/opensearch_client.js";
import {SearchEntityId} from "~/server/search/core/search_entity_id.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    processSearchEntityJobUpdateDependentEntitiesTestCounter,
} from "~/server/search/data/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// Needs to be before `afterEach()` hook where we err if there are remaining
// timers since the constructor adds an `afterEach()` hook to clear timers
// within this class.
const otherCache = new DocumentContentCacheForUpdate();

import.meta.jest.useFakeTimers();

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

const {SearchEntityKeywordIndex, SearchEntitySemanticIndex} = getSearchEntityIndexesForTest();

let indexSearchEntityJobCount = 0;

beforeEach(() => {
    indexSearchEntityJobCount = 0;
});

const context = createTestContext({
    shouldStartOpensearch: true,
    processJob: async (actionContext, job, jobStartTime) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                indexSearchEntityJobCount++;

                await processIndexSearchEntityJob(
                    actionContext.clone({
                        tasks: new TestTaskContextModule({
                            shouldSkipIndexing: !context.isOpensearchEnabled,
                            dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
                        }),
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

function getIndexedSearchEntity(entity: TestDocument) {
    const context = entity.context;
    const spaceId = entity.space.id;
    const entityId: SearchEntityId = `Document:${entity.id}`;

    return actuallyGetIndexedSearchEntity(context, spaceId, entityId);
}

async function actuallyGetIndexedSearchEntity(
    context: TestContext,
    spaceId: SpaceId,
    entityId: SearchEntityId,
): Promise<{
    title: string | null;
    body: string | null;
    embeddingChunkCount?: number;
}> {
    const [docForKeywordIndex, docForSemanticIndex] = await context.opensearch.multiGetDocsIfExist([
        new OpensearchGetDocWithoutSourceCommand(SearchEntityKeywordIndex, spaceId, entityId, {
            storedFields: ["title", "body"],
        }),
        new OpensearchGetDocWithoutSourceCommand(SearchEntitySemanticIndex, spaceId, entityId, {
            storedFields: ["embeddingChunks.text"],
        }),
    ]);

    const embeddingChunkCount = docForSemanticIndex?.fields["embeddingChunks.text"]?.length ?? 0;

    return {
        title: docForKeywordIndex?.fields.title?.[0] ?? null,
        body: docForKeywordIndex?.fields.body?.[0] ?? null,
        ...(embeddingChunkCount !== 0 ? {embeddingChunkCount} : {}),
    };
}

test("will index a document after a timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will only index a document once if update happened within the timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
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

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will only index a document once if update happened within timeout even across different caches", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(session, " This is the title", {cacheOverride: otherCache});

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(session, " of a game show from BoJack");

    await ProcessContextModule.waitForTestTasks();

    await document.type(session, " Horseman hosted by the", {cacheOverride: otherCache});

    await ProcessContextModule.waitForTestTasks();

    await document.type(session, " character Mr. Peanutbutter.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will index a document again if update happened after timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    const {getCount: getUpdateTitleDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will index a document again if update happened after timeout with more updates after first timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await ProcessContextModule.waitForTestTasks();

    const {getCount: getUpdateTitleDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(session, " This is the title of a game show from BoJack");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(session, " Horseman hosted by the character Mr. Peanutbutter.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will not schedule another indexing job if document title is updated after creation", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    const {getCount: getUpdateTitleDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    await document.update(session, [
        new ReplaceStep(
            9,
            9,
            new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("d (test)")), 0, 0),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will schedule another indexing job if document title is updated after content update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    const {getCount: getUpdateTitleDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.update(session, [
        new ReplaceStep(
            9,
            9,
            new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("d (test)")), 0, 0),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(2);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will not schedule another indexing job if document title is updated twice after content update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const document = await TestDocument.create(session, {
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    const {getCount: getUpdateTitleDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Document:${document.id}:Title`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.type(
        session,
        " This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    await document.update(session, [
        new ReplaceStep(
            9,
            9,
            new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("d (test)")), 0, 0),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await document.update(session, [
        new ReplaceStep(
            9,
            9,
            new Slice(Fragment.from(DocumentContentProsemirrorSchema.text("oooooo")), 0, 0),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateTitleDependentEntitiesCount()).toEqual(2);
    expect(await getIndexedSearchEntity(document)).toEqual({
        title: "Hollywooooooood (test) Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out. This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});
