import {CalendarDate} from "@internationalized/date";
import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    getTaskCollectionIndexDocIfExistsForTest,
    getTaskIndexDocIfExistsForTest,
} from "~/server/tasks/data/task_index.js";
import {getTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {getTaskTitleText} from "~/shared/tasks/title/task_title.js";

const {context, services} = createTestServices();

async function waitForSavingIndicatorAndReloadPage(page: Page) {
    // Wait for the saving indicator to disappear before reloading the page. To
    // make sure our update has actually made it to the server.
    await page.evaluate("dev.globalLoadingIndicator.waitForSavingIndicator()");

    await page.reload();
}

test("can create task by clicking the status button", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const statusLocator = page.getByTestId("TaskStatusButton");

    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeHidden();

    await statusLocator.click();

    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeHidden();

    await expect(page).not.toHaveURL(/[?&]create/);

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeHidden();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeHidden();

    await expect(async () => {
        expect(
            await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
        ).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        type: "Closed",
                        closer: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
            }),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeHidden();
});

test("can create task by typing in the task title", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const titleLocator = page.getByTestId("TaskDetailViewMain").getByLabel("Title");

    await expect(titleLocator).not.toHaveText("foobar");

    await titleLocator.click();
    await titleLocator.pressSequentially("foobar");

    await expect(titleLocator).toHaveText("foobar");

    await expect(page).not.toHaveURL(/[?&]create/);

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expect(titleLocator).not.toHaveText("foobar");

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expect(titleLocator).toHaveText("foobar");

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );

        expect(getTaskTitleText(assertExists(task).title.raw)).toEqual("foobar");
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(titleLocator).toHaveText("foobar");
});

test("can create task by changing assignee", async ({page, context: browserContext, isMobile}) => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "foo"});
    const session2 = await space.createSession({name: "bar"});

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const assigneeLocator = page.getByTestId("TaskAssigneeInput");

    await expect(assigneeLocator).toContainText("foo");

    await page.getByText("Assignee").click();
    await page.getByRole("option", {name: "bar"}).click();
    await expect(page.getByRole("option", {name: "bar"})).toBeHidden();

    await expect(assigneeLocator).toContainText("bar");

    await expect(page).not.toHaveURL(/[?&]create/);

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expect(assigneeLocator).toContainText("foo");

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expect(assigneeLocator).toContainText("bar");

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session1.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session2.account.id}),
                        assigner: expect.objectContaining({accountId: session1.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(assigneeLocator).toContainText("bar");
});

test("can create task by adding collection", async ({page, context: browserContext, isMobile}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const collectionLocator = page.getByTestId("TaskCollectionsInput").getByText("foobar");

    await expect(collectionLocator).toBeHidden();

    await page.getByLabel("Collections").click();
    await page.getByRole("option", {name: "Create collection"}).click();
    await page.getByPlaceholder("Name").fill("foobar");

    await expect(page).toHaveURL(/[?&]create/);

    await page.getByPlaceholder("Name").press("Enter");

    await expect(collectionLocator).toBeVisible();

    await expect(page).not.toHaveURL(/[?&]create/);

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expect(collectionLocator).toBeHidden();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expect(collectionLocator).toBeVisible();

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );

        const collections = assertExists(task).collections.raw.collections;

        expect(collections.getArray().length).toEqual(1);

        const collection = await getTaskCollectionIndexDocIfExistsForTest(
            context,
            space.id,
            collections.getArray()[0]!.collectionId,
            {realtime: true},
        );

        expect(collection).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                name: expect.objectContaining({value: "foobar"}),
            }),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(collectionLocator).toBeVisible();
});

test("can create task by adding priority", async ({page, context: browserContext, isMobile}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const priorityLocator = page.getByPlaceholder("Medium");

    await expect(priorityLocator).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Add priority"}).click();

    await expect(page).toHaveURL(/[?&]create/);

    await page.getByRole("option", {name: "Medium"}).click();
    await expect(page.getByRole("option", {name: "Medium"})).toBeHidden();

    await expect(priorityLocator).toBeVisible();

    await expect(page).not.toHaveURL(/[?&]create/);

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expect(priorityLocator).toBeHidden();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expect(priorityLocator).toBeVisible();

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
                priority: expect.objectContaining({
                    value: "Medium",
                }),
            }),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(priorityLocator).toBeVisible();
});

test("can create task by adding due date", async ({page, context: browserContext, isMobile}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    // HACK(calebmer): There's some time zone weirdness going on here I'm not going
    // to debug right now.
    const dueDateLocator = page.getByText(/Yesterday|Today|Tomorrow/);

    await expect(dueDateLocator).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Add due date"}).click();

    await expect(page).toHaveURL(/[?&]create/);

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+;`);

    await expect(page).not.toHaveURL(/[?&]create/);

    await page.keyboard.press("Escape");

    await expect(dueDateLocator).toBeVisible();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);
    await page.keyboard.press("Escape");

    await expect(dueDateLocator).toBeHidden();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);
    await page.keyboard.press("Escape");

    await expect(dueDateLocator).toBeVisible();

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );

        expect(assertExists(task).dueDate.value).toBeInstanceOf(CalendarDate);
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(dueDateLocator).toBeVisible();
});

test("can create task by updating notes", async ({isMobile, page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const notesLocator = page.getByText("foobar");

    await expect(notesLocator).toBeHidden();

    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).pressSequentially("foobar");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(notesLocator).toBeVisible();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expect(notesLocator).toBeHidden();

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expect(notesLocator).toBeVisible();

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );

        expect((await getTaskNotesContent(session.action(), taskId)).content.doc.toJSON()).toEqual(
            TaskNotesContentProsemirrorSchema.node("doc", null, [
                TaskNotesContentProsemirrorSchema.node("paragraph", null, [
                    TaskNotesContentProsemirrorSchema.text("foobar"),
                ]),
            ]).toJSON(),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expect(notesLocator).toBeVisible();
});

test("can create task by typing subtask title", async ({
    isMobile,
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    await expectTaskGridView(page, [], {withoutColumns: true});

    if (isMobile) {
        await page.getByTestId("TaskRowTitleCell").getByLabel("Title").tap();
    } else {
        await page.getByTestId("TaskRowTitleCell").getByLabel("Title").click();
    }
    await page.getByTestId("TaskRowTitleCell").getByLabel("Title").fill("foobar");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expectTaskGridView(page, [[true, "foobar"]], {withoutColumns: true});

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expectTaskGridView(page, [], {withoutColumns: true});

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expectTaskGridView(page, [[true, "foobar"]], {withoutColumns: true});

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
                addedChildTaskCount: 2,
                removedChildTaskCount: 1,
            }),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expectTaskGridView(page, [[true, "foobar"]], {withoutColumns: true});
});

test("can create task by hitting enter in ghost subtask", async ({
    isMobile,
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    await expectTaskGridView(page, [], {withoutColumns: true});

    if (isMobile) {
        await page.getByTestId("TaskRowTitleCell").getByLabel("Title").tap();
    } else {
        await page.getByTestId("TaskRowTitleCell").getByLabel("Title").click();
    }
    await page.getByTestId("TaskRowTitleCell").getByLabel("Title").press("Enter");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expectTaskGridView(page, [[true, ""]], {withoutColumns: true});

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+z`);

    await expectTaskGridView(page, [], {withoutColumns: true});

    await page.keyboard.press(`${isMobile ? "Meta" : "ControlOrMeta"}+Shift+z`);

    await expectTaskGridView(page, [[true, ""]], {withoutColumns: true});

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
                addedChildTaskCount: 2,
                removedChildTaskCount: 1,
            }),
        );
    }).toPass({timeout: 5000});

    await waitForSavingIndicatorAndReloadPage(page);

    await expectTaskGridView(page, [[true, ""]], {withoutColumns: true});
});

test("can create initially closed task", async ({isMobile, page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "foo"});

    const taskId = generateId<TaskId>();

    const createSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "DisplayStatus",
            operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
        },
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create=${createSearchParam}`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const statusLocator = page.getByTestId("TaskStatusButton");

    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeHidden();

    // Create task by typing in notes.
    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).press("x");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Open"})).toBeHidden();

    await expect(async () => {
        expect(
            await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
        ).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({value: null}),
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        type: "Closed",
                        closer: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
            }),
        );
    }).toPass({timeout: 5000});
});

test("can create initially active task", async ({isMobile, page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "foo"});

    const taskId = generateId<TaskId>();

    const createSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "DisplayStatus",
            operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
        },
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create=${createSearchParam}`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const statusLocator = page.getByTestId("TaskStatusButton");
    const assigneeLocator = page.getByTestId("TaskAssigneeInput");

    await expect(statusLocator.getByRole("img", {name: "Open (active)"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeHidden();
    await expect(assigneeLocator).toContainText("foo");

    // Create task by typing in notes.
    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).press("x");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(statusLocator.getByRole("img", {name: "Open (active)"})).toBeVisible();
    await expect(statusLocator.getByRole("img", {name: "Closed"})).toBeHidden();
    await expect(assigneeLocator).toContainText("foo");

    await expect(async () => {
        expect(
            await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
        ).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session.account.id}),
                        assigner: expect.objectContaining({accountId: session.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        type: "Open",
                    }),
                }),
                rawAssigneeStatus: expect.objectContaining({
                    value: expect.objectContaining({
                        type: "Active",
                    }),
                }),
            }),
        );
    }).toPass({timeout: 5000});
});

test("can create task with initial collection", async ({
    isMobile,
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const collection = await TestTaskCollection.create(session, {name: "foobar"});

    const taskId = generateId<TaskId>();

    const createSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {type: "IncludesAllOf", collectionIds: new Set([collection.id])},
        },
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create=${createSearchParam}`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const collectionLocator = page.getByTestId("TaskCollectionsInput").getByText("foobar");

    await expect(collectionLocator).toBeVisible();

    // Create task by typing in notes.
    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).press("x");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(collectionLocator).toBeVisible();

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: null,
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );

        const collections = assertExists(task).collections.raw.collections;

        expect(collections.has(collection.id)).toEqual(true);
        expect(collections.getArray().length).toEqual(1);
    }).toPass({timeout: 5000});
});

test("can create task with initial priority", async ({isMobile, page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    const createSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Priority",
            operation: {type: "OneOf", priorities: new Set(["Medium"])},
        },
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create=${createSearchParam}`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const priorityLocator = page.getByPlaceholder("Medium");

    await expect(priorityLocator).toBeVisible();

    // Create task by typing in notes.
    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).press("x");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(priorityLocator).toBeVisible();

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: null,
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
                priority: expect.objectContaining({
                    value: "Medium",
                }),
            }),
        );
    }).toPass({timeout: 5000});
});

test("can create task with initial title", async ({isMobile, page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const taskId = generateId<TaskId>();

    const createSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Title",
            operation: {type: "Includes", titleQuery: "foobar"},
        },
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create=${createSearchParam}`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const titleLocator = page.getByTestId("TaskDetailViewMain").getByLabel("Title");

    await expect(titleLocator).toHaveText("foobar");

    // Create task by typing in notes.
    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).press("x");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(titleLocator).toHaveText("foobar");

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session.account.id}),
                assignee: expect.objectContaining({
                    value: null,
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );

        expect(getTaskTitleText(assertExists(task).title.raw)).toEqual("foobar");
    }).toPass({timeout: 5000});
});

test("can create task with initial assignee", async ({isMobile, page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "foo"});
    const session2 = await space.createSession({name: "bar"});

    const taskId = generateId<TaskId>();

    const createSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Assignee",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", accountId: session2.account.id}],
            },
        },
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/tasks/${taskId}?create=${createSearchParam}`);

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {realtime: true}),
    ).toEqual(null);

    await expect(page).toHaveURL(/[?&]create/);

    const assigneeLocator = page.getByTestId("TaskAssigneeInput");

    await expect(assigneeLocator).toContainText("bar");

    // Create task by typing in notes.
    if (isMobile) {
        await page.getByRole("textbox", {name: "Notes"}).tap();
    } else {
        await page.getByRole("textbox", {name: "Notes"}).click();
    }
    await page.getByRole("textbox", {name: "Notes"}).press("x");

    await expect(page).not.toHaveURL(/[?&]create/);

    await expect(assigneeLocator).toContainText("bar");

    await expect(async () => {
        const task = await getTaskIndexDocIfExistsForTest(context, space.id, taskId, {
            realtime: true,
        });

        expect(task).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                creator: expect.objectContaining({accountId: session1.account.id}),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: expect.objectContaining({accountId: session2.account.id}),
                        assigner: expect.objectContaining({accountId: session1.account.id}),
                    }),
                }),
                status: expect.objectContaining({
                    value: expect.objectContaining({type: "Open"}),
                }),
            }),
        );
    }).toPass({timeout: 5000});
});
