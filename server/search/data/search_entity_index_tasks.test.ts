import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {OpensearchGetDocWithoutSourceCommand} from "~/server/opensearch/opensearch_client.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {SearchEntityId} from "~/server/search/core/search_entity_id.js";
import {SearchEntityIndexDefaultGrantTypeIntegerMapping} from "~/server/search/data/internal/search_entity_index_doc.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    processSearchEntityJobUpdateDependentEntitiesTestCounter,
} from "~/server/search/data/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {updateTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

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

function getIndexedSearchEntity(entity: TestTask) {
    const context = entity.context;
    const spaceId = entity.space.id;
    const entityId: SearchEntityId = `Task:${entity.id}`;

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
    const [docForKeywordIndex, docForSemanticIndex] =
        await context.opensearch.client.multiGetDocsIfExist(context.tracer.getTracer(), [
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

test("will index a task after a timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will only index a task once if update happened within the timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.updateTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will index a task again if update happened after timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will index a task again if update happened after timeout with more updates after first timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateTitle(session, ": What Do They Know?");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateTitle(session, " Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will not schedule another indexing job if task title is updated after creation", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session1, {
        title: "Hollywoo Stars and Celebrities",
    });

    const {getCount: getUpdateAuthorizationDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Task:${task.id}:Authorization`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will schedule another indexing job if task authorization is updated after content update", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session1, {
        title: "Hollywoo Stars and Celebrities",
    });

    const {getCount: getUpdateAuthorizationDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Task:${task.id}:Authorization`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateTitle(session1, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will not schedule another indexing job if task authorization is updated twice after content update", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session1, {
        title: "Hollywoo Stars and Celebrities",
    });

    const {getCount: getUpdateAuthorizationDependentEntitiesCount} =
        processSearchEntityJobUpdateDependentEntitiesTestCounter.recordForTest(
            `Task:${task.id}:Authorization`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateTitle(session1, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await task.updateAssignee(session1, session3);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("tasks update their access policies appropriately after indexing", async () => {
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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    await parentTask1.updateAssignee(session1, session3);

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    expect(await getSearchEntityIds(session3)).toEqual([
        `Task:${task.id}`,
        `Task:${parentTask1.id}`,
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
        fields: {},
    });

    await publicCollection.undelete(session1);

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

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

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will not index a task twice if notes update happened within the timeout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 0,
        steps: [
            new ReplaceStep(
                1,
                1,
                new Slice(
                    new Fragment([
                        TaskNotesContentProsemirrorSchema.text(
                            "What Do They Know? Do They Know Things? Let’s Find Out.",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let’s Find Out.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will index a task twice if a notes update happens after last indexing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 0,
        steps: [
            new ReplaceStep(
                1,
                1,
                new Slice(
                    new Fragment([
                        TaskNotesContentProsemirrorSchema.text(
                            "This is the title of a game show from BoJack",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.updateTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "This is the title of a game show from BoJack",
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 1,
        steps: [
            new ReplaceStep(
                45,
                45,
                new Slice(
                    new Fragment([
                        TaskNotesContentProsemirrorSchema.text(
                            " Horseman hosted by the character Mr. Peanutbutter.",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "This is the title of a game show from BoJack",
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "This is the title of a game show from BoJack",
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will not index a task twice if multiple notes updates and task updates happen near each other", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session, {
        title: "Hollywoo Stars and Celebrities",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 0,
        steps: [
            new ReplaceStep(
                1,
                1,
                new Slice(
                    new Fragment([
                        TaskNotesContentProsemirrorSchema.text(
                            "This is the title of a game show from BoJack",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.updateTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 1,
        steps: [
            new ReplaceStep(
                45,
                45,
                new Slice(
                    new Fragment([
                        TaskNotesContentProsemirrorSchema.text(
                            " Horseman hosted by the character Mr. Peanutbutter.",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: "This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});
