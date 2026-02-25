import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";

const {context, services} = createTestServices();

function getTaskTitleInput(page: Page) {
    return page.getByTestId("TaskDetailViewMain").getByLabel("Title");
}

async function expectTaskCanBeOpened(page: Page, options?: {timeout?: number}) {
    await expect(getTaskTitleInput(page)).toBeVisible(options);
}

async function expectTaskCanNotBeOpened(page: Page) {
    await expect(page.getByText("Couldn\u2019t open task")).toBeVisible();
    await expect(getTaskTitleInput(page)).toBeHidden();
}

async function shareTaskWithAccount(page: Page, accountInitialName: string) {
    await page.getByRole("button", {name: "Share"}).click();
    await expect(page.getByPlaceholder("Add people")).toBeVisible();
    await page.getByPlaceholder("Add people").click();
    await page.getByRole("option", {name: accountInitialName}).click();
    await page.getByRole("button", {name: "Share", exact: true}).click();
}

async function expectModalDialog({
    page,
    title,
    description,
}: {
    page: Page;
    title: string;
    description: string;
}) {
    await expect(page.getByRole("heading", {name: title})).toBeVisible();
    await expect(page.getByText(description, {exact: true})).toBeVisible();
    await page.getByRole("button", {name: "Ok"}).click();
}

async function expectNoCanNotMakePrivateModal(page: Page) {
    await expect(
        page.getByRole("heading", {name: "Can\u2019t make this task private"}),
    ).toBeHidden();
}

test("can share and unshare a task with the share button without inherited sharing warnings", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session] = await space.createSessions(1);
    const task = await TestTask.create(session, {title: "Task"});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);
    await expectTaskCanBeOpened(page);

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task is private");

    await page.getByRole("button", {name: "Toggle sharing"}).click();
    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task is shared with everyone in Test Space",
    );

    await page.getByRole("button", {name: "Toggle sharing"}).click();
    await expect(page.getByRole("heading", {name: "Make this task private?"})).toBeVisible();
    await page.getByRole("button", {name: "Confirm"}).click();
    await expectNoCanNotMakePrivateModal(page);
    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task is private");
});

test("can share and unshare everyone in the share modal without inherited sharing warnings", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session] = await space.createSessions(1);
    const task = await TestTask.create(session, {title: "Task"});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);
    await expectTaskCanBeOpened(page);

    await page.getByRole("button", {name: "Share"}).click();
    await expect(page.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();

    await page
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can\u2019t access"})
        .click();
    await page.getByRole("menuitem", {name: "can edit"}).click();

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task is shared with everyone in Test Space",
    );

    await page
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can\u2019t access"}).click();
    await expectNoCanNotMakePrivateModal(page);

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task is private");
});

test("can share a task with inherited manage access from a collection", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2, session3] = await space.createSessions(3);

    const collection = await TestTaskCollection.create(session1, {name: "Collection"});
    const task = await TestTask.create(session1, {title: "Task"});
    await task.addCollection(session1, collection);
    await collection.access.grant(session1, session2, "Manage");

    await services.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/tasks/${task.id}`);
    await expectTaskCanBeOpened(page1);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session3);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/tasks/${task.id}`);
    await expectTaskCanNotBeOpened(page2);

    await shareTaskWithAccount(page1, session3.account.initialName);

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`),
    ).toBeVisible();

    await expect(async () => {
        await page2.reload();
        await expectTaskCanBeOpened(page2, {timeout: 250});
    }).toPass({timeout: 5000});

    await browserContext2.close();
});

test("can share a task with inherited manage access from a parent task", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2, session3] = await space.createSessions(3);

    const parentCollection = await TestTaskCollection.create(session1, {
        name: "Parent Collection",
    });
    const parentTask = await TestTask.create(session1, {title: "Parent task"});
    await parentTask.addCollection(session1, parentCollection);
    const childTask = await TestTask.create(session1, {title: "Child task", parent: parentTask});
    await parentCollection.access.grant(session1, session2, "Manage");

    await services.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/tasks/${childTask.id}`);
    await expectTaskCanBeOpened(page1);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session3);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/tasks/${childTask.id}`);
    await expectTaskCanNotBeOpened(page2);

    await shareTaskWithAccount(page1, session3.account.initialName);

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`),
    ).toBeVisible();

    await expect(async () => {
        await page2.reload();
        await expectTaskCanBeOpened(page2, {timeout: 250});
    }).toPass({timeout: 5000});

    await browserContext2.close();
});

test("shows collection-based effective permission explanations in task detail share dialog", async ({
    page,
    context: browserContext,
}) => {
    const spaceName = "Test Space";
    const space = await TestSpace.create(context, {name: spaceName});
    const [session1, session2, session3] = await space.createSessions(3);

    const collection = await TestTaskCollection.create(session1, {name: "Inherited Collection"});
    const task = await TestTask.create(session1, {title: "Task"});
    await task.addCollection(session1, collection);
    await collection.access.grant(session1, session2, "Manage");
    await collection.access.grant(session1, session3, "Manage");
    await collection.access.grantDefault(session1, "Manage");
    await collection.access.grantUrl(session1);

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);
    await expectTaskCanBeOpened(page);

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task is shared with anyone with the link");

    await page.getByRole("button", {name: "Toggle sharing"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t make this task private",
        description: `This task is public because it\u2019s in the \u201C${collection.initialName}\u201D collection which is shared to anyone with the link. Try removing the task from public collections.`,
    });

    async function openShareOverlay() {
        await page.getByRole("button", {name: "Share"}).click();
        await expect(
            page
                .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
                .getByRole("button", {name: "can edit"}),
        ).toBeVisible();
        await expect(
            page.getByTestId("ShareOverlayDefaultGrant").getByRole("button", {name: "can edit"}),
        ).toBeVisible();
        await expect(
            page.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}),
        ).toBeVisible();
    }

    await openShareOverlay();
    await page
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can view"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t change this task to \u201Ccan view\u201D",
        description: `You can see this task because it\u2019s in the \u201C${collection.initialName}\u201D collection which is shared with everyone in ${spaceName}. Try removing the task from collections with \u201Ccan view\u201D access.`,
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can\u2019t access"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t make this task private",
        description: `This task is public because it\u2019s in the \u201C${collection.initialName}\u201D collection which is shared with everyone in ${spaceName}. Try removing the task from public collections.`,
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page
        .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can view"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t change this person to \u201Ccan view\u201D",
        description: `This person can see the task because the \u201C${collection.initialName}\u201D collection is shared with them. Try removing the task from collections where this person has \u201Ccan view\u201D access.`,
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page
        .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "remove access"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t remove this person",
        description: `This person has access to the task because the \u201C${collection.initialName}\u201D collection is shared with them. Try removing the task from collections shared with this person.`,
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();
    await page.getByRole("menuitem", {name: "can\u2019t access"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t make this task private",
        description: `This task is public because it\u2019s in the \u201C${collection.initialName}\u201D collection which is shared to anyone with the link. Try removing the task from public collections.`,
    });
});

test("shows parent-based effective permission explanations in task detail share dialog", async ({
    page,
    context: browserContext,
}) => {
    const spaceName = "Test Space";
    const space = await TestSpace.create(context, {name: spaceName});
    const [session1, session2, session3] = await space.createSessions(3);

    const parentCollection = await TestTaskCollection.create(session1, {
        name: "Parent Collection",
    });
    const parentTask = await TestTask.create(session1, {title: "Parent task"});
    await parentTask.addCollection(session1, parentCollection);
    const childTask = await TestTask.create(session1, {title: "Child task", parent: parentTask});
    await parentCollection.access.grant(session1, session2, "Manage");
    await parentCollection.access.grant(session1, session3, "Manage");
    await parentCollection.access.grantDefault(session1, "Manage");
    await parentCollection.access.grantUrl(session1);

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/${childTask.id}`);
    await expectTaskCanBeOpened(page);

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task is shared with anyone with the link");

    await page.getByRole("button", {name: "Toggle sharing"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t make this task private",
        description:
            "This task is public because the parent task is shared to anyone with the link. Try making the parent task private.",
    });

    async function openShareOverlay() {
        await page.getByRole("button", {name: "Share"}).click();
        await expect(
            page
                .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
                .getByRole("button", {name: "can edit"}),
        ).toBeVisible();
        await expect(
            page.getByTestId("ShareOverlayDefaultGrant").getByRole("button", {name: "can edit"}),
        ).toBeVisible();
        await expect(
            page.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}),
        ).toBeVisible();
    }

    await openShareOverlay();
    await page
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can view"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t change this task to \u201Ccan view\u201D",
        description: `You can see this task because the parent task is shared with everyone in ${spaceName}. Try removing \u201Ccan view\u201D access from the parent task.`,
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can\u2019t access"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t make this task private",
        description: `This task is public because the parent task is shared with everyone in ${spaceName}. Try making the parent task private.`,
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page
        .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can view"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t change this person to \u201Ccan view\u201D",
        description:
            "This person can see the task because the parent task is shared with them. Try removing their \u201Ccan view\u201D access from the parent task.",
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page
        .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "remove access"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t remove this person",
        description:
            "This person has access to the task because the parent task is shared with them. Try removing their access from the parent task.",
    });

    await page.reload();
    await expectTaskCanBeOpened(page);
    await openShareOverlay();
    await page.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();
    await page.getByRole("menuitem", {name: "can\u2019t access"}).click();
    await expectModalDialog({
        page,
        title: "Can\u2019t make this task private",
        description:
            "This task is public because the parent task is shared to anyone with the link. Try making the parent task private.",
    });
});

test("shows assignee-based effective permission explanations in task detail share dialog", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2, session3] = await space.createSessions(3);

    const collection = await TestTaskCollection.create(session1, {name: "Collection"});
    const task = await TestTask.create(session1, {title: "Task", assignee: session3.account});
    await task.addCollection(session1, collection);
    await collection.access.grant(session1, session2, "Manage");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);
    await expectTaskCanBeOpened(page);
    await expect(page.getByTestId("TaskAssigneeInput")).toContainText(session3.account.initialName);

    await page.getByRole("button", {name: "Share"}).click();
    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "can view"}).click();
    await expect(
        page.getByRole("heading", {name: "Can\u2019t change this person to \u201Ccan view\u201D"}),
    ).toBeVisible();
    await expect(page.getByText("because they\u2019re assigned to it.")).toBeVisible();
    await page.getByRole("button", {name: "Ok"}).click();

    await page.reload();
    await expectTaskCanBeOpened(page);
    await page.getByRole("button", {name: "Share"}).click();
    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session3.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();
    await page.getByRole("menuitem", {name: "remove access"}).click();
    await expect(page.getByRole("heading", {name: "Can\u2019t remove this person"})).toBeVisible();
    await expect(page.getByText("because they\u2019re assigned to it.")).toBeVisible();
    await page.getByRole("button", {name: "Ok"}).click();
});
