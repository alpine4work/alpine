import {CalendarDate} from "@internationalized/date";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {getSearchEntity} from "~/server/search/data/index/internal/get_search_entity.js";
import {
    getSearchEntityIndexesForTest,
    getSearchEntityWithStrongConsistency,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityDependentsJobTestCounter,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    refreshSearchEntityKeywordIndexForTest,
    searchByKeywords,
    searchTaskCollectionsByAffinity,
    searchTaskCollectionsByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    runAllObjectPromises,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, ContentEditorClientId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SearchDynamicEntityId, SearchEntityId} from "~/shared/search/search_entity_id.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

let indexSearchEntityJobCount = 0;

beforeEach(() => {
    indexSearchEntityJobCount = 0;
});

const context = TestTaskRealtimeServer.with(
    createTestContext({
        shouldStartOpensearch: true,
        searchInjection,
        tasksInjection,
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
    }),
);

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

function getIndexedSearchEntity(entity: TestTask) {
    const context = entity.context;
    const spaceId = entity.space.id;
    const entityId: SearchEntityId = `Task:${entity.id}`;

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

test("fallback search entity loads deleted tasks and collections without titles", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {title: "Deleted fallback task"});
    const collection = await TestTaskCollection.create(session, {
        name: "Deleted fallback collection",
    });

    await runAllPromises([task.delete(session), collection.delete(session)]);
    await context.getTaskRealtimeServer().wait();

    const actionContext = context.getTaskRealtimeServer().action(session);

    expect(
        await runAllObjectPromises({
            task: getSearchEntityWithStrongConsistency(actionContext, space.id, `Task:${task.id}`),
            collection: getSearchEntityWithStrongConsistency(
                actionContext,
                space.id,
                `TaskCollection:${collection.id}`,
            ),
        }),
    ).toMatchObject({
        task: {
            isPrivate: false,
            type: "Task",
            title: null,
            task: {id: task.id, title: null},
        },
        collection: {
            isPrivate: false,
            type: "TaskCollection",
            title: null,
            collection: {id: collection.id, titleVersion: expect.any(Object)},
        },
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();
});

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

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
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

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let\u2019s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
    });

    import.meta.jest.runAllTimers();

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

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let\u2019s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
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

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know?");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session, " Do They Know Things? Let\u2019s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("will schedule another indexing job if task assignee is updated after creation", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    expect(indexSearchEntityJobCount).toEqual(0);

    const task = await TestTask.create(session1, {
        title: "Hollywoo Stars and Celebrities",
    });

    const {getCount: getUpdateAuthorizationDependentEntitiesCount} =
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Task:${task.id}:Authorization`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
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

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
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
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Task:${task.id}:Authorization`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(
        session1,
        ": What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
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
        processIndexSearchEntityDependentsJobTestCounter.recordForTest(
            `Task:${task.id}:Authorization`,
        );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(
        session1,
        ": What Do They Know? Do They Know Things? Let\u2019s Find Out.",
    );

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(2.5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await task.updateAssignee(session1, session3);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(2.5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: null,
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test(
    "tasks update their access policies appropriately after indexing",
    async () => {
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
            TestTask.create(session1, {title: "test"}),
            TestTask.create(session1, {title: "test foobar"}),
            TestTask.create(session1, {title: "test"}),
            TestTask.create(session1, {title: "test"}),
            TestTask.create(session1, {title: "test"}),
            TestTaskCollection.create(session1, {name: "test"}),
            TestTaskCollection.create(session1, {name: "test buzqux"}),
            TestTaskCollection.create(session1, {name: "test"}),
        ]);

        await runAllPromises([
            publicCollection.access.grantDefault(session1),
            sharedCollection.access.grant(session1, session3),
            parentTask2a.addCollection(session1, privateCollection),
            parentTask2b.addCollection(session1, publicCollection),
            parentTask2c.addCollection(session1, sharedCollection),
            task.updateParentTask(session1, parentTask1),
            parentTask1.updateParentTask(session1, parentTask2a),
        ]);

        import.meta.jest.advanceTimersByTime(10 * 1000);
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

        import.meta.jest.advanceTimersByTime(10 * 1000);
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

        import.meta.jest.advanceTimersByTime(10 * 1000);
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

        await sharedCollection.access.grantDefault(session1);

        import.meta.jest.advanceTimersByTime(10 * 1000);
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

        import.meta.jest.advanceTimersByTime(10 * 1000);
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

        await sharedCollection.access.revokeDefault(session1);

        import.meta.jest.advanceTimersByTime(10 * 1000);
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

        import.meta.jest.advanceTimersByTime(10 * 1000);
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
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `Task:${parentTask1.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `Task:${parentTask1.id}`,
            routing: space.id,
            version: expect.any(Object),
            fields: {
                title: ["test foobar"],
            },
        });

        await parentTask1.delete(session1);

        import.meta.jest.advanceTimersByTime(10 * 1000);
        await ProcessContextModule.waitForTestTasks();

        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `Task:${parentTask1.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `Task:${parentTask1.id}`,
            routing: space.id,
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

        import.meta.jest.advanceTimersByTime(10 * 1000);
        await ProcessContextModule.waitForTestTasks();

        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `Task:${parentTask1.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `Task:${parentTask1.id}`,
            routing: space.id,
            version: expect.any(Object),
            fields: {
                title: ["test foobar"],
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
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `TaskCollection:${publicCollection.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `TaskCollection:${publicCollection.id}`,
            routing: space.id,
            version: expect.any(Object),
            fields: {
                title: ["test buzqux"],
            },
        });

        await publicCollection.delete(session1);

        import.meta.jest.advanceTimersByTime(10 * 1000);
        await ProcessContextModule.waitForTestTasks();

        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `TaskCollection:${publicCollection.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `TaskCollection:${publicCollection.id}`,
            routing: space.id,
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

        expect(await getSearchEntityIds(session3)).toEqual([
            `TaskCollection:${sharedCollection.id}`,
        ]);

        await parentTask1.updateAssignee(session1, session3);

        import.meta.jest.advanceTimersByTime(10 * 1000);
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
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `TaskCollection:${publicCollection.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `TaskCollection:${publicCollection.id}`,
            routing: space.id,
            version: expect.any(Object),
            fields: {},
        });

        await publicCollection.undelete(session1);

        import.meta.jest.advanceTimersByTime(10 * 1000);
        await ProcessContextModule.waitForTestTasks();

        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                `TaskCollection:${publicCollection.id}`,
                {storedFields: ["title"]},
            ),
        ).toEqual({
            id: `TaskCollection:${publicCollection.id}`,
            routing: space.id,
            version: expect.any(Object),
            fields: {
                title: ["test buzqux"],
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
    },
    // This test has a lot going on. Give it a long timeout.
    45 * 1000,
);

test("tasks with a local default grant are visible in search to everyone in the space", async () => {
    const space = await TestSpace.create(context);
    const creatorSession = await space.createSession();
    const otherSession = await space.createSession();

    const task = await TestTask.create(creatorSession, {
        title: "Local Default Grant Search Visibility",
    });

    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const getTaskSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);

        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "Local Default Grant Search Visibility",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results.map(result => result.id).filter(resultId => resultId.startsWith("Task:"));
    };

    // Without a task-local default grant, only explicitly granted accounts can see the
    // task in search.
    expect(await getTaskSearchEntityIds(creatorSession)).toEqual([`Task:${task.id}`]);
    expect(await getTaskSearchEntityIds(otherSession)).toEqual([]);

    await task.access.grantDefault(creatorSession, "View");

    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchEntityIds(creatorSession)).toEqual([`Task:${task.id}`]);
    expect(await getTaskSearchEntityIds(otherSession)).toEqual([`Task:${task.id}`]);
});

test("will not allow users to view task comments they do not have access to", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const [privateTask, publicTask, privateCollection, publicCollection] = await runAllPromises([
        TestTask.create(creatorSession, {title: "test1"}),
        TestTask.create(creatorSession, {title: "test2"}),
        TestTaskCollection.create(creatorSession, {name: "private test session1"}),
        TestTaskCollection.create(creatorSession, {name: "public test session1"}),
    ]);

    await runAllPromises([
        publicCollection.access.grantDefault(creatorSession),
        privateTask.addCollection(creatorSession, privateCollection),
        publicTask.addCollection(creatorSession, publicCollection),
        privateTask.createComment(creatorSession, "task comment1"),
        publicTask.createComment(creatorSession, "task comment2"),
    ]);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await privateTask.updateAssignee(creatorSession, assigneeSession);

    await privateCollection.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    const taskSearchEntityIdOrder: Array<SearchEntityId> = [
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ];

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);

        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "task comment",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:"))
            .sort(
                (id1, id2) =>
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id1)) -
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id2)),
            );
    };

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(creatorSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(viewerSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(unauthorizedSession)).toEqual([
        `Task:${publicTask.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(editorSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(commenterSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(manageSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(assigneeSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);
});

test("will not allow users to view task comments they do not have access to after switching access", async () => {
    const space = await TestSpace.create(context);

    const [viewerSession, commenterSession, creatorSession] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const [privateTask, publicTask, privateCollection, publicCollection] = await runAllPromises([
        TestTask.create(creatorSession, {title: "test1"}),
        TestTask.create(creatorSession, {title: "test2"}),
        TestTaskCollection.create(creatorSession, {name: "private test session1"}),
        TestTaskCollection.create(creatorSession, {name: "public test session1"}),
    ]);

    await runAllPromises([
        publicCollection.access.grantDefault(creatorSession),
        privateTask.addCollection(creatorSession, privateCollection),
        publicTask.addCollection(creatorSession, publicCollection),
        privateTask.createComment(creatorSession, "task comment1"),
        publicTask.createComment(creatorSession, "task comment2"),
    ]);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const taskSearchEntityIdOrder: Array<SearchEntityId> = [
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ];

    await privateCollection.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);
        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "task comment",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:"))
            .sort(
                (id1, id2) =>
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id1)) -
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id2)),
            );
    };

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(commenterSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(viewerSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    await privateCollection.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [commenterSession.account.id, {level: "View"}],
            [viewerSession.account.id, {level: "Comment"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(viewerSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    expect(await getSearchEntityIds(commenterSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${publicTask.id}-0`,
    ]);
});

test("will not allow users to view task comments they do not have access to when collection is set from defaultGrant", async () => {
    const space = await TestSpace.create(context);

    const [viewerSession, creatorSession] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [privateTask, publicTask, privateCollection, publicCollection] = await runAllPromises([
        TestTask.create(creatorSession, {title: "test1"}),
        TestTask.create(creatorSession, {title: "test2"}),
        TestTaskCollection.create(creatorSession, {name: "private test session1"}),
        TestTaskCollection.create(creatorSession, {name: "public test session1"}),
    ]);

    await runAllPromises([
        publicCollection.access.grantDefault(creatorSession),
        privateTask.addCollection(creatorSession, privateCollection),
        publicTask.addCollection(creatorSession, publicCollection),
        privateTask.createComment(creatorSession, "task comment1"),
        publicTask.createComment(creatorSession, "task comment2"),
    ]);

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const taskSearchEntityIdOrder: Array<SearchEntityId> = [
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ];

    await privateCollection.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
        ]),
        defaultGrant: {level: "View"},
        urlGrant: null,
    });

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);
        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "task comment",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .map(result => result.id)
            .filter(resultId => !resultId.startsWith("Account:"))
            .sort(
                (id1, id2) =>
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id1)) -
                    assertExists(taskSearchEntityIdOrder.findIndex(id => id === id2)),
            );
    };

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(viewerSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    await privateCollection.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
        ]),
        defaultGrant: {level: "Comment"},
        urlGrant: null,
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(viewerSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ]);
});

test("task comment search access policies exclude task view grants", async () => {
    const space = await TestSpace.create(context);
    const [
        creatorSession,
        viewerSession,
        commenterSession,
        editorSession,
        managerSession,
        otherSession,
    ] = await space.createSessions(6);

    const getCommentAccountGrantById = () =>
        new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [commenterSession.account.id, {level: "Comment"}],
            [editorSession.account.id, {level: "Edit"}],
            [managerSession.account.id, {level: "Manage", generation: 1}],
        ]);

    const defaultGrantTask = await TestTask.create(creatorSession, {
        title: "Default Grant Task",
    });
    await defaultGrantTask.access.set(creatorSession, {
        type: "Local",
        accountGrantById: getCommentAccountGrantById(),
        defaultGrant: {level: "View"},
        urlGrant: null,
    });
    const defaultGrantComment = await defaultGrantTask.createComment(
        creatorSession,
        "taskdefaultonlyalpha",
    );
    const defaultGrantCommentEntityId: SearchEntityId = `TaskComment:${defaultGrantTask.id}-${defaultGrantComment.index}`;

    const accountGrantTask = await TestTask.create(creatorSession, {
        title: "Account Grant Task",
    });
    await accountGrantTask.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            ...getCommentAccountGrantById(),
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });
    const accountGrantComment = await accountGrantTask.createComment(
        creatorSession,
        "taskaccountonlybeta",
    );
    const accountGrantCommentEntityId: SearchEntityId = `TaskComment:${accountGrantTask.id}-${accountGrantComment.index}`;

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const getCommentSearchEntityIds = async (
        session: TestSpaceSession,
        queryText: string,
    ): Promise<ReadonlyArray<SearchEntityId>> => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);

        const results = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText,
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });

        return results
            .map(result => result.id)
            .filter(resultId => resultId.startsWith("TaskComment:"))
            .sort();
    };

    const getCommentVisibilityBySession = async (queryText: string) =>
        await runAllObjectPromises({
            creator: getCommentSearchEntityIds(creatorSession, queryText),
            viewer: getCommentSearchEntityIds(viewerSession, queryText),
            commenter: getCommentSearchEntityIds(commenterSession, queryText),
            editor: getCommentSearchEntityIds(editorSession, queryText),
            manager: getCommentSearchEntityIds(managerSession, queryText),
            other: getCommentSearchEntityIds(otherSession, queryText),
        });

    expect(await getCommentVisibilityBySession("taskdefaultonlyalpha")).toEqual({
        creator: [defaultGrantCommentEntityId],
        viewer: [],
        commenter: [defaultGrantCommentEntityId],
        editor: [defaultGrantCommentEntityId],
        manager: [defaultGrantCommentEntityId],
        other: [],
    });
    expect(await getCommentVisibilityBySession("taskaccountonlybeta")).toEqual({
        creator: [accountGrantCommentEntityId],
        viewer: [],
        commenter: [accountGrantCommentEntityId],
        editor: [accountGrantCommentEntityId],
        manager: [accountGrantCommentEntityId],
        other: [],
    });

    const expectedCommentAccessPolicy = {
        accountGrantAccountIds: new Set([
            creatorSession.account.id,
            commenterSession.account.id,
            editorSession.account.id,
            managerSession.account.id,
        ]),
        defaultGrantType: null,
        urlGrantLevel: null,
    };

    expect(
        await getIndexedSearchEntityAccessPolicy(context, space.id, defaultGrantCommentEntityId),
    ).toEqual(expectedCommentAccessPolicy);
    expect(
        await getIndexedSearchEntityAccessPolicy(context, space.id, accountGrantCommentEntityId),
    ).toEqual(expectedCommentAccessPolicy);

    import.meta.jest.clearAllTimers();

    async function getIndexedSearchEntityAccessPolicy(
        context: TestContext,
        spaceId: SpaceId,
        entityId: Exclude<SearchDynamicEntityId, `Account:${AccountId}`>,
    ) {
        const docForKeywordIndex = await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            spaceId,
            entityId,
            {
                storedFields: [
                    "accessPolicy.accountGrantAccountIds",
                    "accessPolicy.defaultGrantType",
                    "accessPolicy.urlGrantLevel",
                ],
            },
        );

        if (!docForKeywordIndex) return null;

        return {
            accountGrantAccountIds: new Set(
                docForKeywordIndex.fields["accessPolicy.accountGrantAccountIds"] ?? [],
            ),
            defaultGrantType:
                docForKeywordIndex.fields["accessPolicy.defaultGrantType"]?.[0] ?? null,
            urlGrantLevel: docForKeywordIndex.fields["accessPolicy.urlGrantLevel"]?.[0] ?? null,
        };
    }
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

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [
            new ReplaceStep(
                1,
                1,
                new Slice(
                    Fragment.from([
                        TaskNotesContentProsemirrorSchema.text(
                            "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId<ContentEditorClientId>(),
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: "What Do They Know? Do They Know Things? Let\u2019s Find Out.",
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

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [
            new ReplaceStep(
                1,
                1,
                new Slice(
                    Fragment.from([
                        TaskNotesContentProsemirrorSchema.text(
                            "This is the title of a game show from BoJack",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId<ContentEditorClientId>(),
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let\u2019s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: "This is the title of a game show from BoJack",
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 1,
        clientSteps: [
            new ReplaceStep(
                45,
                45,
                new Slice(
                    Fragment.from([
                        TaskNotesContentProsemirrorSchema.text(
                            " Horseman hosted by the character Mr. Peanutbutter.",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId<ContentEditorClientId>(),
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: "This is the title of a game show from BoJack",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: "This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
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

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [
            new ReplaceStep(
                1,
                1,
                new Slice(
                    Fragment.from([
                        TaskNotesContentProsemirrorSchema.text(
                            "This is the title of a game show from BoJack",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId<ContentEditorClientId>(),
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let\u2019s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(2.5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 1,
        clientSteps: [
            new ReplaceStep(
                45,
                45,
                new Slice(
                    Fragment.from([
                        TaskNotesContentProsemirrorSchema.text(
                            " Horseman hosted by the character Mr. Peanutbutter.",
                        ),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId<ContentEditorClientId>(),
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    import.meta.jest.advanceTimersByTime(2.5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: "This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    import.meta.jest.advanceTimersByTime(5 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let\u2019s Find Out.",
        body: "This is the title of a game show from BoJack Horseman hosted by the character Mr. Peanutbutter.",
    });

    // Make sure there are no more jobs in the queue.
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("can get affinitive collections for an account", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {
                spaceId: space.id,
                limit: 100,
            })
        ).map(({collection}) => collection.id),
    ).toEqual([]);

    const [collection1, collection2, collection3, collection4, collection5, collection6] =
        await runAllPromises([
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
        ]);

    await runAllPromises([
        collection3.access.grantDefault(session1),
        collection5.access.grantDefault(session2),
        collection6.access.grantDefault(session2),
    ]);

    for (let i = 0; i < 1; i++) {
        await markSearchAffinityEntityInteraction(session1.action(), {
            spaceId: space.id,
            entityId: `TaskCollection:${collection1.id}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        });
    }

    for (let i = 0; i < 3; i++) {
        await markSearchAffinityEntityInteraction(session1.action(), {
            spaceId: space.id,
            entityId: `TaskCollection:${collection2.id}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        });
    }

    for (let i = 0; i < 2; i++) {
        await markSearchAffinityEntityInteraction(session1.action(), {
            spaceId: space.id,
            entityId: `TaskCollection:${collection3.id}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        });
    }

    for (let i = 0; i < 7; i++) {
        await markSearchAffinityEntityInteraction(session1.action(), {
            spaceId: space.id,
            entityId: `TaskCollection:${collection4.id}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        });
    }

    for (let i = 0; i < 8; i++) {
        await markSearchAffinityEntityInteraction(session1.action(), {
            spaceId: space.id,
            entityId: `TaskCollection:${collection5.id}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        });
    }

    for (let i = 0; i < 9; i++) {
        await markSearchAffinityEntityInteraction(session1.action(), {
            spaceId: space.id,
            entityId: `TaskCollection:${collection6.id}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        });
    }

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {spaceId: space.id, limit: 3})
        ).map(({collection}) => collection.id),
    ).toEqual([collection6.id, collection5.id]);

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {
                spaceId: space.id,
                limit: 100,
            })
        ).map(({collection}) => collection.id),
    ).toEqual([collection6.id, collection5.id, collection2.id, collection3.id, collection1.id]);

    await collection5.access.revokeDefault(session2);

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {spaceId: space.id, limit: 3})
        ).map(({collection}) => collection.id),
    ).toEqual([collection6.id]);

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {
                spaceId: space.id,
                limit: 100,
            })
        ).map(({collection}) => collection.id),
    ).toEqual([collection6.id, collection2.id, collection3.id, collection1.id]);

    await collection4.access.grantDefault(session2);

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {spaceId: space.id, limit: 3})
        ).map(({collection}) => collection.id),
    ).toEqual([collection6.id, collection4.id]);

    expect(
        (
            await searchTaskCollectionsByAffinity(session1.action(), {
                spaceId: space.id,
                limit: 100,
            })
        ).map(({collection}) => collection.id),
    ).toEqual([collection6.id, collection4.id, collection2.id, collection3.id, collection1.id]);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("effective task collection name fuzzy searching", async () => {
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

    for (const bookName of bookNames) {
        const collection = await TestTaskCollection.create(session, {name: bookName});
        await collection.access.grantDefault(session);
        await ProcessContextModule.waitForTestTasks();
        import.meta.jest.advanceTimersByTime(1000);
    }

    await ProcessContextModule.waitForTestTasks();
    await refreshSearchEntityKeywordIndexForTest(context);

    const testSearch = async (queryText: string) => {
        const results = await searchTaskCollectionsByKeywords(session.action(), {
            spaceId: space.id,
            queryText,
            limit: 100,
        });

        return results.map(({collection}) => collection.getName());
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
        "The Code of the Wooster",
        "The Preservationist",
        "The Silmarillion",
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
    expect(await testSearch("thank jeeves")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves thank")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves thank you")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);
    expect(await testSearch("jeeves you thank")).toEqual(["Thank You Jeeves", "Right Ho Jeeves"]);

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
        "The Code of the Wooster",
        "The Silmarillion",
        "The Grand Design",
        "The Lost Symbol",
        "The DaVinci Code",
        "The Lock Artist",
        "The Book of Samson",
        "The Book of Lies",
    ]);
    expect(await testSearch("the preserv")).toEqual([
        "The Preservationist",
        "The Code of the Wooster",
        "The Silmarillion",
        "The Grand Design",
        "The Lost Symbol",
        "The DaVinci Code",
        "The Lock Artist",
        "The Book of Samson",
        "The Book of Lies",
    ]);
    expect(await testSearch("the dav")).toEqual([
        "The DaVinci Code",
        "The Code of the Wooster",
        "The Preservationist",
        "The Silmarillion",
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
}, 20_000);

test("excludes collections account doesn\u2019t have access to when searching", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    await TestTaskCollection.create(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    await TestTaskCollection.create(session2);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    await TestTaskCollection.create(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    await TestTaskCollection.create(session2);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection5 = await TestTaskCollection.create(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection6 = await TestTaskCollection.create(session2);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection7 = await TestTaskCollection.create(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection8 = await TestTaskCollection.create(session2);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection9 = await TestTaskCollection.create(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection10 = await TestTaskCollection.create(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);
    const collection11 = await TestTaskCollection.create(otherSession);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000);

    await runAllPromises([
        collection5.access.set(session1, {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session3.account.id, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        }),
        collection6.access.set(session2, {
            type: "Local",
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage", generation: 0}],
                [session3.account.id, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        }),
        collection9.access.grantDefault(session1),
        collection10.access.grantDefault(session1),
        collection11.access.grantDefault(otherSession),
    ]);

    await collection10.delete(session1);

    await ProcessContextModule.waitForTestTasks();
    await refreshSearchEntityKeywordIndexForTest(context);

    const testSearch = async (session: TestSpaceSession, limit: number) => {
        const results = await searchTaskCollectionsByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "test",
            limit,
        });

        return results.map(({collection}) => collection.id);
    };

    expect(await testSearch(session1, 3)).toEqual([collection9.id, collection7.id, collection5.id]);
    expect(await testSearch(session2, 3)).toEqual([collection9.id, collection8.id, collection6.id]);
    expect(await testSearch(session3, 3)).toEqual([collection9.id, collection6.id, collection5.id]);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

// Tests that would be in `get_search_entity.test.ts` except we don't want to start
// OpenSearch in that file.
describe("getSearchEntity", () => {
    test("can get task search entity", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const privateCollection = await TestTaskCollection.create(session1, {
            name: "Private Test Task Collection",
        });
        await privateCollection.access.grant(session1, session2);

        const publicCollection = await TestTaskCollection.create(session1, {
            name: "Public Test Task Collection",
        });
        await publicCollection.access.grantDefault(session1);

        const task1 = await TestTask.create(session2, {title: "Test Task 1"});

        const parentTask = await TestTask.create(session2);
        await task1.updateParentTask(session2, parentTask);

        await parentTask.addCollection(session2, privateCollection);

        const task2 = await TestTask.create(session3, {title: "Test Task 2"});
        await task2.addCollection(session3, publicCollection);

        const taskNotes =
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque ultricies mattis pharetra. Phasellus pulvinar vitae mauris sed sollicitudin. Vestibulum in tortor vel magna iaculis sagittis. Nunc tempor sodales velit ut posuere. Quisque venenatis bibendum risus ac consequat. Pellentesque ornare mauris nec dolor cursus imperdiet. Sed finibus pellentesque mauris ut dapibus. Duis non lorem lacus.";

        const taskNotesWords = taskNotes.split(" ");

        for (let i = 0; i < taskNotesWords.length; i++) {
            await task2.typeNotes(
                i % 6 === 0 ? session1 : i % 2 === 0 ? session3 : session2,
                `${taskNotesWords[i]!} `,
            );
        }

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task1.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `Task:${parentTask.id}:Authorization`,
                `TaskCollection:${privateCollection.id}:Authorization`,
            ]),
            entity: {
                id: `Task:${task1.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set([session2.account.id, session1.account.id]),
                    defaultGrantType: null,
                    urlGrantLevel: null,
                },
                createdTime: new Date(task1.createdTime[0]),
                title: "Test Task 1",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                },
                body: null,
                tags: [],
                embeddingChunks: [],
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session2.account.id,
                contributorIds: new Map([[session2.account.id, "Major"]]),
                assigneeId: null,
                dueDate: null,
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task2.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `TaskCollection:${publicCollection.id}:Authorization`,
                `TaskCollection:${publicCollection.id}:Name`,
            ]),
            entity: {
                id: `Task:${task2.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: new Date(task2.createdTime[0]),
                title: "Test Task 2",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                },
                body: taskNotes,
                tags: ["Public Test Task Collection"],
                embeddingChunks: [
                    {
                        preambleEndIndex: 15,
                        text: `# Test Task 2\n\n${taskNotes}`,
                        tokenCountWithoutPreamble: 143,
                    },
                ],
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session3.account.id,
                contributorIds: new Map([
                    [session3.account.id, "Major"],
                    [session2.account.id, "Major"],
                    [session1.account.id, "Minor"],
                ]),
                assigneeId: null,
                dueDate: null,
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test(
        "can get task collection search entity",
        async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const session3 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const privateCollection = await TestTaskCollection.create(session1, {
                name: "Private Test Task Collection",
            });
            await privateCollection.access.grant(session1, session2);

            const publicCollection = await TestTaskCollection.create(session3, {
                name: "Public Test Task Collection",
            });
            await publicCollection.access.grantDefault(session3);

            await publicCollection.updateColor(session3, "purple");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "TaskCollection", collectionId: privateCollection.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `TaskCollection:${privateCollection.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set([session1.account.id, session2.account.id]),
                        defaultGrantType: null,
                        urlGrantLevel: null,
                    },
                    createdTime: new Date(privateCollection.createdTime[0]),
                    title: "Private Test Task Collection",
                    titleVersion: {type: "HybridLogicalTime", time: expect.any(Array)},
                    body: null,
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 58,
                            text: "# Private Test Task Collection\n\nThis is a task collection.",
                            tokenCountWithoutPreamble: 0,
                        },
                    ],
                    media: {type: "TaskCollectionColor", color: null, version: expect.any(Array)},
                    creatorId: session1.account.id,
                    contributorIds: new Map(),
                    assigneeId: null,
                    dueDate: null,
                    activeness: null,
                    openness: null,
                    priority: null,
                },
            });

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "TaskCollection", collectionId: publicCollection.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `TaskCollection:${publicCollection.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: new Date(publicCollection.createdTime[0]),
                    title: "Public Test Task Collection",
                    titleVersion: {type: "HybridLogicalTime", time: expect.any(Array)},
                    body: null,
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 57,
                            text: "# Public Test Task Collection\n\nThis is a task collection.",
                            tokenCountWithoutPreamble: 0,
                        },
                    ],
                    media: {
                        type: "TaskCollectionColor",
                        color: "purple",
                        version: expect.any(Array),
                    },
                    creatorId: session3.account.id,
                    contributorIds: new Map(),
                    assigneeId: null,
                    dueDate: null,
                    activeness: null,
                    openness: null,
                    priority: null,
                },
            });

            import.meta.jest.runAllTimers();
            await ProcessContextModule.waitForTestTasks();
        },
        20 * 1000,
    );

    test("can get task comment search entity", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const privateCollection = await TestTaskCollection.create(session1);
        await privateCollection.access.grant(session1, session2);

        const publicCollection = await TestTaskCollection.create(session1);
        await publicCollection.access.grantDefault(session1);

        const task1 = await TestTask.create(session2, {title: "Test Task 1"});

        const parentTask = await TestTask.create(session2);
        await task1.updateParentTask(session2, parentTask);

        await parentTask.addCollection(session2, privateCollection);

        const comment1 = await task1.createComment(session1, "Test task comment content 1.");

        const task2 = await TestTask.create(session3, {title: "Test Task 2"});
        await task2.addCollection(session3, publicCollection);

        const comment2 = await task2.createComment(session2, "Test task comment content 2.");

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskComment", taskId: task1.id, commentIndex: 0},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `Task:${task1.id}:Authorization`,
                `Task:${parentTask.id}:Authorization`,
                `TaskCollection:${privateCollection.id}:Authorization`,
            ]),
            entity: {
                id: `TaskComment:${task1.id}-0`,
                accessPolicy: {
                    accountGrantAccountIds: new Set([session2.account.id, session1.account.id]),
                    defaultGrantType: null,
                    urlGrantLevel: null,
                },
                createdTime: comment1.createdTime,
                title: null,
                titleVersion: null,
                body: "Test task comment content 1.",
                tags: [],
                embeddingChunks: [
                    {
                        preambleEndIndex: 30,
                        text: "This is a comment on a task:\n\nTest task comment content 1.",
                        tokenCountWithoutPreamble: 6,
                    },
                ],
                media: {type: "Account", accountId: session1.account.id},
                creatorId: session1.account.id,
                contributorIds: new Map(),
                assigneeId: null,
                dueDate: null,
                activeness: null,
                openness: null,
                priority: null,
            },
        });

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskComment", taskId: task2.id, commentIndex: 0},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `Task:${task2.id}:Authorization`,
                `TaskCollection:${publicCollection.id}:Authorization`,
            ]),
            entity: {
                id: `TaskComment:${task2.id}-0`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: comment2.createdTime,
                title: null,
                titleVersion: null,
                body: "Test task comment content 2.",
                tags: [],
                embeddingChunks: [
                    {
                        preambleEndIndex: 30,
                        text: "This is a comment on a task:\n\nTest task comment content 2.",
                        tokenCountWithoutPreamble: 6,
                    },
                ],
                media: {type: "Account", accountId: session2.account.id},
                creatorId: session2.account.id,
                contributorIds: new Map(),
                assigneeId: null,
                dueDate: null,
                activeness: null,
                openness: null,
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get deleted task search entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const collection = await TestTaskCollection.create(session, {name: "Test Task Collection"});
        await collection.access.grantDefault(session);

        const task = await TestTask.create(session, {title: "Test Task"});
        await task.addCollection(session, collection);
        await task.typeNotes(session, "Lorem ipsum dolor sit amet");
        await task.delete(session);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([`TaskCollection:${collection.id}:Authorization`]),
            entity: {
                id: `Task:${task.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: new Date(task.createdTime[0]),
                title: null,
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                    deletedTime: expect.any(Array),
                },
                body: null,
                tags: [],
                embeddingChunks: [],
                media: null,
                creatorId: null,
                contributorIds: new Map(),
                assigneeId: null,
                dueDate: null,
                activeness: null,
                openness: null,
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get deleted task collection search entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const collection = await TestTaskCollection.create(session, {name: "Test Task Collection"});
        await collection.access.grantDefault(session);
        await collection.updateColor(session, "purple");
        await collection.delete(session);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskCollection", collectionId: collection.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set(),
            entity: {
                id: `TaskCollection:${collection.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: new Date(collection.createdTime[0]),
                title: null,
                titleVersion: {type: "HybridLogicalTime", time: expect.any(Array)},
                body: null,
                tags: [],
                embeddingChunks: [],
                media: null,
                creatorId: null,
                contributorIds: new Map(),
                assigneeId: null,
                dueDate: null,
                activeness: null,
                openness: null,
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get comment on deleted task search entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const collection = await TestTaskCollection.create(session, {name: "Test Task Collection"});
        await collection.access.grantDefault(session);

        const task = await TestTask.create(session, {title: "Test Task"});
        await task.addCollection(session, collection);
        await task.typeNotes(session, "Lorem ipsum dolor sit amet");

        const comment = await task.createComment(session, "Test Task Comment");

        await task.delete(session);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskComment", taskId: task.id, commentIndex: comment.index},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([`Task:${task.id}:Authorization`]),
            entity: {
                id: `TaskComment:${task.id}-${comment.index}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: null,
                    urlGrantLevel: null,
                },
                createdTime: null,
                title: null,
                titleVersion: null,
                body: null,
                tags: [],
                embeddingChunks: [],
                media: null,
                creatorId: null,
                contributorIds: new Map(),
                assigneeId: null,
                dueDate: null,
                activeness: null,
                openness: null,
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get task search entity with a deleted parent", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const collection = await TestTaskCollection.create(session2, {access: "Public"});

        const parentTask = await TestTask.create(session2, {title: "Test Parent Task"});
        await parentTask.addCollection(session2, collection);

        const task = await TestTask.create(session1, {title: "Test Task"});
        await task.updateParentTask(session1, parentTask);
        await task.typeNotes(session1, "Lorem ipsum dolor sit amet");

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `TaskCollection:${collection.id}:Authorization`,
                `Task:${parentTask.id}:Authorization`,
            ]),
            entity: {
                id: `Task:${task.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: new Date(task.createdTime[0]),
                title: "Test Task",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                },
                body: "Lorem ipsum dolor sit amet",
                tags: [],
                embeddingChunks: expect.any(Array),
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session1.account.id,
                contributorIds: new Map([[session1.account.id, "Major"]]),
                assigneeId: null,
                dueDate: null,
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        await parentTask.delete(session1);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `TaskCollection:${collection.id}:Authorization`,
                `Task:${parentTask.id}:Authorization`,
            ]),
            entity: {
                id: `Task:${task.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set([session1.account.id]),
                    defaultGrantType: null,
                    urlGrantLevel: null,
                },
                createdTime: new Date(task.createdTime[0]),
                title: "Test Task",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                },
                body: "Lorem ipsum dolor sit amet",
                tags: [],
                embeddingChunks: expect.any(Array),
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session1.account.id,
                contributorIds: new Map([[session1.account.id, "Major"]]),
                assigneeId: null,
                dueDate: null,
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get task search entity with a deleted collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const collection = await TestTaskCollection.create(session2, {access: "Public"});

        const task = await TestTask.create(session1, {title: "Test Task"});
        await task.addCollection(session1, collection);
        await task.typeNotes(session1, "Lorem ipsum dolor sit amet");

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `TaskCollection:${collection.id}:Authorization`,
                `TaskCollection:${collection.id}:Name`,
            ]),
            entity: {
                id: `Task:${task.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: new Date(task.createdTime[0]),
                title: "Test Task",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                },
                body: "Lorem ipsum dolor sit amet",
                tags: [collection.initialName],
                embeddingChunks: expect.any(Array),
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session1.account.id,
                contributorIds: new Map([[session1.account.id, "Major"]]),
                assigneeId: null,
                dueDate: null,
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        await collection.delete(session2);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([`TaskCollection:${collection.id}:Authorization`]),
            entity: {
                id: `Task:${task.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set([session1.account.id]),
                    defaultGrantType: null,
                    urlGrantLevel: null,
                },
                createdTime: new Date(task.createdTime[0]),
                title: "Test Task",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                },
                body: "Lorem ipsum dolor sit amet",
                tags: [],
                embeddingChunks: expect.any(Array),
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session1.account.id,
                contributorIds: new Map([[session1.account.id, "Major"]]),
                assigneeId: null,
                dueDate: null,
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test(`can get task search entity with a due date`, async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const collection = await TestTaskCollection.create(session2, {
            name: "Test Task Collection",
            access: "Public",
        });

        const task = await TestTask.create(session1, {title: "Test Task"});
        await task.addCollection(session1, collection);
        await task.typeNotes(session1, "Lorem ipsum dolor sit amet");
        await task.updateDueDate(session1, new CalendarDate(2025, 12, 31));

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task.id},
                {tokenizer, registerAdditionalWrite: noop},
            ),
        ).toEqual({
            dependencyIds: new Set([
                `TaskCollection:${collection.id}:Authorization`,
                `TaskCollection:${collection.id}:Name`,
            ]),
            entity: {
                id: `Task:${task.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set(),
                    defaultGrantType: "Space",
                    urlGrantLevel: null,
                },
                createdTime: new Date(task.createdTime[0]),
                title: "Test Task",
                titleVersion: {
                    type: "TaskTitle",
                    snapshot: expect.any(Uint8Array),
                    deletedTime: undefined,
                },
                body: "Lorem ipsum dolor sit amet",
                tags: ["Test Task Collection"],
                embeddingChunks: expect.any(Array),
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
                creatorId: session1.account.id,
                contributorIds: new Map([[session1.account.id, "Major"]]),
                assigneeId: null,
                dueDate: new CalendarDate(2025, 12, 31),
                activeness: "Inactive",
                openness: "Open",
                priority: null,
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    for (const priority of ["Low", "Medium", "High", "Urgent"] as const) {
        test(`can get task search entity with ${priority} priority`, async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const collection = await TestTaskCollection.create(session2, {
                name: "Test Task Collection",
                access: "Public",
            });

            const task = await TestTask.create(session1, {title: "Test Task", priority});
            await task.addCollection(session1, collection);
            await task.typeNotes(session1, "Lorem ipsum dolor sit amet");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Task", taskId: task.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([
                    `TaskCollection:${collection.id}:Authorization`,
                    `TaskCollection:${collection.id}:Name`,
                ]),
                entity: {
                    id: `Task:${task.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: new Date(task.createdTime[0]),
                    title: "Test Task",
                    titleVersion: {
                        type: "TaskTitle",
                        snapshot: expect.any(Uint8Array),
                    },
                    body: "Lorem ipsum dolor sit amet",
                    tags: ["Test Task Collection"],
                    embeddingChunks: expect.any(Array),
                    media: {
                        type: "TaskDisplayStatus",
                        displayStatus: "OpenInactive",
                        version: expect.any(Array),
                    },
                    creatorId: session1.account.id,
                    contributorIds: new Map([[session1.account.id, "Major"]]),
                    assigneeId: null,
                    dueDate: null,
                    activeness: "Inactive",
                    openness: "Open",
                    priority,
                },
            });

            import.meta.jest.runAllTimers();
            await ProcessContextModule.waitForTestTasks();
        });
    }

    for (const {status, mediaDisplayStatus} of [
        {status: "Open", mediaDisplayStatus: "OpenInactive"},
        {status: "Closed", mediaDisplayStatus: "Closed"},
    ] as const) {
        test(`can get task search entity with ${status} status`, async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const collection = await TestTaskCollection.create(session2, {
                name: "Test Task Collection",
                access: "Public",
            });

            const task = await TestTask.create(session1, {title: "Test Task"});
            await task.addCollection(session1, collection);
            await task.typeNotes(session1, "Lorem ipsum dolor sit amet");
            await task.updateStatus(session1, status);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Task", taskId: task.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([
                    `TaskCollection:${collection.id}:Authorization`,
                    `TaskCollection:${collection.id}:Name`,
                ]),
                entity: {
                    id: `Task:${task.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: new Date(task.createdTime[0]),
                    title: "Test Task",
                    titleVersion: {
                        type: "TaskTitle",
                        snapshot: expect.any(Uint8Array),
                    },
                    body: "Lorem ipsum dolor sit amet",
                    tags: ["Test Task Collection"],
                    embeddingChunks: expect.any(Array),
                    media: {
                        type: "TaskDisplayStatus",
                        displayStatus: mediaDisplayStatus,
                        version: expect.any(Array),
                    },
                    creatorId: session1.account.id,
                    contributorIds: new Map([[session1.account.id, "Major"]]),
                    assigneeId: null,
                    dueDate: null,
                    activeness: "Inactive",
                    openness: status,
                    priority: null,
                },
            });

            import.meta.jest.runAllTimers();
            await ProcessContextModule.waitForTestTasks();
        });
    }

    for (const {assigneeStatus, mediaDisplayStatus} of [
        {assigneeStatus: "Active", mediaDisplayStatus: "OpenActive"},
        {assigneeStatus: "Inactive", mediaDisplayStatus: "OpenInactive"},
    ] as const) {
        test(`can get task search entity with ${assigneeStatus} assignee status`, async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const collection = await TestTaskCollection.create(session2, {
                name: "Test Task Collection",
                access: "Public",
            });

            const task = await TestTask.create(session1, {title: "Test Task"});
            await task.addCollection(session1, collection);
            await task.typeNotes(session1, "Lorem ipsum dolor sit amet");
            await task.updateAssignee(session1, session1.account, {assigneeStatus});

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Task", taskId: task.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([
                    `TaskCollection:${collection.id}:Authorization`,
                    `TaskCollection:${collection.id}:Name`,
                ]),
                entity: {
                    id: `Task:${task.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: new Date(task.createdTime[0]),
                    title: "Test Task",
                    titleVersion: {
                        type: "TaskTitle",
                        snapshot: expect.any(Uint8Array),
                    },
                    body: "Lorem ipsum dolor sit amet",
                    tags: ["Test Task Collection"],
                    embeddingChunks: expect.any(Array),
                    media: {
                        type: "TaskDisplayStatus",
                        displayStatus: mediaDisplayStatus,
                        version: expect.any(Array),
                    },
                    creatorId: session1.account.id,
                    contributorIds: new Map([[session1.account.id, "Major"]]),
                    assigneeId: session1.account.id,
                    dueDate: null,
                    activeness: assigneeStatus,
                    openness: "Open",
                    priority: null,
                },
            });

            import.meta.jest.runAllTimers();
            await ProcessContextModule.waitForTestTasks();
        });
    }
});

test("keyword search matches tasks by collection name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    // Create a collection with a unique name that won't appear in task content.
    const collection = await TestTaskCollection.create(session, {
        name: "Banana Smoothie Project",
    });
    await collection.access.grantDefault(session);

    // Create a task with content that does NOT contain the collection name.
    const task = await TestTask.create(session, {title: "Apple Pie Recipe"});
    await task.typeNotes(session, "Mix flour, sugar, and apples together.");
    await task.addCollection(session, collection);

    // Wait for indexing to complete.
    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Search for the collection name - the task should be found.
    const results = await searchByKeywords(session.action(), {
        spaceId: space.id,
        queryText: "banana",
        limit: 100,
        timeZone: defaultTimeZone,
        currentTime: new Date(),
    });

    // Verify the task appears in results when searching for collection name.
    const taskResult = results.find(result => result.id === `Task:${task.id}`);
    expect(taskResult).toBeDefined();

    // Verify the collection name does NOT appear in the snippet (invisible matching).
    // The snippet should only contain task content, not collection names.
    expect(taskResult!.bodyTextSnippet).toEqual([
        {text: "Mix flour, sugar, and apples together.", isHighlighted: false},
    ]);

    // Also verify the collection itself appears in results.
    const collectionResult = results.find(
        result => result.id === `TaskCollection:${collection.id}`,
    );
    expect(collectionResult).toBeDefined();

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("re-indexes task tags when collection name changes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    // Create a collection with an initial name.
    const collection = await TestTaskCollection.create(session, {
        name: "Original Project Name",
    });
    await collection.access.grantDefault(session);

    // Create a task in the collection.
    const task = await TestTask.create(session, {title: "Test Task"});
    await task.addCollection(session, collection);

    // Wait for initial indexing.
    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    {
        const resultsForOldName = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "original",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });
        // Task SHOULD be found by old collection name.
        expect(resultsForOldName.find(r => r.id === `Task:${task.id}`)).toBeDefined();

        const resultsForNewName = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "updated",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });
        // Task should NOT be found by new collection name.
        expect(resultsForNewName.find(r => r.id === `Task:${task.id}`)).toBeUndefined();
    }

    // Update the collection name.
    await collection.updateName(session, "Updated Project Name");

    // Wait for re-indexing triggered by the name change dependency.
    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    {
        const resultsForOldName = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "original",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });
        // Task should NOT be found by old collection name.
        expect(resultsForOldName.find(r => r.id === `Task:${task.id}`)).toBeUndefined();

        const resultsForNewName = await searchByKeywords(session.action(), {
            spaceId: space.id,
            queryText: "updated",
            limit: 100,
            timeZone: defaultTimeZone,
            currentTime: new Date(),
        });
        // Task SHOULD be found by new collection name.
        expect(resultsForNewName.find(r => r.id === `Task:${task.id}`)).toBeDefined();
    }

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});
