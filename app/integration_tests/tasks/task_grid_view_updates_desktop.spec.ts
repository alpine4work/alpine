import {type Locator, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {serializeTaskQueryFilters} from "~/shared/tasks/task_query_filter.js";

const {context, services} = createTestServices();

test("can update title", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    const taskTitleInput = page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByRole("textbox", {name: "Title"});

    await taskTitleInput.click();
    await page.keyboard.press("ControlOrMeta+ArrowRight");
    await expectTaskTitleInputCaretAtEnd(taskTitleInput);

    await page.keyboard.type(" abc");

    await runAllPromises([
        expectTaskGridView(page, [[true, "test abc"]]),
        // Wait so we create two undo stack entries.
        await wait(500),
    ]);

    await page.keyboard.type(" def");

    await expectTaskGridView(page, [[true, "test abc def"]]);

    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).blur();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test abc"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test abc"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test abc def"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test abc"]]);

    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await expectTaskTitleInputCaretAtEnd(taskTitleInput);
    await page.keyboard.type(" ghi");

    await expectTaskGridView(page, [[true, "test abc ghi"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test abc ghi"]]);
});

async function expectTaskTitleInputCaretAtEnd(locator: Locator) {
    await expect
        .poll(async () =>
            locator.evaluate(element => {
                const selection = window.getSelection();
                if (
                    document.activeElement !== element ||
                    selection === null ||
                    selection.rangeCount === 0 ||
                    !selection.isCollapsed
                ) {
                    return false;
                }

                const rangeBeforeCaret = document.createRange();
                rangeBeforeCaret.selectNodeContents(element);
                rangeBeforeCaret.setEnd(selection.anchorNode ?? element, selection.anchorOffset);
                return rangeBeforeCaret.toString() === element.textContent;
            }),
        )
        .toBe(true);
}

async function expectTaskTitleCellFocused(locator: Locator) {
    await expect
        .poll(async () =>
            locator.evaluate(element => {
                const activeElement = document.activeElement;
                if (!(activeElement instanceof HTMLElement)) return false;
                if (!element.contains(activeElement)) return false;
                if (activeElement.isContentEditable) return false;
                if (activeElement.tagName === "BUTTON" || activeElement.role === "button") {
                    return false;
                }
                return true;
            }),
        )
        .toBe(true);
}

test("can delete", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByRole("textbox", {name: "Title"})
        .click({button: "right"});

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.getByText("Delete").click();

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeVisible();

    await page
        .getByRole("alertdialog", {name: "Delete task?"})
        .getByRole("button", {name: "Delete"})
        .click();

    await expectTaskGridView(page, []);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, []);
});

test("can delete when title input is focused with backspace", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(
        page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}),
    ).not.toBeFocused();
    await expect(
        page
            .getByTestId(/^TaskRowView:/)
            .last()
            .getByRole("textbox", {name: "Title"}),
    ).not.toBeFocused();

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .last()
        .click();

    await expect(
        page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}),
    ).not.toBeFocused();
    await expect(
        page
            .getByTestId(/^TaskRowView:/)
            .last()
            .getByRole("textbox", {name: "Title"}),
    ).toBeFocused();

    await page.keyboard.press("Backspace");

    await expect(
        page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}),
    ).toBeFocused();
    await expect(
        page
            .getByTestId(/^TaskRowView:/)
            .last()
            .getByRole("textbox", {name: "Title"}),
    ).not.toBeFocused();

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");

    await expectTaskGridView(page, [[true, ""]]);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.keyboard.press("Backspace");

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await expectTaskGridView(page, []);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, ""]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, []);
});

test("can delete when title cell is focused with backspace", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    const taskRowView = page.getByTestId(`TaskRowView:${task.id}`);
    const taskTitleInput = taskRowView.getByRole("textbox", {name: "Title"});

    await taskTitleInput.click();
    await page.keyboard.press("End");
    await expectTaskTitleInputCaretAtEnd(taskTitleInput);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expectTaskTitleCellFocused(taskRowView.getByTestId("TaskRowTitleCell"));

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Backspace");

    await expectTaskGridView(page, [[true, ""]]);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.keyboard.press("Backspace");

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await expectTaskGridView(page, []);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, ""]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, []);
});

test("can delete when title input is focused with backspace (with children)", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    const taskRowView = page.getByTestId(`TaskRowView:${task.id}`);
    const taskTitleInput = taskRowView.getByRole("textbox", {name: "Title"});

    await taskTitleInput.click();
    await page.keyboard.press("ControlOrMeta+ArrowRight");
    await expectTaskTitleInputCaretAtEnd(taskTitleInput);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("child task 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("child task 2");

    await expectTaskGridView(page, [
        [
            [true, "test"],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");

    await expectTaskGridView(page, [
        [
            [true, ""],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.keyboard.press("Backspace");

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeVisible();

    await expectTaskGridView(page, [
        [
            [true, ""],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await page
        .getByRole("alertdialog", {name: "Delete task?"})
        .getByRole("button", {name: "Delete"})
        .click();

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await expectTaskGridView(page, []);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [
        [
            [true, ""],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, []);
});

test("can delete when title cell is focused with backspace (with children)", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    const taskRowView = page.getByTestId(`TaskRowView:${task.id}`);
    const taskTitleInput = taskRowView.getByRole("textbox", {name: "Title"});

    await taskTitleInput.click();
    await page.keyboard.press("ControlOrMeta+ArrowRight");
    await expectTaskTitleInputCaretAtEnd(taskTitleInput);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("child task 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("child task 2");

    await expectTaskGridView(page, [
        [
            [true, "test"],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    const childTask2TitleInput = page
        .getByTestId(/^TaskRowView:/)
        .nth(2)
        .getByRole("textbox", {name: "Title"});

    await page.keyboard.press("End");
    await expectTaskTitleInputCaretAtEnd(childTask2TitleInput);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expectTaskTitleCellFocused(taskRowView.getByTestId("TaskRowTitleCell"));
    await page.keyboard.press("Backspace");

    await expectTaskGridView(page, [
        [
            [true, ""],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await page.keyboard.press("Backspace");

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeVisible();

    await expectTaskGridView(page, [
        [
            [true, ""],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await page
        .getByRole("alertdialog", {name: "Delete task?"})
        .getByRole("button", {name: "Delete"})
        .click();

    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await expectTaskGridView(page, []);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [
        [
            [true, ""],
            [
                [true, "child task 1"],
                [true, "child task 2"],
            ],
        ],
    ]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, []);
});

test("can update assignee", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1] = await runAllPromises([
        space.createSession({name: "Test1"}),
        space.createSession({name: "Test2"}),
    ]);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    const task = await TestTask.create(session1, {title: "test"});
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    // Hover over the cell to mount the input. For performance we don't initially mount
    // the input.
    await page.getByTestId(`TaskRowView:${task.id}`).getByTestId("TaskRowAssigneeCell").hover();

    await page.getByTestId(`TaskRowView:${task.id}`).getByLabel("Assignee").click();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test1"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test2"})).toBeVisible();

    await page.getByRole("option", {name: "Test1"}).click();

    await expectTaskGridView(page, [[true, "test", "Test1"]]);

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.getByTestId(`TaskRowView:${task.id}`).getByLabel("Assignee").click();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test1"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test2"})).toBeVisible();

    await page.getByRole("option", {name: "Test2"}).click();

    await expectTaskGridView(page, [[true, "test", "Test2"]]);

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.getByTestId(`TaskRowView:${task.id}`).getByLabel("Assignee").click();

    await expect(page.getByRole("option", {name: "Nobody"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test1"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Test2"})).toBeVisible();

    await page.getByRole("option", {name: "Nobody"}).click();

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByRole("option", {name: "Nobody"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test1"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Test2"})).toBeHidden();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "Test2"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "Test1"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test", "Test1"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test", "Test2"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test"]]);
});

test("can update priority", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    // Hover over the cell to mount the input. For performance we don't initially mount
    // the input.
    await page.getByTestId(`TaskRowView:${task.id}`).getByTestId("TaskRowPriorityCell").hover();

    await page.getByTestId(`TaskRowView:${task.id}`).getByLabel("Priority").click();

    await expect(page.getByRole("option", {name: "None"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Low"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Medium"})).toBeVisible();

    await page.getByRole("option", {name: "Low"}).click();

    await expectTaskGridView(page, [[true, "test", "", "Low"]]);

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.getByTestId(`TaskRowView:${task.id}`).getByLabel("Priority").click();

    await expect(page.getByRole("option", {name: "None"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Low"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Medium"})).toBeVisible();

    await page.getByRole("option", {name: "Medium"}).click();

    await expectTaskGridView(page, [[true, "test", "", "Medium"]]);

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.getByTestId(`TaskRowView:${task.id}`).getByLabel("Priority").click();

    await expect(page.getByRole("option", {name: "None"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Low"})).toBeVisible();
    await expect(page.getByRole("option", {name: "Medium"})).toBeVisible();

    await page.getByRole("option", {name: "None"}).click();

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "", "Medium"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "", "Low"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test", "", "Low"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test", "", "Medium"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test"]]);
});

test("can update due date", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByRole("option", {name: "None"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Low"})).toBeHidden();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    // Hover over the cell to mount the input. For performance we don't initially mount
    // the input.
    await page.getByTestId(`TaskRowView:${task.id}`).getByTestId("TaskRowDueDateCell").hover();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByLabel("Due date", {exact: true})
        .getByRole("spinbutton")
        .first()
        .click();

    await page.keyboard.type("7");
    await page.keyboard.type("12");
    await page.keyboard.type("1998");
    await page.keyboard.press("Escape");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/1998"]]);

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByLabel("Due date", {exact: true})
        .getByText("1998")
        .focus();

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/2000"]]);

    await page.getByRole("button", {name: "Clear"}).click();
    await page.locator("*:focus").blur();

    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).click();

    await expectTaskGridView(page, [[true, "test"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/2000"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/1999"]]);

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/1998"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/1999"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test", "", "", "7/12/2000"]]);

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [[true, "test"]]);
});

test("can change status", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Testerson"});
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session, {title: "test"});
    await task.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(
        `/s/${space.id}/tasks/collections/${collection.id}?filter=${encodeBase64(
            new Uint8Array(
                serializeTaskQueryFilters([
                    {
                        type: "DisplayStatus",
                        operation: {
                            type: "OneOf",
                            displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                        },
                    },
                ]),
            ),
        )}`,
    );

    await expectTaskGridView(page, [["OpenInactive", "test"]], {hasGhostTaskRow: false});

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeHidden();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByRole("textbox", {name: "Title"})
        .click({button: "right"});

    await expect(page.getByText("Mark active")).toBeVisible();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeVisible();

    await page.getByText("Mark active").click();

    await expectTaskGridView(page, [["OpenActive", "test", "Testerson"]], {hasGhostTaskRow: false});

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeHidden();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByRole("textbox", {name: "Title"})
        .click({button: "right"});

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeVisible();
    await expect(page.getByText("Mark closed")).toBeVisible();

    await page.getByText("Mark inactive").click();

    await expectTaskGridView(page, [["OpenInactive", "test", "Testerson"]], {
        hasGhostTaskRow: false,
    });

    await expect(page.getByText("Mark active")).toBeHidden();
    await expect(page.getByText("Mark inactive")).toBeHidden();
    await expect(page.getByText("Mark closed")).toBeHidden();

    await page.getByTestId("TaskStatusButton").click();

    await expectTaskGridView(page, [["Closed", "test", "Testerson"]], {hasGhostTaskRow: false});

    await page.getByTestId("TaskStatusButton").click();

    await expectTaskGridView(page, [["OpenInactive", "test", "Testerson"]], {
        hasGhostTaskRow: false,
    });

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [["Closed", "test", "Testerson"]], {hasGhostTaskRow: false});

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [["OpenInactive", "test", "Testerson"]], {
        hasGhostTaskRow: false,
    });

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [["OpenActive", "test", "Testerson"]], {hasGhostTaskRow: false});

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [["OpenInactive", "test"]], {hasGhostTaskRow: false});

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [["OpenActive", "test", "Testerson"]], {hasGhostTaskRow: false});

    await page.getByTestId("TaskStatusButton").click();

    await expectTaskGridView(page, [["Closed", "test", "Testerson"]], {hasGhostTaskRow: false});

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, [["Closed", "test", "Testerson"]], {hasGhostTaskRow: false});
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
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test1")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test2")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test3")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("+1")).toBeHidden();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByTestId("TaskRowCollectionsCell")
        .click({position: {x: 2, y: 2}});

    const overlayLocator = page.getByTestId("TaskRowCollectionsCellOverlay");

    await overlayLocator.getByLabel("Collections").focus();

    await page.keyboard.type("test2");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeVisible();
    await expect(overlayLocator.getByText("test3")).toBeHidden();
    await expect(overlayLocator.getByText("+1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test2")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test3")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("+1")).toBeHidden();

    await page.keyboard.press("Escape");
    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).click();

    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test1")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test2")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test3")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("+1")).toBeHidden();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByTestId("TaskRowCollectionsCell")
        .click({position: {x: 2, y: 2}});

    await overlayLocator.getByLabel("Collections").focus();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.type("test3");
    await page.keyboard.press("Enter");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeVisible();
    await expect(overlayLocator.getByText("test3")).toBeVisible();
    await expect(overlayLocator.getByText("+1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test2")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test3")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("+1")).toBeHidden();

    await page.keyboard.press("Escape");
    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).click();

    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test2")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test3")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("+1")).toBeVisible();

    await page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByTestId("TaskRowCollectionsCell")
        .click({position: {x: 2, y: 2}});

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeVisible();
    await expect(overlayLocator.getByText("test3")).toBeVisible();
    await expect(overlayLocator.getByText("+1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test1")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test2")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("test3")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task.id}`).getByText("+1")).toBeHidden();

    await overlayLocator.getByLabel("Remove").nth(1).click();

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeVisible();

    await overlayLocator.getByLabel("Remove").nth(1).click();

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await expectTaskGridView(page, [[true, "test"]]);

    await overlayLocator.getByLabel("Collections").focus();

    await page.keyboard.press("Backspace");

    await expectTaskGridView(page, []);

    await expect(overlayLocator.getByText("test1")).toBeHidden();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await page.keyboard.press("Control+z");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeVisible();

    await page.keyboard.press("Control+Shift+z");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await page.keyboard.press("Control+Shift+z");

    await expectTaskGridView(page, []);

    await expect(overlayLocator.getByText("test1")).toBeHidden();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await page.keyboard.press("Control+z");

    await expectTaskGridView(page, [[true, "test"]]);

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await page.keyboard.press("Control+z");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeVisible();

    await page.keyboard.press("Control+z");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeVisible();
    await expect(overlayLocator.getByText("test3")).toBeVisible();

    await page.keyboard.press("Control+z");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeVisible();
    await expect(overlayLocator.getByText("test3")).toBeHidden();

    await page.keyboard.press("Control+z");

    await expect(overlayLocator.getByText("test1")).toBeVisible();
    await expect(overlayLocator.getByText("test2")).toBeHidden();
    await expect(overlayLocator.getByText("test3")).toBeHidden();
});
