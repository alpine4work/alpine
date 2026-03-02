import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {getTaskTitleText} from "~/shared/tasks/title/task_title.js";

const {context, services} = createTestServices();

async function openMoreMenu(page: Page) {
    await page.getByRole("button", {name: "More"}).click();
    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
}

async function turnTaskInto(page: Page, layout: "Task" | "Project") {
    await openMoreMenu(page);
    const turnIntoMenuItem = page.getByRole("menuitem", {name: "Turn into"});
    await expect(turnIntoMenuItem).toBeVisible();
    await turnIntoMenuItem.hover();
    const layoutMenuItem = page.getByRole("menuitem", {name: layout});
    await layoutMenuItem.click();
    await expect(layoutMenuItem).toBeHidden();
}

function getTaskIdFromCurrentTaskUrl(page: Page): TaskId {
    const pathParts = new URL(page.url()).pathname.split("/");
    const taskId = pathParts[pathParts.length - 1];
    assert(taskId && isId<TaskId>(taskId));
    return taskId;
}

test("can edit the name of a project task", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {
        title: "Project Alpha",
        layout: "Project",
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await openMoreMenu(page);
    await page.getByRole("menuitem", {name: "Edit title"}).click();

    const titleInput = page.locator("input[placeholder='Project Alpha']");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Project Beta");
    await titleInput.press("Enter");

    await expect(page.getByText("Project Beta", {exact: true})).toBeVisible();

    await page.reload();

    await expect(page.getByText("Project Beta", {exact: true})).toBeVisible();
});

test("can view notes, comments, and subtasks for a project task", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {
        title: "Project task",
        layout: "Project",
    });

    await runAllPromises([
        task.typeNotes(session, "Project notes content"),
        task.createComment(session, "Project task comment"),
        TestTask.create(session, {title: "Project child task 1", parent: task}),
        TestTask.create(session, {title: "Project child task 2", parent: task}),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(page.getByText("Project", {exact: true})).toBeVisible();
    await expect(page.getByText("Notes", {exact: true})).toBeVisible();
    await expect(page.getByRole("textbox", {name: "Notes"})).toContainText("Project notes content");

    await expect(page.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page.getByText("Project task comment")).toBeVisible();

    const rowTitles = page.getByTestId(/^TaskRowView:/).getByRole("textbox", {name: "Title"});
    await expect(rowTitles.nth(0)).toHaveText("Project child task 1");
    await expect(rowTitles.nth(1)).toHaveText("Project child task 2");
});

test("can turn a regular task into a project task and back", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "Layout toggle task"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toBeVisible();
    await expect(page.getByText("Subtasks", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: "Create task"})).toBeHidden();

    await turnTaskInto(page, "Project");

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toBeHidden();
    await expect(page.getByText("Subtasks", {exact: true})).toBeHidden();
    await expect(page.getByRole("button", {name: "Create task"})).toBeVisible();

    await turnTaskInto(page, "Task");

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toBeVisible();
    await expect(page.getByText("Subtasks", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: "Create task"})).toBeHidden();
});

test("floating create shows parent before typing and creates a subtask when typing", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const parentTask = await TestTask.create(session, {
        title: "Parent project task",
        layout: "Project",
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext1, session);
    await page1.goto(`/s/${space.id}/tasks/${parentTask.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/tasks/${parentTask.id}`);

    await expect(page2.getByText("Floating child task")).toBeHidden();

    await page1.getByRole("button", {name: "Create task"}).click();
    await expect(
        page1.getByTestId("TaskDetailViewMain").getByRole("button", {name: "Parent project task"}),
    ).toBeVisible();

    await expect(page2.getByText("Floating child task")).toBeHidden();

    await page1.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}).click();
    await page1.keyboard.type("Floating child task");

    await expect(page2.getByText("Floating child task")).toBeVisible();

    await browserContext2.close();
});

test("can create a project from create menu in fullscreen and focused", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/dev/empty`);

    await page.getByLabel("Create").click();
    await page.getByRole("menuitem", {name: "More"}).hover();
    await page.getByRole("menuitem", {name: "Project"}).click();

    await expect(page).toHaveURL(/\/s\/[^/]+\/tasks\/[^?]+\?create=/);
    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByRole("button", {name: "Create task"})).toBeVisible();

    const titleInput = page.getByPlaceholder("Untitled");
    await expect(titleInput).toBeFocused();

    await page.keyboard.type("Create menu project");
    await page.keyboard.press("Enter");

    await expect(page).not.toHaveURL(/[?&]create/);
    await expect(page.getByText("Create menu project", {exact: true})).toBeVisible();

    const taskId = getTaskIdFromCurrentTaskUrl(page);

    await expect(async () => {
        const taskDoc = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });
        expect(getTaskTitleText(assertExists(taskDoc).title.raw)).toEqual("Create menu project");
    }).toPass({timeout: 5000});
});

test("can turn a create-menu task peek into project and get fullscreen project ui", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/dev/empty`);

    await page.getByLabel("Create").click();
    await page.getByRole("menuitem", {name: "Task"}).click();

    const peek = page.getByTestId("PeekStackOverlay");
    await expect(peek).toBeVisible();
    await expect(peek.getByTestId("TaskDetailViewMain")).toBeVisible();

    await peek.getByLabel("More").click();
    const turnIntoMenuItem = page.getByRole("menuitem", {name: "Turn into"});
    await expect(turnIntoMenuItem).toBeVisible();
    await turnIntoMenuItem.hover();
    await page.getByRole("menuitem", {name: "Project"}).click();
    await expect(turnIntoMenuItem).toBeHidden();

    await expect(peek).toBeHidden();
    await expect(page.getByRole("button", {name: "Create task"})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toBeHidden();
    await expect(page.getByText("Project", {exact: true})).toBeVisible();
});
