import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assert} from "~/shared/helpers/control/assert.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

const {context, services} = createTestServices();

test("can create tasks in notepad", async ({page, context: browserContext, viewport}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks`);

    await page
        .getByTestId("TaskNotepadView")
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    await expectTaskGridView(page, []);

    await page.keyboard.type("This is a task");

    await expectTaskGridView(page, [[true, "This is a task"]]);

    await page.keyboard.press("Enter");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [true, ""],
    ]);

    await page.keyboard.type("This is another task");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [true, "This is another task"],
    ]);

    await page.keyboard.press("Enter");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [true, "This is another task"],
        [true, ""],
    ]);

    await page.keyboard.press("Tab");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [[true, "This is another task"], [[true, ""]]],
    ]);

    await page.keyboard.type("This is a subtask, cool");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [[true, "This is another task"], [[true, "This is a subtask, cool"]]],
    ]);

    await page.keyboard.press("Enter");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, ""],
            ],
        ],
    ]);

    await page.keyboard.type("This is subtask 2");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
            ],
        ],
    ]);

    await page.keyboard.press("Enter");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
                [true, ""],
            ],
        ],
    ]);

    await page.keyboard.type("This won't be a subtask");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
                [true, "This won’t be a subtask"],
            ],
        ],
    ]);

    await page.keyboard.press("Shift+Tab");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
            ],
        ],
        [true, "This won’t be a subtask"],
    ]);

    await page
        .getByTestId("TaskNotepadView")
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    await page.keyboard.press("Enter");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
            ],
        ],
        [true, "This won’t be a subtask"],
        [true, ""],
    ]);

    await page.keyboard.type("Yet another task");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
            ],
        ],
        [true, "This won’t be a subtask"],
        [true, ""],
        [true, "Yet another task"],
    ]);

    await page.keyboard.press(`${modifier}+ArrowLeft`);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
            ],
        ],
        [true, "This won’t be a subtask"],
        [true, ""],
        [true, ""],
        [true, "Yet another task"],
    ]);

    await page.keyboard.type("Some task above wow");

    await expectTaskGridView(page, [
        [true, "This is a task"],
        [
            [true, "This is another task"],
            [
                [true, "This is a subtask, cool"],
                [true, "This is subtask 2"],
            ],
        ],
        [true, "This won’t be a subtask"],
        [true, ""],
        [true, "Some task above wow"],
        [true, "Yet another task"],
    ]);
});

test("can create new notepad pages", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks`);

    await expectTaskGridView(page, []);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(1);
    await expect(page.getByText("test1a")).toBeHidden();
    await expect(page.getByText("test2a")).toBeHidden();

    await page.getByRole("textbox", {name: "Title"}).click();

    await page.keyboard.type("test1a");
    await page.keyboard.press("Enter");
    await page.keyboard.type("test1b");
    await page.keyboard.press("Enter");
    await page.keyboard.type("test1c");

    await expectTaskGridView(page, [
        [true, "test1a"],
        [true, "test1b"],
        [true, "test1c"],
    ]);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(4);
    await expect(page.getByText("test1a")).toBeVisible();
    await expect(page.getByText("test2a")).toBeHidden();

    await page.getByRole("button", {name: "Fresh page"}).click();

    await expectTaskGridView(page, []);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(1);
    await expect(page.getByText("test1a")).toBeHidden();
    await expect(page.getByText("test2a")).toBeHidden();

    await page.getByRole("textbox", {name: "Title"}).click();

    await page.keyboard.type("test2a");
    await page.keyboard.press("Enter");
    await page.keyboard.type("test2b");
    await page.keyboard.press("Enter");
    await page.keyboard.type("test2c");

    await expectTaskGridView(page, [
        [true, "test2a"],
        [true, "test2b"],
        [true, "test2c"],
    ]);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(4);
    await expect(page.getByText("test1a")).toBeHidden();
    await expect(page.getByText("test2a")).toBeVisible();

    await page.evaluate("dev.tasks.store.waitForCommitTaskActionTransactions()");
    await page.reload();

    await expectTaskGridView(page, [
        [true, "test2a"],
        [true, "test2b"],
        [true, "test2c"],
    ]);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(4);
    await expect(page.getByText("test1a")).toBeHidden();
    await expect(page.getByText("test2a")).toBeVisible();

    await page.getByRole("button", {name: "Pages"}).click();
    await page.getByRole("menuitem").last().click();

    await expectTaskGridView(page, [
        [true, "test1a"],
        [true, "test1b"],
        [true, "test1c"],
    ]);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(4);
    await expect(page.getByText("test1a")).toBeVisible();
    await expect(page.getByText("test2a")).toBeHidden();

    await page.reload();

    await expectTaskGridView(page, [
        [true, "test1a"],
        [true, "test1b"],
        [true, "test1c"],
    ]);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(4);
    await expect(page.getByText("test1a")).toBeVisible();
    await expect(page.getByText("test2a")).toBeHidden();

    await page.goto(`/s/${space.id}/tasks`);

    await expectTaskGridView(page, [
        [true, "test2a"],
        [true, "test2b"],
        [true, "test2c"],
    ]);

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(4);
    await expect(page.getByText("test1a")).toBeHidden();
    await expect(page.getByText("test2a")).toBeVisible();
});
