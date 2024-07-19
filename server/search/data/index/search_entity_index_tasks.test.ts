import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {OpensearchGetDocWithoutSourceCommand} from "~/server/opensearch/opensearch_client.js";
import {getSearchEntity} from "~/server/search/data/index/internal/get_search_entity.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    processSearchEntityJobUpdateDependentEntitiesTestCounter,
    searchByKeywords,
    searchTaskCollectionsByAffinity,
} from "~/server/search/data/index/search_entity_index.js";
import {markSearchAffinityInteraction} from "~/server/search/data/table/search_entity_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {createTaskComment, updateTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {TaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
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
                if (job.update.type !== "Account") {
                    indexSearchEntityJobCount++;
                }

                await processIndexSearchEntityJob(actionContext, job, jobStartTime);
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

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
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

    import.meta.jest.advanceTimersByTime(60 * 1000);
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

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session, " Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
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
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
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
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session1, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
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

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
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
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    await task.typeTitle(session1, ": What Do They Know? Do They Know Things? Let’s Find Out.");

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(1);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(30 * 1000);
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

    import.meta.jest.advanceTimersByTime(30 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await task.updateAssignee(session1, session3);

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(2);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
        body: null,
    });

    import.meta.jest.advanceTimersByTime(15 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(3);
    expect(getUpdateAuthorizationDependentEntitiesCount()).toEqual(1);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: "Hollywoo Stars and Celebrities: What Do They Know? Do They Know Things? Let’s Find Out.",
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
            TestTaskCollection.createPrivate(session1, {name: "test"}),
            TestTaskCollection.createPublic(session1, {name: "test buzqux"}),
            TestTaskCollection.createPrivate(session1, {
                name: "test",
                otherGrantedAccounts: [session3.account],
            }),
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
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const {results} = await searchByKeywords(session.action(), {
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

        import.meta.jest.advanceTimersByTime(60 * 1000);
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

        import.meta.jest.advanceTimersByTime(60 * 1000);
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

        import.meta.jest.advanceTimersByTime(60 * 1000);
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

        import.meta.jest.advanceTimersByTime(60 * 1000);
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
        TestTaskCollection.createPrivate(creatorSession, {name: "private test session1"}),
        TestTaskCollection.createPublic(creatorSession, {name: "public test session1"}),
    ]);

    const privateTaskCommentDetails = {
        taskId: privateTask.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("task comment1"),
    };

    const publicTaskCommentDetails = {
        taskId: publicTask.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("task comment2"),
    };

    await runAllPromises([
        privateTask.addCollection(creatorSession, privateCollection),
        publicTask.addCollection(creatorSession, publicCollection),
        createTaskComment(context.action(creatorSession), privateTaskCommentDetails),
        createTaskComment(context.action(creatorSession), publicTaskCommentDetails),
    ]);

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    await privateTask.updateAssignee(creatorSession, assigneeSession);

    await privateCollection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
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

        const {results} = await searchByKeywords(session.action(), {
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

    import.meta.jest.advanceTimersByTime(60 * 1000);
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
        TestTaskCollection.createPrivate(creatorSession, {name: "private test session1"}),
        TestTaskCollection.createPublic(creatorSession, {name: "public test session1"}),
    ]);

    const privateTaskCommentDetails = {
        taskId: privateTask.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("task comment1"),
    };

    const publicTaskCommentDetails = {
        taskId: publicTask.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("task comment2"),
    };

    await runAllPromises([
        privateTask.addCollection(creatorSession, privateCollection),
        publicTask.addCollection(creatorSession, publicCollection),
        createTaskComment(context.action(creatorSession), privateTaskCommentDetails),
        createTaskComment(context.action(creatorSession), publicTaskCommentDetails),
    ]);

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const taskSearchEntityIdOrder: Array<SearchEntityId> = [
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ];

    await privateCollection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);
        const {results} = await searchByKeywords(session.action(), {
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

    import.meta.jest.advanceTimersByTime(60 * 1000);
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

    await privateCollection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [commenterSession.account.id, {level: "View"}],
            [viewerSession.account.id, {level: "Comment"}],
        ]),
        defaultGrant: null,
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
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
        TestTaskCollection.createPrivate(creatorSession, {name: "private test session1"}),
        TestTaskCollection.createPublic(creatorSession, {name: "public test session1"}),
    ]);

    const privateTaskCommentDetails = {
        taskId: privateTask.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("task comment1"),
    };

    const publicTaskCommentDetails = {
        taskId: publicTask.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("task comment2"),
    };

    await runAllPromises([
        privateTask.addCollection(creatorSession, privateCollection),
        publicTask.addCollection(creatorSession, publicCollection),
        createTaskComment(context.action(creatorSession), privateTaskCommentDetails),
        createTaskComment(context.action(creatorSession), publicTaskCommentDetails),
    ]);

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    const taskSearchEntityIdOrder: Array<SearchEntityId> = [
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${privateTask.id}-0`,
        `TaskComment:${publicTask.id}-0`,
    ];

    await privateCollection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
        ]),
        defaultGrant: {type: "Space", level: "View"},
    });

    const getSearchEntityIds = async (session: TestSpaceSession) => {
        await context.opensearch.refresh(SearchEntityKeywordIndex);
        const {results} = await searchByKeywords(session.action(), {
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

    import.meta.jest.advanceTimersByTime(60 * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(await getSearchEntityIds(viewerSession)).toEqual([
        `Task:${privateTask.id}`,
        `Task:${publicTask.id}`,
        `TaskCollection:${privateCollection.id}`,
        `TaskCollection:${publicCollection.id}`,
        `TaskComment:${publicTask.id}-0`,
    ]);

    await privateCollection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
        ]),
        defaultGrant: {type: "Space", level: "Comment"},
    });

    import.meta.jest.advanceTimersByTime(60 * 1000);
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
                    Fragment.from([
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
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

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
    });

    await ProcessContextModule.waitForTestTasks();

    expect(indexSearchEntityJobCount).toEqual(0);
    expect(await getIndexedSearchEntity(task)).toEqual({
        title: null,
        body: null,
    });

    await task.typeTitle(session, ": What Do They Know? Do They Know Things? Let’s Find Out.");

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
            TestTaskCollection.createPrivate(session1),
            TestTaskCollection.createPrivate(session1),
            TestTaskCollection.createPublic(session1),
            TestTaskCollection.createPrivate(session2),
            TestTaskCollection.createPublic(session2),
            TestTaskCollection.createPublic(session2),
        ]);

    for (let i = 0; i < 1; i++) {
        await markSearchAffinityInteraction(session1.action(), {
            spaceId: space.id,
            affinityId: `TaskCollection:${collection1.id}`,
            interaction: {type: "MediumIntentUpdate"},
        });
    }

    for (let i = 0; i < 3; i++) {
        await markSearchAffinityInteraction(session1.action(), {
            spaceId: space.id,
            affinityId: `TaskCollection:${collection2.id}`,
            interaction: {type: "MediumIntentUpdate"},
        });
    }

    for (let i = 0; i < 2; i++) {
        await markSearchAffinityInteraction(session1.action(), {
            spaceId: space.id,
            affinityId: `TaskCollection:${collection3.id}`,
            interaction: {type: "MediumIntentUpdate"},
        });
    }

    for (let i = 0; i < 7; i++) {
        await markSearchAffinityInteraction(session1.action(), {
            spaceId: space.id,
            affinityId: `TaskCollection:${collection4.id}`,
            interaction: {type: "MediumIntentUpdate"},
        });
    }

    for (let i = 0; i < 8; i++) {
        await markSearchAffinityInteraction(session1.action(), {
            spaceId: space.id,
            affinityId: `TaskCollection:${collection5.id}`,
            interaction: {type: "MediumIntentUpdate"},
        });
    }

    for (let i = 0; i < 9; i++) {
        await markSearchAffinityInteraction(session1.action(), {
            spaceId: space.id,
            affinityId: `TaskCollection:${collection6.id}`,
            interaction: {type: "MediumIntentUpdate"},
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

    await collection5.setPrivateAccessPolicy(session2);

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

    await collection4.setPublicAccessPolicy(session2);

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

// Tests that would be in `get_search_entity.test.ts` except we don't want to
// start OpenSearch in that file.
describe("getSearchEntity", () => {
    test("can get task search entity", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const privateCollection = await TestTaskCollection.createPrivate(session1, {
            otherGrantedAccounts: [session2],
        });

        const publicCollection = await TestTaskCollection.createPublic(session1);

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
                tokenizer,
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
                },
                createdTime: new Date(task1.createdTime[0]),
                title: "Test Task 1",
                body: null,
                embeddingChunks: [],
                media: null,
                creatorId: session2.account.id,
                contributorIds: new Map([[session2.account.id, "Major"]]),
            },
        });

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "Task", taskId: task2.id},
                tokenizer,
            ),
        ).toEqual({
            dependencyIds: new Set([`TaskCollection:${publicCollection.id}:Authorization`]),
            entity: {
                id: `Task:${task2.id}`,
                accessPolicy: {accountGrantAccountIds: new Set(), defaultGrantType: "Space"},
                createdTime: new Date(task2.createdTime[0]),
                title: "Test Task 2",
                body: taskNotes,
                embeddingChunks: [
                    {
                        preambleEndIndex: 15,
                        text: `# Test Task 2\n\n${taskNotes}`,
                        tokenCountWithoutPreamble: 143,
                    },
                ],
                media: null,
                creatorId: session3.account.id,
                contributorIds: new Map([
                    [session3.account.id, "Major"],
                    [session2.account.id, "Major"],
                    [session1.account.id, "Minor"],
                ]),
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get task collection search entity", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const privateCollection = await TestTaskCollection.createPrivate(session1, {
            name: "Private Test Task Collection",
            otherGrantedAccounts: [session2],
        });

        const publicCollection = await TestTaskCollection.createPublic(session3, {
            name: "Public Test Task Collection",
        });

        await publicCollection.updateColor(session3, "purple");

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskCollection", collectionId: privateCollection.id},
                tokenizer,
            ),
        ).toEqual({
            dependencyIds: new Set(),
            entity: {
                id: `TaskCollection:${privateCollection.id}`,
                accessPolicy: {
                    accountGrantAccountIds: new Set([session2.account.id, session1.account.id]),
                    defaultGrantType: null,
                },
                createdTime: new Date(privateCollection.createdTime[0]),
                title: "Private Test Task Collection",
                body: null,
                embeddingChunks: [],
                media: {type: "TaskCollectionColor", color: null},
                creatorId: session1.account.id,
                contributorIds: new Map(),
            },
        });

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskCollection", collectionId: publicCollection.id},
                tokenizer,
            ),
        ).toEqual({
            dependencyIds: new Set(),
            entity: {
                id: `TaskCollection:${publicCollection.id}`,
                accessPolicy: {accountGrantAccountIds: new Set(), defaultGrantType: "Space"},
                createdTime: new Date(publicCollection.createdTime[0]),
                title: "Public Test Task Collection",
                body: null,
                embeddingChunks: [],
                media: {type: "TaskCollectionColor", color: "purple"},
                creatorId: session3.account.id,
                contributorIds: new Map(),
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });

    test("can get task comment search entity", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const privateCollection = await TestTaskCollection.createPrivate(session1, {
            otherGrantedAccounts: [session2],
        });

        const publicCollection = await TestTaskCollection.createPublic(session1);

        const task1 = await TestTask.create(session2, {title: "Test Task 1"});

        const parentTask = await TestTask.create(session2);
        await task1.updateParentTask(session2, parentTask);

        await parentTask.addCollection(session2, privateCollection);

        const comment1 = await createTaskComment(session1.action(), {
            taskId: task1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test task comment content 1."),
        });

        const task2 = await TestTask.create(session3, {title: "Test Task 2"});
        await task2.addCollection(session3, publicCollection);

        const comment2 = await createTaskComment(session2.action(), {
            taskId: task2.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test task comment content 2."),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskComment", taskId: task1.id, commentIndex: 0},
                tokenizer,
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
                },
                createdTime: comment1.createdTime,
                title: null,
                body: "Test task comment content 1.",
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
            },
        });

        expect(
            await getSearchEntity(
                space.systemAction(),
                {type: "TaskComment", taskId: task2.id, commentIndex: 0},
                tokenizer,
            ),
        ).toEqual({
            dependencyIds: new Set([
                `Task:${task2.id}:Authorization`,
                `TaskCollection:${publicCollection.id}:Authorization`,
            ]),
            entity: {
                id: `TaskComment:${task2.id}-0`,
                accessPolicy: {accountGrantAccountIds: new Set(), defaultGrantType: "Space"},
                createdTime: comment2.createdTime,
                title: null,
                body: "Test task comment content 2.",
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
            },
        });

        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    });
});
