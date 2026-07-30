import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {pageKeyboardShortcut} from "~/app/integration_tests/helpers/page_keyboard_shortcut.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";

const {context, services} = createTestServices();

test("can update title", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}).click();
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "right"));

    await page.keyboard.type(" abc");

    await runAllPromises([
        (async () => {
            await expect(
                page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
            ).toHaveText("test abc");
            await expect(page.getByLabel("Assignee")).toHaveValue("");
            await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
            await expect(page.getByLabel("Priority")).toBeHidden();
            await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();
        })(),
        // Wait so we create two undo stack entries.
        await wait(500),
    ]);

    await page.keyboard.type(" def");

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc def");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}).blur();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc def");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" ghi");

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc ghi");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test abc ghi");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();
});

test("can delete", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByText("This task was deleted")).toBeHidden();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page
        .getByTestId("TaskDetailViewMain")
        .getByRole("textbox", {name: "Title"})
        .click({button: "right"});

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.getByText("Delete").click();

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeVisible();

    await page
        .getByRole("alertdialog", {name: "Delete task?"})
        .getByRole("button", {name: "Delete"})
        .click();
});

test("can update assignee", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1] = await runAllPromises([
        space.createSession({name: "Test1"}),
        space.createSession({name: "Test2"}),
    ]);
    const task = await TestTask.create(session1, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session1);
    await page.goto(`/task/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.getByLabel("Assignee").click();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test1"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test2"})).toBeVisible();

    await page.getByRole("option", {name: "Test1"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Test1");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.getByLabel("Assignee").click();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test1"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test2"})).toBeVisible();

    await page.getByRole("option", {name: "Test2"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Test2");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.getByLabel("Assignee").click();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test1"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test2"})).toBeVisible();

    await page.getByRole("option", {name: "Nobody"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Test2");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Test1");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Test1");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Test2");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();
});

test("can update priority", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Add priority"}).click();

    await expect(page.getByRole("option", {name: "None"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Low"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Medium"})).toBeVisible();

    await page.getByRole("option", {name: "Low"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("Low");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.getByLabel("Priority").click();

    await expect(page.getByRole("option", {name: "None"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Low"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Medium"})).toBeVisible();

    await page.getByRole("option", {name: "Medium"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("Medium");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.getByLabel("Priority").click();

    await expect(page.getByRole("option", {name: "None"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Low"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Medium"})).toBeVisible();

    await page.getByRole("option", {name: "None"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("Medium");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("Low");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("Low");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("Medium");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toHaveValue("");
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();
});

test("can update due date", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Add due date"}).click();

    await page.keyboard.type("7");
    await page.keyboard.type("12");
    await page.keyboard.type("1998");
    await page.keyboard.press("Escape");

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/1998");

    await page.getByRole("group", {name: "Due date"}).getByText("1998").focus();

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/2000");

    await page.getByRole("button", {name: "Clear"}).click();
    await page.locator("*:focus").blur();

    await page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("mm/dd/yyyy");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/2000");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/1999");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/1998");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/1999");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("7/12/2000");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toHaveText("mm/dd/yyyy");
});

test("can change status", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Testerson"});
    const task = await TestTask.create(session, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByRole("img", {name: "Open", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeHidden();

    await page
        .getByTestId("TaskDetailViewMain")
        .getByRole("textbox", {name: "Title"})
        .click({button: "right"});

    await expect(page.getByText("Mark active")).toBeVisible();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeVisible();

    await page.getByText("Mark active").click();

    await expect(page.getByRole("img", {name: "Open (active)", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeHidden();

    await page
        .getByTestId("TaskDetailViewMain")
        .getByRole("textbox", {name: "Title"})
        .click({button: "right"});

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeVisible();
    await expect(page.getByText("Mark closed")).toBeVisible();

    await page.getByText("Mark inactive").click();

    await expect(page.getByRole("img", {name: "Open", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeHidden();

    await page.getByTestId("TaskStatusButton").click();

    await expect(page.getByRole("img", {name: "Closed", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByTestId("TaskStatusButton").click();

    await expect(page.getByRole("img", {name: "Open", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByRole("img", {name: "Closed", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByRole("img", {name: "Open", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByRole("img", {name: "Open (active)", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByRole("img", {name: "Open", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(page.getByRole("img", {name: "Open (active)", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByTestId("TaskStatusButton").click();

    await expect(page.getByRole("img", {name: "Closed", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(page.getByRole("img", {name: "Closed", exact: true})).toBeVisible();
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("Testerson");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();
});

test("can update collections", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session, {name: "test1"});
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByRole("combobox", {name: "Collections"}).focus();

    await page.keyboard.type("test2");

    // Wait for loading to finish...
    await expect(page.getByText("Create collection \u201Ctest2\u201D")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await page.getByRole("combobox", {name: "Collections"}).blur();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test2Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByRole("combobox", {name: "Collections"}).focus();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.type("test3");
    await page.keyboard.press("Enter");

    await page.getByRole("combobox", {name: "Collections"}).blur();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test2test3Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByTestId("TaskCollectionsInput").getByLabel("Remove").nth(1).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test3Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByTestId("TaskCollectionsInput").getByLabel("Remove").nth(1).click();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.getByRole("combobox", {name: "Collections"}).focus();

    await page.keyboard.press("Backspace");

    await page.getByRole("combobox", {name: "Collections"}).blur();

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("test");
    await expect(page.getByLabel("Assignee")).toHaveValue("");
    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.getByRole("group", {name: "Due date"})).toBeHidden();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test3Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test3Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test2test3Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1test2Add");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(page.getByTestId("TaskCollectionsInput")).toHaveText("test1Add");
});

test("pressing backspace to delete a child task moves focus back to the parent task", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const parentTask = await TestTask.create(session);

    const childTask = await TestTask.create(session, {title: "Task 1"});
    await childTask.updateParentTask(session, parentTask);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${parentTask.id}`);

    await expectTaskGridView(page, [[true, "Task 1"]], {withoutColumns: true});

    await page
        .getByTestId(`TaskRowView:${childTask.id}`)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    await expectTaskGridView(page, [[[true, "Task 1"], [[true, ""]]]], {withoutColumns: true});

    await page.keyboard.press("Backspace");

    await expectTaskGridView(page, [[true, "Task 1"]], {withoutColumns: true});

    await page.keyboard.press("Backspace");
    await page.keyboard.press("2");

    await expectTaskGridView(page, [[true, "Task 2"]], {withoutColumns: true});
});

test("title edit after client request aborted last title edit", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "test"});

    await ProcessContextModule.waitForTestTasks();

    let titleCommitCount = 0;
    const firstTitleCommitReachedServer = createPromiseResolver<void>();
    const secondTitleCommitStarted = createPromiseResolver<void>();
    const releaseSecondTitleCommit = createPromiseResolver<void>();

    await page.route("**/api/rpc/**", async route => {
        const request = route.request();
        const requestBody = request.postData() ?? "";

        const isTaskTitleCommit =
            request.method() === "POST" &&
            (request.url().includes("/commitTaskActionTransaction") ||
                requestBody.includes("commitTaskActionTransaction")) &&
            requestBody.includes("UpdateTitle");

        if (!isTaskTitleCommit) {
            await route.continue();
            return;
        }

        titleCommitCount++;
        if (titleCommitCount === 1) {
            await route.fetch();
            firstTitleCommitReachedServer.resolve();
            await route.abort("failed");
            return;
        }

        if (titleCommitCount === 2) {
            secondTitleCommitStarted.resolve();
            await releaseSecondTitleCommit.promise;
        }

        await route.continue();
    });

    let shouldDelayNextSubscribeResponse = false;
    let delayedMessages: Array<() => void> = [];
    const closeCurrentTaskRealtimeWebSocket = createPromiseResolver<() => Promise<void>>();

    await page.routeWebSocket("**/api/task-realtime/**", route => {
        const server = route.connectToServer();
        closeCurrentTaskRealtimeWebSocket.resolve(async () => {
            await runAllPromises([server.close({code: 1011}), route.close({code: 1011})]);
        });

        route.onMessage(message => {
            server.send(message);
        });

        server.onMessage(message => {
            if (shouldDelayNextSubscribeResponse && isSubscribeProcedureResponse(message)) {
                shouldDelayNextSubscribeResponse = false;
                delayedMessages.push(() => route.send(message));
                return;
            }

            route.send(message);
        });

        function isSubscribeProcedureResponse(data: unknown) {
            if (typeof data !== "string") return false;

            try {
                const message = JSON.parse(data);
                return (
                    message.type === "ProcedureResponse" &&
                    message.result?.ok === true &&
                    message.result.output?.type === "subscribe"
                );
            } catch {
                return false;
            }
        }
    });

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    const titleInput = page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"});

    await expect(titleInput).toHaveText(/^test$/);

    await titleInput.click();
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "right"));
    await page.keyboard.type("x");

    await firstTitleCommitReachedServer.promise;

    // Wait for client to revert the commit.
    await expect(titleInput).toHaveText(/^test$/);

    shouldDelayNextSubscribeResponse = true;
    const close = await closeCurrentTaskRealtimeWebSocket.promise;
    await close();
    await expect.poll(() => delayedMessages.length).toBeGreaterThan(0);

    // Try updating again.
    await titleInput.click();
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "right"));
    await page.keyboard.type("y");

    await expect(titleInput).toHaveText(/^testy$/);

    await secondTitleCommitStarted.promise;

    for (const releaseMessage of delayedMessages) {
        releaseMessage();
    }
    delayedMessages = [];

    // When we reconnect, we should end up merging both updates.
    await expect(titleInput).toHaveText(/^test(?:xy|yx)$/);

    releaseSecondTitleCommit.resolve();
});
