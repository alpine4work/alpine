import {expect, test} from "@playwright/test";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";

const {context, services} = createTestServices();
const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

/**
 * Makes a task collection deterministically findable by the collections-dropdown
 * keyword search (`searchTaskCollectionsByKeywords`).
 *
 * In integration tests the search keyword index is created with
 * `refresh_interval: "-1"` (because `NODE_ENV === "test"`), so a newly-indexed
 * document only becomes searchable after an explicit refresh. Without this the
 * dropdown's single search request can run before the collection is visible and
 * silently miss it — which is especially likely for the last collection created.
 * Mirrors `indexChatForKeywordSearch` in `chat_account_picker.spec.ts`.
 */
async function indexCollectionForKeywordSearch(spaceId: SpaceId, collectionId: TaskCollectionId) {
    await context.jobs.sendAndWait({
        type: "IndexSearchEntity",
        spaceId,
        update: {type: "TaskCollection", collectionId, updatedTraits: {type: "Any"}},
    });

    // Confirm the document write landed before refreshing.
    // `getDocWithoutSourceIfExists` reads by id so it's read-after-write consistent
    // without a refresh.
    await expect(async () => {
        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                spaceId,
                `TaskCollection:${collectionId}`,
            ),
        ).not.toBeNull();
    }).toPass({timeout: 5000});

    await context.opensearch.refresh(SearchEntityKeywordIndex);
}

async function createTaskWithPrivateAndPublicCollections(
    session: TestSpaceSession,
    taskTitle: string,
) {
    const privateCollection = await TestTaskCollection.create(session, {name: "Private"});
    const publicCollection = await TestTaskCollection.create(session, {
        name: "Public",
        access: "Public",
    });
    const task = await TestTask.create(session, {
        title: taskTitle,
        collections: [privateCollection, publicCollection],
    });

    return {task, privateCollection, publicCollection};
}

/**
 * Creates a task with two site-scoped collections: one in a private site and one
 * in a public site.
 *
 * A site-scoped collection inherits its access from its site, so the lock icon
 * must reflect the _site's_ access rather than the collection's own. This
 * exercises the `Site` branch of the lock-icon logic in each view, which resolves
 * the referenced site through the `siteRegistry` — verifying the site is hydrated
 * to the client everywhere a collection chip is rendered.
 */
async function createTaskWithSiteScopedCollections(session: TestSpaceSession, taskTitle: string) {
    const privateSite = await TestSite.create(session, {name: "Private site", access: "Private"});
    const publicSite = await TestSite.create(session, {name: "Public site", access: "Public"});

    const collectionInPrivateSite = await TestTaskCollection.create(session, {
        name: "In private site",
        access: {
            type: "Site",
            siteId: privateSite.id,
            position: {parentId: privateSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });
    const collectionInPublicSite = await TestTaskCollection.create(session, {
        name: "In public site",
        access: {
            type: "Site",
            siteId: publicSite.id,
            position: {parentId: publicSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });

    const task = await TestTask.create(session, {
        title: taskTitle,
        collections: [collectionInPrivateSite, collectionInPublicSite],
    });

    return {task, privateSite, publicSite, collectionInPrivateSite, collectionInPublicSite};
}

test("shows lock icon for private collection chips in task detail view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, privateCollection, publicCollection} =
        await createTaskWithPrivateAndPublicCollections(session, "Task detail lock test");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    const privateChip = page
        .getByTestId("TaskCollectionsInput")
        .getByTestId("TaskCollectionChip")
        .filter({hasText: privateCollection.initialName});
    await expect(privateChip).toBeVisible();
    await expect(privateChip.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    const publicChip = page
        .getByTestId("TaskCollectionsInput")
        .getByTestId("TaskCollectionChip")
        .filter({hasText: publicCollection.initialName});
    await expect(publicChip).toBeVisible();
    await expect(publicChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for private collection chips in task query view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, privateCollection, publicCollection} =
        await createTaskWithPrivateAndPublicCollections(session, "Task query lock test");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([privateCollection.id]),
            },
        },
    ]);
    await page.goto(`/task-view/new/${space.id}?filter=${filtersSearchParam}`);

    const queryCell = page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByTestId("TaskRowCollectionsCell");

    const chips = queryCell.getByTestId("TaskCollectionChip");
    await expect(chips).toHaveCount(2);

    const chipsWithPrivateLockIcon = chips.filter({
        has: page.getByRole("img", {name: "Private lock icon"}),
    });
    await expect(chipsWithPrivateLockIcon).toHaveCount(1);

    const publicChip = chips.filter({hasText: publicCollection.initialName});
    await expect(publicChip).toBeVisible();
    await expect(publicChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for private collection options in collections dropdown", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const privateCollectionOption = await TestTaskCollection.create(session, {
        name: "Private dropdown option",
    });

    const task = await TestTask.create(session, {title: "Task dropdown lock test"});

    // Ensure this collection appears in search results.
    await TestTask.create(session, {
        title: "Task in private option collection",
        collections: privateCollectionOption,
    });

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    const collectionsCombobox = page.getByRole("combobox", {name: "Collections"});
    await collectionsCombobox.click();
    await expect(page.getByRole("option", {name: "Create collection"})).toBeVisible();

    const privateOption = page
        .getByRole("option")
        .filter({has: page.getByText(privateCollectionOption.initialName, {exact: true})});
    await collectionsCombobox.fill(privateCollectionOption.initialName);
    await expect(privateOption).toHaveCount(1, {timeout: 15_000});
    await expect(privateOption).toBeVisible();
    await expect(privateOption.getByRole("img", {name: "Private lock icon"})).toBeVisible();
});

test("shows lock icon for private collection chips in task file entity previews", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, privateCollection, publicCollection} =
        await createTaskWithPrivateAndPublicCollections(session, "Task preview lock test");

    const documentTitle = "Task lock icon document";
    const document = await TestDocument.create(session, {title: documentTitle});

    const replaceStart = documentTitle.length + 2;
    const replaceEnd = replaceStart + 2;
    await document.update(session, [
        new ReplaceStep(
            replaceStart,
            replaceEnd,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Task:${task.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    const taskPreview = page.getByTestId("ContentFileEntityPreview:Task");
    await expect(taskPreview).toHaveCount(1);

    const privateChip = taskPreview
        .getByTestId("TaskCollectionChip")
        .filter({hasText: privateCollection.initialName});
    await expect(privateChip).toBeVisible();
    await expect(privateChip.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    const publicChip = taskPreview
        .getByTestId("TaskCollectionChip")
        .filter({hasText: publicCollection.initialName});
    await expect(publicChip).toBeVisible();
    await expect(publicChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for site-scoped collection chips based on site access in task detail view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, collectionInPrivateSite, collectionInPublicSite} =
        await createTaskWithSiteScopedCollections(session, "Site detail lock test");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    // Collection in a private site inherits the site's private access, so it shows the
    // lock icon.
    const privateSiteChip = page
        .getByTestId("TaskCollectionsInput")
        .getByTestId("TaskCollectionChip")
        .filter({hasText: collectionInPrivateSite.initialName});
    await expect(privateSiteChip).toBeVisible();
    await expect(privateSiteChip.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    // Collection in a public site inherits the site's public access, so it has no lock
    // icon.
    const publicSiteChip = page
        .getByTestId("TaskCollectionsInput")
        .getByTestId("TaskCollectionChip")
        .filter({hasText: collectionInPublicSite.initialName});
    await expect(publicSiteChip).toBeVisible();
    await expect(publicSiteChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for site-scoped collection chips based on site access in task query view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, collectionInPrivateSite, collectionInPublicSite} =
        await createTaskWithSiteScopedCollections(session, "Site query lock test");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([collectionInPrivateSite.id]),
            },
        },
    ]);
    await page.goto(`/s/${space.id}/tasks/view?filter=${filtersSearchParam}`);

    const queryCell = page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByTestId("TaskRowCollectionsCell");

    const chips = queryCell.getByTestId("TaskCollectionChip");
    await expect(chips).toHaveCount(2);

    // Only the collection in the private site shows the lock icon.
    const chipsWithPrivateLockIcon = chips.filter({
        has: page.getByRole("img", {name: "Private lock icon"}),
    });
    await expect(chipsWithPrivateLockIcon).toHaveCount(1);

    const publicSiteChip = chips.filter({hasText: collectionInPublicSite.initialName});
    await expect(publicSiteChip).toBeVisible();
    await expect(publicSiteChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for site-scoped collection options based on site access in collections dropdown", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const privateSite = await TestSite.create(session, {name: "Private site", access: "Private"});
    const publicSite = await TestSite.create(session, {name: "Public site", access: "Public"});

    // Both collections share the distinctive "Sitescoped" keyword so a single search
    // surfaces both options at once, avoiding a fragile second search.
    const privateSiteOptionCollection = await TestTaskCollection.create(session, {
        name: "Sitescoped private option",
        access: {
            type: "Site",
            siteId: privateSite.id,
            position: {parentId: privateSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });
    const publicSiteOptionCollection = await TestTaskCollection.create(session, {
        name: "Sitescoped public option",
        access: {
            type: "Site",
            siteId: publicSite.id,
            position: {parentId: publicSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });

    const task = await TestTask.create(session, {title: "Site dropdown lock test"});

    await ProcessContextModule.waitForTestTasks();

    // Make both collections deterministically searchable in the dropdown. The public
    // site option is created last, so it's the one most likely to be missing if we
    // relied on the index refreshing on its own.
    await runAllPromises([
        indexCollectionForKeywordSearch(space.id, privateSiteOptionCollection.id),
        indexCollectionForKeywordSearch(space.id, publicSiteOptionCollection.id),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    const collectionsCombobox = page.getByRole("combobox", {name: "Collections"});
    await collectionsCombobox.click();
    await expect(page.getByRole("option", {name: "Create collection"})).toBeVisible();
    await collectionsCombobox.fill("Sitescoped");

    // The option for a collection in a private site shows the lock icon.
    const privateSiteOption = page
        .getByRole("option")
        .filter({has: page.getByText(privateSiteOptionCollection.initialName, {exact: true})});
    await expect(privateSiteOption).toHaveCount(1, {timeout: 15_000});
    await expect(privateSiteOption.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    // The option for a collection in a public site has no lock icon.
    const publicSiteOption = page
        .getByRole("option")
        .filter({has: page.getByText(publicSiteOptionCollection.initialName, {exact: true})});
    await expect(publicSiteOption).toHaveCount(1);
    await expect(publicSiteOption.getByRole("img", {name: "Private lock icon"})).toBeHidden();
});

test("shows lock icon for site-scoped collection chips based on site access in task file entity previews", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, collectionInPrivateSite, collectionInPublicSite} =
        await createTaskWithSiteScopedCollections(session, "Site preview lock test");

    const documentTitle = "Site lock icon document";
    const document = await TestDocument.create(session, {title: documentTitle});

    const replaceStart = documentTitle.length + 2;
    const replaceEnd = replaceStart + 2;
    await document.update(session, [
        new ReplaceStep(
            replaceStart,
            replaceEnd,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Task:${task.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    const taskPreview = page.getByTestId("ContentFileEntityPreview:Task");
    await expect(taskPreview).toHaveCount(1);

    // Collection in a private site shows the lock icon.
    const privateSiteChip = taskPreview
        .getByTestId("TaskCollectionChip")
        .filter({hasText: collectionInPrivateSite.initialName});
    await expect(privateSiteChip).toBeVisible();
    await expect(privateSiteChip.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    // Collection in a public site has no lock icon.
    const publicSiteChip = taskPreview
        .getByTestId("TaskCollectionChip")
        .filter({hasText: collectionInPublicSite.initialName});
    await expect(publicSiteChip).toBeVisible();
    await expect(publicSiteChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});
