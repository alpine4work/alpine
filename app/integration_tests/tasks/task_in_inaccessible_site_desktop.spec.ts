import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";

const {context, services} = createTestServices();

async function openTaskPeek(page: Page, {spaceId, taskId}: {spaceId: string; taskId: string}) {
    await page.goto(`/dev/empty/${spaceId}?peek=${encodeURIComponent(`/task/${taskId}`)}`);
    await page.waitForFunction("dev.ready");
    return page.getByTestId("PeekStackOverlay");
}

test.describe("task in a private site", () => {
    // Distinctive so we can assert the name appears nowhere in the assignee's UI: the
    // private site is never hydrated to an account without site access.
    const siteName = "Confidential roadmap site";
    async function createTaskInPrivateSite(space: TestSpace) {
        const owner = await space.createSession();
        const assignee = await space.createSession();
        // A plain space member who is neither the assignee nor a site member: they have no
        // path to the task at all.
        const outsider = await space.createSession();

        // Private site — only `owner` has access.
        const site = await TestSite.create(owner, {name: siteName, access: "Private"});

        const task = await TestTask.create(owner, {
            title: "Task in a private site",
            assignee,
        });

        // Move the task into the private site. This sets the task's access policy to
        // `{type: "Site"}` and adds it as a site entry.
        await site.addEntity(owner, {
            entityId: `Task:${task.id}`,
            parentId: site.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        return {owner, assignee, outsider, task};
    }

    test("shows site chrome for a task in a site to a viewer with site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {owner, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, owner);
        await page.goto(`/task/${task.id}`);

        // The task itself opens. Scope to the main detail view — the site chrome sidebar
        // also renders a task row with its own "Title" textbox.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // The owner has site access, so the site chrome (the sidebar carrying the site
        // name and its menu) renders.
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toBeVisible();
        await expect(page.getByText(siteName).first()).toBeVisible();
    });

    test("hides site chrome for a task in a site the assignee can\u2019t access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {assignee, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, assignee);
        await page.goto(`/task/${task.id}`);

        // The assignee is authorized through the assignee role, so the task still opens.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // But the private site is never hydrated for them: no site chrome renders and the
        // site's name leaks nowhere in the UI.
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });

    test("denies a task in a private site to a non-assignee without site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {outsider, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, outsider);
        await page.goto(`/task/${task.id}`);

        // The outsider has neither the assignee role nor site access, so the task can't be
        // opened.
        await expect(page.getByText("Couldn\u2019t open task")).toBeVisible();
        // The task never opens and the private site's name leaks nowhere in the UI.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });

    test("opens a task peek with the site breadcrumb for a viewer with site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {owner, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, owner);
        const peek = await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // The task opens inside the peek overlay.
        await expect(
            peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        await expect(peek.getByRole("button", {name: siteName})).toBeVisible();
    });

    test("opens a task peek for the assignee who can\u2019t access the site", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {assignee, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, assignee);
        const peek = await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // The assignee keeps task access through the assignee role, so the task opens.
        await expect(
            peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // They lack site access, so the peek renders no site breadcrumb chip and the
        // private site's name leaks nowhere.
        await expect(peek.getByRole("button", {name: siteName})).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });

    test("denies a task peek to a non-assignee without site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {outsider, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, outsider);
        await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // With neither the assignee role nor site access the task can't be opened, even
        // when reached through a peek. TODO(#sites): see the helper above \u2014 the
        // public collection arguably should grant access here too.
        await expect(page.getByText("Couldn\u2019t open task")).toBeVisible();
        await expect(page.getByText(siteName)).toHaveCount(0);
    });
});

test.describe("task in a private site and public collection", () => {
    // Distinctive so we can assert the name appears nowhere in the assignee's UI: the
    // private site is never hydrated to an account without site access.
    const siteName = "Confidential roadmap site";
    async function createTaskInPrivateSite(space: TestSpace) {
        const owner = await space.createSession();
        const assignee = await space.createSession();
        // A plain space member who is neither the assignee nor a site member: they have no
        // path to the task at all.
        const outsider = await space.createSession();

        // Private site — only `owner` has access.
        const site = await TestSite.create(owner, {name: siteName, access: "Private"});
        const publicCollection = await TestTaskCollection.create(owner, {access: "Public"});

        const task = await TestTask.create(owner, {
            title: "Task in a private site",
            assignee,
            collections: publicCollection,
        });

        // Move the task into the private site. This sets the task's access policy to
        // `{type: "Site"}` and adds it as a site entry.
        await site.addEntity(owner, {
            entityId: `Task:${task.id}`,
            parentId: site.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        return {owner, assignee, outsider, task};
    }

    test("shows site chrome for a task in a site to a viewer with site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {owner, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, owner);
        await page.goto(`/task/${task.id}`);

        // The task itself opens. Scope to the main detail view — the site chrome sidebar
        // also renders a task row with its own "Title" textbox.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // The owner has site access, so the site chrome (the sidebar carrying the site
        // name and its menu) renders.
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toBeVisible();
        await expect(page.getByText(siteName).first()).toBeVisible();
    });

    test("hides site chrome for a task in a site the assignee can\u2019t access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {assignee, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, assignee);
        await page.goto(`/task/${task.id}`);

        // The assignee is authorized through the assignee role, so the task still opens.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // But the private site is never hydrated for them: no site chrome renders and the
        // site's name leaks nowhere in the UI.
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });

    test("shows task without site chrome to a non-assignee without site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {outsider, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, outsider);
        await page.goto(`/task/${task.id}`);

        // The outsider can see the task without the site chrome.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // But the private site is never hydrated for them: no site chrome renders and the
        // site's name leaks nowhere in the UI.
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });

    test("opens a task peek with the site breadcrumb for a viewer with site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {owner, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, owner);
        const peek = await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // The task opens inside the peek overlay.
        await expect(
            peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        await expect(peek.getByRole("button", {name: siteName})).toBeVisible();
    });

    test("opens a task peek for the assignee who can\u2019t access the site", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {assignee, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, assignee);
        const peek = await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // The assignee keeps task access through the assignee role, so the task opens.
        await expect(
            peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // They lack site access, so the peek renders no site breadcrumb chip and the
        // private site's name leaks nowhere.
        await expect(peek.getByRole("button", {name: siteName})).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });

    test("opens a task peek without site chrome to a non-assignee without site access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {outsider, task} = await createTaskInPrivateSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, outsider);
        const peek = await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // The outsider can see the task without the site breadcrumb.
        await expect(
            peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // They lack site access, so the peek renders no site breadcrumb chip and the
        // private site's name leaks nowhere.
        await expect(peek.getByRole("button", {name: siteName})).toHaveCount(0);
        await expect(page.getByText(siteName)).toHaveCount(0);
    });
});

test.describe("task in public site and private collection", () => {
    // The inverse of the scenario above: a task that lives in a _private collection_
    // but is then added to a _public site_. Because the public site grants access to
    // the whole space, every space member can open the task and see the site chrome –
    // even a member who isn't in the private collection. The private collection itself
    // stays hidden from members who can't access it, so it surfaces a lock/hidden chip
    // rather than leaking its contents.
    //
    // Distinctive names so we can assert the private collection never leaks to a
    // member who can only reach the task through the public site.
    const publicSiteName = "Company wiki site";
    const privateCollectionName = "Confidential tasks collection";
    /**
     * Sets up the inverse scenario: a task in a private collection that's moved into a
     * public site. The public site's access policy grants the whole space access, so
     * the only variable below is whether the viewer is in the private collection:
     * `owner` (in the collection) sees the collection chip, while
     * `nonCollectionMember` (a space member who isn't) reaches the task only through
     * the public site and never sees the private collection.
     *
     * TODO(#sites): Moving a privately-collected task into a public site makes the
     * task visible to the entire space \u2014 the site's public access policy takes
     * precedence over the private collection's restriction. Confirm this precedence is
     * the intended behavior (and how it should interact with the public-collection /
     * private-site case above, which currently denies non-members entirely).
     */
    async function createTaskInPublicSite(space: TestSpace) {
        const owner = await space.createSession();
        // A plain space member who is not in the private collection. They can reach the
        // task only through the public site.
        const nonCollectionMember = await space.createSession();

        // Public site \u2014 every space member has access.
        const site = await TestSite.create(owner, {name: publicSiteName, access: "Public"});
        const privateCollection = await TestTaskCollection.create(owner, {
            name: privateCollectionName,
            access: "Private",
        });

        const task = await TestTask.create(owner, {
            title: "Task in a public site",
            collections: privateCollection,
        });

        // Move the task into the public site. This sets the task's access policy to
        // `{type: "Site"}` pointing at the public site, so everyone in the space gains
        // access regardless of the private collection.
        await site.addEntity(owner, {
            entityId: `Task:${task.id}`,
            parentId: site.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        return {owner, nonCollectionMember, task};
    }

    test("shows site chrome and the private collection for a task in a public site to a member of both", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {owner, task} = await createTaskInPublicSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, owner);
        await page.goto(`/task/${task.id}`);

        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // The owner has site access (the site is public) and is in the private collection,
        // so both the site chrome and the private collection chip render.
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toBeVisible();
        await expect(page.getByText(publicSiteName).first()).toBeVisible();
        await expect(page.getByText(privateCollectionName).first()).toBeVisible();
    });

    test("shows site chrome but hides the private collection for a task in a public site to a member without collection access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {nonCollectionMember, task} = await createTaskInPublicSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, nonCollectionMember);
        await page.goto(`/task/${task.id}`);

        // The public site grants the whole space access, so the task opens and the site
        // chrome renders even though this member isn't in the private collection.
        await expect(
            page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();
        await expect(page.getByTestId("SiteSideBarNavigationBar")).toBeVisible();
        await expect(page.getByText(publicSiteName).first()).toBeVisible();

        // They can't access the private collection, so it's filtered out: its name leaks
        // nowhere in their UI.
        await expect(page.getByText(privateCollectionName)).toHaveCount(0);
    });

    test("opens a task peek in a public site for a member without collection access", async ({
        page,
        context: browserContext,
    }) => {
        const space = await TestSpace.create(context);
        const {nonCollectionMember, task} = await createTaskInPublicSite(space);

        await ProcessContextModule.waitForTestTasks();
        await services.signIn(browserContext, nonCollectionMember);
        const peek = await openTaskPeek(page, {spaceId: space.id, taskId: task.id});

        // The public site grants access, so the task opens inside the peek overlay.
        await expect(
            peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        // The private collection stays hidden from a member who can't access it.
        await expect(page.getByText(privateCollectionName)).toHaveCount(0);

        await expect(peek.getByRole("button", {name: publicSiteName})).toBeVisible();
    });
});
