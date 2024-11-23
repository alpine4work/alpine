import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createTaskComment} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const {context, services} = createTestServices();

test("can navigate to task comments and add comment from peek", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}`);

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Task"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();

    await page.getByTestId("PeekStack").getByRole("textbox", {name: "Title"}).fill("new task");

    await page
        .getByTestId("PeekStack")
        .getByTestId(/^TaskRowView:/)
        .getByLabel("Open")
        .first()
        .click();

    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskDetailViewMain").getByLabel("Title"),
    ).toHaveText("new task");

    await expect(page.getByTestId("PeekStackOverlay").getByLabel("New comment")).toBeHidden();

    await page.getByLabel("Open comments").click();

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
        parentCommentIndex: null,
        content: content1,
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Task"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();
    await page.getByTestId("PeekStack").getByRole("textbox", {name: "Title"}).click();

    await page.keyboard.type("new task");

    await page
        .getByTestId("PeekStack")
        .getByTestId(/^TaskRowView:/)
        .getByLabel("Open")
        .first()
        .click();

    await expect(page.getByTestId("TaskDetailViewMain").getByText("unique task 1")).toBeVisible();

    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskDetailViewMain").getByLabel("Title"),
    ).toHaveText("new task");
    await page.getByLabel("Expand").click();

    await expect(page.getByTestId("TaskDetailViewMain").getByText("unique task 1")).toBeHidden();

    await expect(page.getByLabel("Open comments")).toBeHidden();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "More"}).hover();
    await page.getByRole("menuitem", {name: "Task view"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();
    await page.locator('button:right-of(:text("CreatorisT1me"))').first().click();

    await page
        .getByTestId("PeekStack")
        .getByTestId(/^TaskRowView:/)
        .getByLabel("Open")
        .first()
        .click();

    await expect(
        page.getByTestId("PeekStackOverlay").getByTestId("TaskDetailViewMain").getByLabel("Title"),
    ).toHaveText("unique task 1");
    await expect(page.getByTestId("PeekStackOverlay").getByLabel("Open comments")).toBeVisible();
    await expect(page.getByTestId("TaskDetailViewMain").getByText("new task")).toBeVisible();

    await page.getByLabel("Expand").click();

    await expect(page.getByTestId("PeekStackOverlay").getByLabel("Open comments")).toBeHidden();
    await expect(page.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page.getByTestId("MessageViewBubble")).toHaveText("1st task comment");
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
        parentCommentIndex: null,
        content: content1,
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

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

test("mobile task detail view loads comments when window size change", async ({
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
        parentCommentIndex: null,
        content: content1,
    });

    await ProcessContextModule.waitForTestTasks();
    await page.setViewportSize({width: mobilePlatformMaxWindowWidth, height: viewport.height});

    await services.signIn(browserContext, session);

    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(page.getByLabel("Open comments")).toBeVisible();
    await expect(page.getByText("1st task comment")).toBeHidden();

    await page.setViewportSize({width: initialDesktopViewportWidth, height: viewport.height});

    await expect(page.getByLabel("Open comments")).toBeHidden();
    await expect(page.getByText("1st task comment")).toBeVisible();
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
        parentCommentIndex: null,
        content: content1,
    });

    await ProcessContextModule.waitForTestTasks();

    await page.setViewportSize({width: mobilePlatformMaxWindowWidth, height: viewport.height});
    await services.signIn(browserContext, session);

    await page.goto(`/s/${space.id}/tasks/${task.id}`);
    await expect(page.getByLabel("Open comments")).toBeVisible();

    await page.getByLabel("Open comments").click();

    await expect(page.getByLabel("Open comments")).toBeHidden();
    await expect(page.getByText("unique task 1")).toBeVisible();
    await expect(page.getByText("Comments")).toBeVisible();
    await expect(page.getByText("1st task comment")).toBeVisible();

    await page.setViewportSize({width: initialDesktopViewportWidth, height: viewport.height});

    await expect(page.getByLabel("Open comments")).toBeHidden();
    await expect(page.getByText("Comments")).toBeHidden();
    await expect(page.getByText("1st task comment")).toBeVisible();
});
