import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";

const {context, services} = createTestServices();

test("can paste a formatted list and it will create tasks in empty collection", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, []);

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4"],
    ]);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(page, [
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task X"],
    ]);

    await expect(page.getByText("Task X")).toBeVisible();
    await expect(page.getByText("Task 4")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 4")).toBeVisible();
    await expect(page.getByText("Task X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, []);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4"],
    ]);
});

test("can paste a formatted list and it will create tasks at the end of the collection", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const taskA = await TestTask.create(session, {title: "Task A"});
    const taskB = await TestTask.create(session, {title: "Task B"});
    const taskC = await TestTask.create(session, {title: "Task C"});

    await taskA.addCollection(session, collection);
    await taskB.addCollection(session, collection);
    await taskC.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "Task A"],
        [true, "Task B"],
        [true, "Task C"],
    ]);

    await page
        .getByTestId(/^TaskRowView:/)
        .last()
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "Task A"],
        [true, "Task B"],
        [true, "Task C"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4"],
    ]);

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, [
        [true, "Task A"],
        [true, "Task B"],
        [true, "Task C"],
    ]);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [true, "Task A"],
        [true, "Task B"],
        [true, "Task C"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4"],
    ]);
});

test("can paste a formatted list and it will create tasks in the middle of a collection", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const beforeTask = await TestTask.create(session, {title: "BEFORE"});
    const task = await TestTask.create(session, {title: ""});
    const afterTask = await TestTask.create(session, {title: "AFTER"});

    await beforeTask.addCollection(session, collection);
    await task.addCollection(session, collection);
    await afterTask.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, ""],
        [true, "AFTER"],
    ]);

    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4"],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task X"],
        [true, "AFTER"],
    ]);

    await expect(page.getByText("Task X")).toBeVisible();
    await expect(page.getByText("Task 4")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 4")).toBeVisible();
    await expect(page.getByText("Task X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, ""],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4"],
        [true, "AFTER"],
    ]);
});

test("can paste a formatted list and it will create tasks in the middle of a collection in task with text", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const beforeTask = await TestTask.create(session, {title: "BEFORE"});
    const task = await TestTask.create(session, {title: ""});
    const afterTask = await TestTask.create(session, {title: "AFTER"});

    await beforeTask.addCollection(session, collection);
    await task.addCollection(session, collection);
    await afterTask.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, ""],
        [true, "AFTER"],
    ]);

    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).click();

    await page.keyboard.press("[");
    await page.keyboard.press("[");

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "[[Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4]]"],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "[[Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task X]]"],
        [true, "AFTER"],
    ]);

    await expect(page.getByText("Task X")).toBeVisible();
    await expect(page.getByText("Task 4")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 4")).toBeVisible();
    await expect(page.getByText("Task X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, "[[]]"],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "[[Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[true, "Task 3.1"]]],
        [true, "Task 4]]"],
        [true, "AFTER"],
    ]);
});

test("can paste a formatted list and it will create tasks in an already nested task", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const beforeTask = await TestTask.create(session, {title: "BEFORE"});
    const parentTask = await TestTask.create(session, {title: "PARENT"});
    const afterTask = await TestTask.create(session, {title: "AFTER"});

    await beforeTask.addCollection(session, collection);
    await parentTask.addCollection(session, collection);
    await afterTask.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, "PARENT"],
        [true, "AFTER"],
    ]);

    await page
        .getByTestId(`TaskRowView:${parentTask.id}`)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [[true, "PARENT"], [[true, ""]]],
        [true, "AFTER"],
    ]);

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "PARENT"],
            [
                [
                    [true, "Task 1"],
                    [
                        [true, "Task 1.1"],
                        [
                            [true, "Task 1.2"],
                            [
                                [true, "Task 1.2.1"],
                                [true, "Task 1.2.2"],
                            ],
                        ],
                        [true, "Task 1.3"],
                    ],
                ],
                [true, "Task 2"],
                [[true, "Task 3"], [[true, "Task 3.1"]]],
                [true, "Task 4"],
            ],
        ],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [[true, "PARENT"], [[true, ""]]],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "PARENT"],
            [
                [
                    [true, "Task 1"],
                    [
                        [true, "Task 1.1"],
                        [
                            [true, "Task 1.2"],
                            [
                                [true, "Task 1.2.1"],
                                [true, "Task 1.2.2"],
                            ],
                        ],
                        [true, "Task 1.3"],
                    ],
                ],
                [true, "Task 2"],
                [[true, "Task 3"], [[true, "Task 3.1"]]],
                [true, "Task 4"],
            ],
        ],
        [true, "AFTER"],
    ]);
});

test("can paste a formatted list and it will create tasks when last pasted task is a child", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const beforeTask = await TestTask.create(session, {title: "BEFORE"});
    const task = await TestTask.create(session, {title: ""});
    const afterTask = await TestTask.create(session, {title: "AFTER"});

    await beforeTask.addCollection(session, collection);
    await task.addCollection(session, collection);
    await afterTask.addCollection(session, collection);

    await beforeTask.updateCollectionPosition(session, collection, {
        orderTime: beforeTask.createdTime,
        orderKey: initialOrderKey,
    });

    await task.updateCollectionPosition(session, collection, {
        orderTime: task.createdTime,
        orderKey: initialOrderKey,
    });

    await afterTask.updateCollectionPosition(session, collection, {
        orderTime: afterTask.createdTime,
        orderKey: initialOrderKey,
    });

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, ""],
        [true, "AFTER"],
    ]);

    await page.getByTestId(`TaskRowView:${task.id}`).getByRole("textbox", {name: "Title"}).click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>
                Task 3.1
                <ul>
                    <li>Task 3.1.1</li>
                </ul>
            </li>
        </ul>
    </li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[[true, "Task 3.1"], [[true, "Task 3.1.1"]]]]],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[[true, "Task 3.1"], [[true, "Task 3.1.X"]]]]],
        [true, "AFTER"],
    ]);

    await expect(page.getByText("Task 3.1.X")).toBeVisible();
    await expect(page.getByText("Task 3.1.1")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 3.1.1")).toBeVisible();
    await expect(page.getByText("Task 3.1.X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, ""],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "Task 1"],
            [
                [true, "Task 1.1"],
                [
                    [true, "Task 1.2"],
                    [
                        [true, "Task 1.2.1"],
                        [true, "Task 1.2.2"],
                    ],
                ],
                [true, "Task 1.3"],
            ],
        ],
        [true, "Task 2"],
        [[true, "Task 3"], [[[true, "Task 3.1"], [[true, "Task 3.1.1"]]]]],
        [true, "AFTER"],
    ]);
});

test("can paste a formatted list and it will create tasks in an already nested task when last pasted task is a child", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const beforeTask = await TestTask.create(session, {title: "BEFORE"});
    const parentTask = await TestTask.create(session, {title: "PARENT"});
    const afterTask = await TestTask.create(session, {title: "AFTER"});

    await beforeTask.addCollection(session, collection);
    await parentTask.addCollection(session, collection);
    await afterTask.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, "PARENT"],
        [true, "AFTER"],
    ]);

    await page
        .getByTestId(`TaskRowView:${parentTask.id}`)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [[true, "PARENT"], [[true, ""]]],
        [true, "AFTER"],
    ]);

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>
                Task 3.1
                <ul>
                    <li>Task 3.1.1</li>
                </ul>
            </li>
        </ul>
    </li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "PARENT"],
            [
                [
                    [true, "Task 1"],
                    [
                        [true, "Task 1.1"],
                        [
                            [true, "Task 1.2"],
                            [
                                [true, "Task 1.2.1"],
                                [true, "Task 1.2.2"],
                            ],
                        ],
                        [true, "Task 1.3"],
                    ],
                ],
                [true, "Task 2"],
                [[true, "Task 3"], [[[true, "Task 3.1"], [[true, "Task 3.1.1"]]]]],
            ],
        ],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "PARENT"],
            [
                [
                    [true, "Task 1"],
                    [
                        [true, "Task 1.1"],
                        [
                            [true, "Task 1.2"],
                            [
                                [true, "Task 1.2.1"],
                                [true, "Task 1.2.2"],
                            ],
                        ],
                        [true, "Task 1.3"],
                    ],
                ],
                [true, "Task 2"],
                [[true, "Task 3"], [[[true, "Task 3.1"], [[true, "Task 3.1.X"]]]]],
            ],
        ],
        [true, "AFTER"],
    ]);

    await expect(page.getByText("Task 3.1.X")).toBeVisible();
    await expect(page.getByText("Task 3.1.1")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 3.1.1")).toBeVisible();
    await expect(page.getByText("Task 3.1.X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [[true, "PARENT"], [[true, ""]]],
        [true, "AFTER"],
    ]);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "PARENT"],
            [
                [
                    [true, "Task 1"],
                    [
                        [true, "Task 1.1"],
                        [
                            [true, "Task 1.2"],
                            [
                                [true, "Task 1.2.1"],
                                [true, "Task 1.2.2"],
                            ],
                        ],
                        [true, "Task 1.3"],
                    ],
                ],
                [true, "Task 2"],
                [[true, "Task 3"], [[[true, "Task 3.1"], [[true, "Task 3.1.1"]]]]],
            ],
        ],
        [true, "AFTER"],
    ]);
});

test("pasting child tasks in an expanded parent gives each pasted child a unique parent order key", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    const beforeTask = await TestTask.create(session, {title: "BEFORE"});
    const parentTask = await TestTask.create(session, {title: "PARENT"});
    const afterTask = await TestTask.create(session, {title: "AFTER"});

    await beforeTask.addCollection(session, collection);
    await parentTask.addCollection(session, collection);
    await afterTask.addCollection(session, collection);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [true, "PARENT"],
        [true, "AFTER"],
    ]);

    await page
        .getByTestId(`TaskRowView:${parentTask.id}`)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [[true, "PARENT"], [[true, ""]]],
        [true, "AFTER"],
    ]);

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>Task 1</li>
    <li>Task 2</li>
    <li>Task 3</li>
    <li>Task 4</li>
    <li>Task 5</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(page, [
        [true, "BEFORE"],
        [
            [true, "PARENT"],
            [
                [true, "Task 1"],
                [true, "Task 2"],
                [true, "Task 3"],
                [true, "Task 4"],
                [true, "Task 5"],
            ],
        ],
        [true, "AFTER"],
    ]);

    const pastedChildTaskIds: Array<TaskId> = [];
    for (const taskRowIndex of [2, 3, 4, 5, 6]) {
        const rowTestId = await page
            .getByTestId(/^TaskRowView:/)
            .nth(taskRowIndex)
            .getAttribute("data-testid");
        pastedChildTaskIds.push(assertExists(rowTestId).replace(/^TaskRowView:/, "") as TaskId);
    }

    await expect(async () => {
        const pastedChildOrderKeys: Array<string> = [];

        for (const pastedChildTaskId of pastedChildTaskIds) {
            const taskDoc = assertExists(
                await getTaskIndexDocIfExistsForTest(context, space.id, pastedChildTaskId, {
                    realtime: true,
                }),
            );

            expect(taskDoc.parent.taskId.value).toEqual(parentTask.id);
            pastedChildOrderKeys.push(taskDoc.parent.rawPosition.value.orderKey);
        }

        // Make sure all the child order keys are unique.
        expect(new Set(pastedChildOrderKeys).size).toEqual(pastedChildOrderKeys.length);
    }).toPass({timeout: 5000});
});

test("can paste a formatted list and it will create tasks in a detail view\u2019s subtasks", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expectTaskGridView(page, []);

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
            [true, "Task 4"],
        ],
        {withoutColumns: true},
    );

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
            [true, "Task X"],
        ],
        {withoutColumns: true},
    );

    await expect(page.getByText("Task X")).toBeVisible();
    await expect(page.getByText("Task 4")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 4")).toBeVisible();
    await expect(page.getByText("Task X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, []);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
            [true, "Task 4"],
        ],
        {withoutColumns: true},
    );
});

test("can paste a formatted list and it will create tasks in a detail view’s subtasks when the last pasted task is a child", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session);

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expectTaskGridView(page, []);

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
        ],
        {withoutColumns: true},
    );

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.X"]]],
        ],
        {withoutColumns: true},
    );

    await expect(page.getByText("Task 3.X")).toBeVisible();
    await expect(page.getByText("Task 3.1")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 3.1")).toBeVisible();
    await expect(page.getByText("Task 3.X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, []);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
        ],
        {withoutColumns: true},
    );
});

test("can paste a formatted list and it will create tasks in personal task view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks`);

    await expectTaskGridView(page, []);

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
    <li>Task 4</li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
            [true, "Task 4"],
        ],
        {withoutColumns: true},
    );

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
            [true, "Task X"],
        ],
        {withoutColumns: true},
    );

    await expect(page.getByText("Task X")).toBeVisible();
    await expect(page.getByText("Task 4")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 4")).toBeVisible();
    await expect(page.getByText("Task X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, []);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
            [true, "Task 4"],
        ],
        {withoutColumns: true},
    );
});

test("can paste a formatted list and it will create tasks in personal task view when the last pasted task is a child", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks`);

    await expectTaskGridView(page, []);

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>
        Task 1
        <ul>
            <li>Task 1.1</li>
            <li>
                Task 1.2
                <ul>
                    <li>Task 1.2.1</li>
                    <li>Task 1.2.2</li>
                </ul>
            </li>
            <li>Task 1.3</li>
        </ul>
    </li>
    <li>Task 2</li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
        ],
        {withoutColumns: true},
    );

    await page.keyboard.press("Backspace");
    await page.keyboard.press("X");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.X"]]],
        ],
        {withoutColumns: true},
    );

    await expect(page.getByText("Task 3.X")).toBeVisible();
    await expect(page.getByText("Task 3.1")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByText("Task 3.1")).toBeVisible();
    await expect(page.getByText("Task 3.X")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");

    await expectTaskGridView(page, []);

    await page.keyboard.press("ControlOrMeta+Shift+z");

    await expectTaskGridView(
        page,
        [
            [
                [true, "Task 1"],
                [
                    [true, "Task 1.1"],
                    [
                        [true, "Task 1.2"],
                        [
                            [true, "Task 1.2.1"],
                            [true, "Task 1.2.2"],
                        ],
                    ],
                    [true, "Task 1.3"],
                ],
            ],
            [true, "Task 2"],
            [[true, "Task 3"], [[true, "Task 3.1"]]],
        ],
        {withoutColumns: true},
    );
});

test("can paste a formatted list in the middle of existing task text in personal task view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await ProcessContextModule.waitForTestTasks();

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks`);

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .click();

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .fill("aaabbb");

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .nth(0)
        .press("ArrowLeft");

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .nth(0)
        .press("ArrowLeft");

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .nth(0)
        .press("ArrowLeft");

    await page
        .getByTestId(/^TaskRowView:/)
        .getByRole("textbox", {name: "Title"})
        .nth(0)
        .press("x");

    await expectTaskGridView(page, [[true, "aaaxbbb"]], {withoutColumns: true});

    await page.evaluate(async () => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob(
                    [
                        `\
<ul>
    <li>Task 1</li>
    <li>
        Task 2
        <ul>
            <li>Task 2.1</li>
            <li>Task 2.2</li>
            <li>Task 2.3</li>
        </ul>
    </li>
    <li>
        Task 3
        <ul>
            <li>Task 3.1</li>
        </ul>
    </li>
</ul>
`,
                    ],
                    {type: "text/html"},
                ),
            }),
        ]);
    });

    await page.keyboard.press("ControlOrMeta+v");

    await expectTaskGridView(
        page,
        [
            [true, "aaaxTask 1"],
            [
                [true, "Task 2"],
                [
                    [true, "Task 2.1"],
                    [true, "Task 2.2"],
                    [true, "Task 2.3"],
                ],
            ],
            [[true, "Task 3"], [[true, "Task 3.1bbb"]]],
        ],
        {withoutColumns: true},
    );
});
