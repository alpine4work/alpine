import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {LanguageModelsNoopDevelopmentContextModule} from "~/server/language_models/language_models_noop_development_context_module.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
    searchByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {updateSiteName} from "~/server/sites/data/update_site_name.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

let languageModel: AllMiniLmL6V2LanguageModel;
beforeAll(async () => {
    languageModel = await AllMiniLmL6V2LanguageModel.new();
});

function createLanguageModelsContextModuleForTest(): LanguageModelsNoopDevelopmentContextModule {
    return new LanguageModelsNoopDevelopmentContextModule({embeddingModel: languageModel});
}

const context = createTestContext({
    shouldStartOpensearch: true,
    chatInjection,
    documentsInjection,
    searchInjection,
    sitesInjection,
    spacesInjection,
    tasksInjection,
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
                break;
            }
        }
    },
});

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

// Important that this goes after `createTestContext()` which will register
// `afterEach` hooks that clean up some timers.
afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

async function flushAndRefresh() {
    import.meta.jest.advanceTimersByTime(10 * 1000);
    await ProcessContextModule.waitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);
}

async function findSearchResultIds(
    session: TestSpaceSession,
    spaceId: SpaceId,
    queryText: string,
): Promise<Set<SearchEntityId>> {
    const results = await searchByKeywords(session.action(), {
        spaceId,
        queryText,
        limit: 100,
        timeZone: defaultTimeZone,
        currentTime: new Date(),
    });
    return new Set(results.map(result => result.id));
}

async function createSiteWithUniqueName(
    session: TestSpaceSession,
    {name}: {name: string},
): Promise<TestSite> {
    return await TestSite.create(session, {name});
}

test("site is searchable by name via keyword search", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Banana Engineering Wiki"});

    await flushAndRefresh();

    const ids = await findSearchResultIds(session, space.id, "banana");
    expect(ids.has(`Site:${site.id}`)).toEqual(true);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("channel in a site is searchable by site name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Apricot Design Site"});
    const channel = await TestChannel.create(session, {name: "general"});

    await site.addEntity(session, {
        entityId: `Channel:${channel.id}`,
        parentId: site.initialRootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await flushAndRefresh();

    const ids = await findSearchResultIds(session, space.id, "apricot");
    expect(ids.has(`Channel:${channel.id}`)).toEqual(true);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("room chat in a site is searchable by site name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Cherry Product Site"});
    const chat = await TestChat.createRoom(session, {name: "stand-up"});
    await chat.sendMessage(session, "First message so the chat gets indexed.");

    await site.addEntity(session, {
        entityId: `Chat:${chat.id}`,
        parentId: site.initialRootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await flushAndRefresh();

    const ids = await findSearchResultIds(session, space.id, "cherry");
    expect(ids.has(`Chat:${chat.id}`)).toEqual(true);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("document in a site is searchable by site name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Dragonfruit Research Wiki"});
    const document = await TestDocument.create(session, {title: "Untitled"});

    // Drive the access-policy update through `TestDocument.access.set` rather than
    // `site.addEntity` because the latter goes through a durable-object route that
    // isn't simulated in this test harness. The access-policy mutation alone is what
    // triggers the indexer to pick up the site name.
    await document.access.set(session, {
        type: "Site",
        siteId: site.id,
        position: {parentId: site.initialRootContainerId, orderKey: assertOrderKey("a0")},
    });

    await flushAndRefresh();

    const ids = await findSearchResultIds(session, space.id, "dragonfruit");
    expect(ids.has(`Document:${document.id}`)).toEqual(true);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("task in a site is searchable by site name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Elderberry Roadmap Site"});
    const task = await TestTask.create(session, {title: "Some task"});

    await site.addEntity(session, {
        entityId: `Task:${task.id}`,
        parentId: site.initialRootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await flushAndRefresh();

    const ids = await findSearchResultIds(session, space.id, "elderberry");
    expect(ids.has(`Task:${task.id}`)).toEqual(true);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("task collection in a site is searchable by site name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Fig Backlog Site"});
    const collection = await TestTaskCollection.create(session, {name: "Sprint planning"});

    // Advance the clock so the CRDT timestamp on the access-policy update is strictly
    // greater than the collection's creation time.
    import.meta.jest.advanceTimersByTime(1000);

    await site.addEntity(session, {
        entityId: `TaskCollection:${collection.id}`,
        parentId: site.initialRootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await flushAndRefresh();

    const ids = await findSearchResultIds(session, space.id, "fig");
    expect(ids.has(`TaskCollection:${collection.id}`)).toEqual(true);

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

test("renaming a site reindexes contained entities so they\u2019re findable by the new name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await createSiteWithUniqueName(session, {name: "Grape Old Name Site"});
    const channel = await TestChannel.create(session, {name: "general"});

    await site.addEntity(session, {
        entityId: `Channel:${channel.id}`,
        parentId: site.initialRootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await flushAndRefresh();

    {
        const idsForOldName = await findSearchResultIds(session, space.id, "grape");
        expect(idsForOldName.has(`Channel:${channel.id}`)).toEqual(true);

        const idsForNewName = await findSearchResultIds(session, space.id, "honeydew");
        expect(idsForNewName.has(`Channel:${channel.id}`)).toEqual(false);
    }

    await renameSite(session, site.id, "Honeydew New Name Site");

    await flushAndRefresh();

    {
        const idsForOldName = await findSearchResultIds(session, space.id, "grape");
        expect(idsForOldName.has(`Channel:${channel.id}`)).toEqual(false);

        const idsForNewName = await findSearchResultIds(session, space.id, "honeydew");
        expect(idsForNewName.has(`Channel:${channel.id}`)).toEqual(true);
    }

    import.meta.jest.runAllTimers();
    await ProcessContextModule.waitForTestTasks();
});

async function renameSite(session: TestSpaceSession, siteId: SiteId, name: string): Promise<void> {
    await updateSiteName(session.action(), {siteId, name});
}
