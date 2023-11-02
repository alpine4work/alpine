import {test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assert} from "~/shared/helpers/control/assert.js";

const context = createTestContext({shouldStartOpensearch: true});
const services = createTestServices(context);

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
                [true, "This won't be a subtask"],
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
        [true, "This won't be a subtask"],
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
        [true, "This won't be a subtask"],
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
        [true, "This won't be a subtask"],
        [true, ""],
        [true, "Yet another task"],
    ]);
});
