import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createTaskComment} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

const {context, services} = createTestServices();

test("can navigate to task comments and add comment from peek", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks`);

    await page.getByRole("button", {name: "Create", exact: true}).click();
    await page.getByRole("menuitem", {name: "Task"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();

    await page
        .getByTestId("PeekStack")
        .getByTestId("TaskDetailViewMain")
        .getByRole("textbox", {name: "Title"})
        .fill("new task");

    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskDetailViewMain").getByLabel("Title"),
    ).toHaveText("new task");

    await expect(page.getByTestId("PeekStackOverlay").getByLabel("New comment")).toBeHidden();

    await page.getByTestId("PeekStack").getByLabel("More").click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByTestId("PeekStackOverlay").getByLabel("New comment")).toBeVisible();
    await expect(page.getByTestId("PeekStackOverlay").getByLabel("New comment")).toHaveText("");
    await page
        .getByTestId("PeekStackOverlay")
        .getByLabel("New comment")
        .fill("Added task comment in new task");
    await expect(page.getByTestId("PeekStackOverlay").getByLabel("New comment")).toHaveText(
        "Added task comment in new task",
    );
    await page.getByTestId("PeekStackOverlay").getByLabel("Send comment").click();
    await expect(page.getByTestId("PeekStackOverlay").getByLabel("New comment")).toHaveText("");

    await expect(page.getByText("Added task comment in new task")).toBeVisible();
});

test("expanding task from peek opens task detail view", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session, {title: "unique task 1"});

    const content1 = createSimpleMessageContent("1st task comment");
    await createTaskComment(context.action(session), {
        taskId: task.id,
        parent: null,
        content: content1,
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await page.getByRole("button", {name: "Create", exact: true}).click();
    await page.getByRole("menuitem", {name: "Task"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();

    await page
        .getByTestId("PeekStack")
        .getByTestId("TaskDetailViewMain")
        .getByRole("textbox", {name: "Title"})
        .fill("new task");

    await expect(page.getByTestId("TaskDetailViewMain").getByText("unique task 1")).toBeVisible();

    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskDetailViewMain").getByLabel("Title"),
    ).toHaveText("new task");
    await page.getByLabel("Expand").click();

    await expect(page.getByTestId("TaskDetailViewMain").getByText("unique task 1")).toBeHidden();

    await page.getByLabel("More").click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await page.getByRole("button", {name: "Create", exact: true}).click();
    await page.getByRole("menuitem", {name: "More"}).hover();
    await page.getByRole("menuitem", {name: "Task view"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();
    await page.getByRole("button", {name: "Add"}).nth(1).click();

    await page
        .getByTestId("PeekStack")
        .getByTestId(/^TaskRowView:/)
        .getByLabel("Open")
        .first()
        .click();

    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskDetailViewMain").getByLabel("Title"),
    ).toHaveText("unique task 1");
    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskStatusButton"),
    ).toBeVisible();
    await expect(page.getByTestId("TaskDetailViewMain").getByText("new task")).toBeVisible();

    await page.getByLabel("Expand").click();

    await expect(page.getByTestId("PeekStackOverlay").getByTestId("TaskStatusButton")).toBeHidden();

    await page.getByLabel("More").click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(
        page.getByTestId("MessageViewContent").getByText("1st task comment"),
    ).toBeVisible();
    await expect(page.getByTestId("TaskDetailViewMain").getByText("unique task 1")).toBeVisible();
    await expect(page.getByTestId("TaskDetailViewMain").getByText("new task")).toBeHidden();
});

test("task comments are visible in task detail view and can add comments", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});
    const task = await TestTask.create(session, {title: "unique task 1"});

    const content1 = createSimpleMessageContent("1st task comment");
    await createTaskComment(context.action(session), {
        taskId: task.id,
        parent: null,
        content: content1,
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}?comments=show`);

    await expect(page.getByText("1st task comment")).toBeVisible();

    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText("");
    await page.getByRole("textbox", {name: "New comment"}).fill("Added task comment 1");
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Added task comment 1",
    );
    await page.getByRole("button", {name: "Send comment"}).click();
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText("");

    await expect(page.getByText("1st task comment")).toBeVisible();
    await expect(page.getByText("Added task comment 1")).toBeVisible();
});

test("mobile task comments route navigates to task detail view when window size change", async ({
    page,
    context: browserContext,
    viewport,
}) => {
    assert(viewport);
    const initialDesktopViewportWidth = viewport.width;

    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});
    const task = await TestTask.create(session, {title: "unique task 1"});

    const content1 = createSimpleMessageContent("1st task comment");
    await createTaskComment(context.action(session), {
        taskId: task.id,
        parent: null,
        content: content1,
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await ProcessContextModule.waitForTestTasks();

    await page.setViewportSize({width: mobilePlatformMaxWindowWidth, height: viewport.height});
    await services.signIn(browserContext, session);

    await page.goto(`/s/${space.id}/tasks/${task.id}?comments=show`);
    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();

    await page.getByLabel("More").click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByTestId("TaskStatusButton")).toBeHidden();
    await expect(page.getByText("unique task 1")).toBeVisible();
    await expect(page.getByText("Comments")).toBeVisible();
    await expect(page.getByText("1st task comment")).toBeVisible();

    await page.setViewportSize({width: initialDesktopViewportWidth, height: viewport.height});

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Comments")).toBeHidden();
    await expect(page.getByText("1st task comment")).toBeVisible();
});

test("comments will be hidden if task is opened with `?comments=show` search param but the actor only has view access", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);

    await task.addCollection(session1, collection);
    await collection.access.grant(session1, session2, "View");

    await task.createComment(session1, "Test task comment");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/${task.id}?comments=show`);

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment")).toBeHidden();
});

test("if comments were open on a task then if the user navigates back to the task they\u2019ll be opened again", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const collection = await TestTaskCollection.create(session1);

    const task1 = await TestTask.create(session1, {title: "Test task 1"});
    const task2 = await TestTask.create(session1, {title: "Test task 2"});
    const task3 = await TestTask.create(session1, {title: "Test task 3"});

    await collection.access.grantDefault(session1);
    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await task1.createComment(session1, "Test task comment 1");
    await task2.createComment(session1, "Test task comment 2");
    await task3.createComment(session1, "Test task comment 3");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await page
        .getByTestId(`TaskRowView:${task1.id}`)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Expand"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeHidden();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeVisible();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeHidden();

    await page.goBack();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeVisible();

    await page
        .getByTestId(`TaskRowView:${task2.id}`)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Expand"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeHidden();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 2")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeHidden();

    await page.goBack();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeVisible();

    await page
        .getByTestId(`TaskRowView:${task1.id}`)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Expand"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeVisible();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeHidden();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeHidden();

    await page.goBack();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByTestId(`TaskRowView:${task1.id}`)).toBeVisible();

    await page
        .getByTestId(`TaskRowView:${task1.id}`)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeVisible();

    await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Expand"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeHidden();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("Test task comment 1")).toBeVisible();
    await expect(page.getByText("Test task comment 2")).toBeHidden();
    await expect(page.getByText("Test task comment 3")).toBeHidden();
});
