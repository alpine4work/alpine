import {CalendarDate} from "@internationalized/date";
import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

const {context, services} = createTestServices();

test("interleaves activity with comments chronologically", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    const creationTime = Date.now() - 10 * 60 * 1000;
    const task = await TestTask.create(session, {
        title: "Interleave test",
        time: [creationTime, 0],
        overrideCommittedTimeForTest: new Date(creationTime),
    });
    await task.createComment(session, "Comment between updates");
    await task.updatePriority(session, "High");
    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    const createdRow = page.getByText("created the task");
    const commentRow = page.getByText("Comment between updates");
    const priorityRow = page.getByText("set the priority to high");
    await expect(createdRow).toBeVisible();
    await expect(commentRow).toBeVisible();
    await expect(priorityRow).toBeVisible();

    const createdBox = assertExists(await createdRow.boundingBox());
    const commentBox = assertExists(await commentRow.boundingBox());
    const priorityBox = assertExists(await priorityRow.boundingBox());
    expect(createdBox.y).toBeLessThan(commentBox.y);
    expect(commentBox.y).toBeLessThan(priorityBox.y);
});

test("merges consecutive same-field updates into one item with the final value", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    const creationTime = Date.now() - 10 * 60 * 1000;
    const task = await TestTask.create(session, {
        title: "Merge test",
        time: [creationTime, 0],
        overrideCommittedTimeForTest: new Date(creationTime),
    });
    await task.updateDueDate(session, new CalendarDate(2026, 8, 1));
    await task.updateDueDate(session, new CalendarDate(2026, 8, 2));
    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByText(/set the due date to Aug 2/)).toBeVisible();
    await expect(page.getByText(/set the due date to/)).toHaveCount(1);
});

test("a fully reverted same-actor run disappears while other actors\u2019 items stay", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const masonSession = await space.createSession({name: "Mason Clay"});
    const mattSession = await space.createSession({name: "Matt R. Horn"});
    // The public collection grants Matt access to Mason's task.
    const collection = await TestTaskCollection.create(masonSession, {
        name: "Bugs",
        access: "Public",
    });
    const task = await TestTask.create(masonSession, {
        title: "Fat-finger test",
        collections: collection,
    });
    await task.updateStatus(masonSession, "Closed");
    // Matt reopens then closes again within the read-time window: his pair nets out
    // and disappears. Mason's close stays.
    await task.updateStatus(mattSession, "Open");
    await task.updateStatus(mattSession, "Closed");
    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, masonSession);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByText("closed the task")).toHaveCount(1);
    await expect(page.getByText("reopened the task")).toBeHidden();
});

test("a comment between two same-field updates does not split the merged run", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    const creationTime = Date.now() - 10 * 60 * 1000;
    const task = await TestTask.create(session, {
        title: "Boundary test",
        time: [creationTime, 0],
        overrideCommittedTimeForTest: new Date(creationTime),
    });
    await task.updateDueDate(session, new CalendarDate(2026, 8, 1));
    await task.createComment(session, "Comment splitting the run");
    await task.updateDueDate(session, new CalendarDate(2026, 8, 2));
    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByText(/set the due date to Aug 1/)).toBeHidden();
    await expect(page.getByText(/set the due date to Aug 2/)).toBeVisible();
    await expect(page.getByText(/set the due date to/)).toHaveCount(1);
});

test("creation setup folds into the created item while notes remain visible", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    const task = await TestTask.create(session, {
        title: "Creation fold test",
        assignee: session,
    });
    await task.typeNotes(session, "Initial notes written while setting the task up.");
    await ProcessContextModule.waitForTestTasks();
    await context.waitForSqsProcessJobs();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    // The initial title and self-assignment are creation setup. Notes remain visible
    // even when written during the setup window.
    await expect(page.getByText("created the task")).toBeVisible();
    await expect(page.getByText("renamed the task")).toBeHidden();
    await expect(page.getByText("assigned the task to")).toBeHidden();
    await expect(page.getByText("updated the notes")).toBeVisible();
});

test("assignment and notes after the creation fold window render as activity", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    // Created 20 minutes ago: the self-assignment and notes below are real activity,
    // not creation setup.
    const creationTime = Date.now() - 20 * 60 * 1000;
    const task = await TestTask.create(session, {
        title: "Late setup test",
        time: [creationTime, 0],
        overrideCommittedTimeForTest: new Date(creationTime),
    });
    await task.updateAssignee(session, session);
    await task.typeNotes(session, "Notes added well after creation.");
    await ProcessContextModule.waitForTestTasks();
    await context.waitForSqsProcessJobs();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    // "assigned the task to" and the assignee's name live in separate elements (the
    // name is a link), so the assertion stays within the one text node.
    await expect(page.getByText("assigned the task to")).toBeVisible();
    await expect(page.getByText("updated the notes")).toBeVisible();
});

test("clicking an actor opens a chat peek with them", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const masonSession = await space.createSession({name: "Mason Clay"});
    const cassSession = await space.createSession({name: "Cass Cade"});
    // The public collection grants Cass access to Mason's task.
    const collection = await TestTaskCollection.create(masonSession, {
        name: "Bugs",
        access: "Public",
    });
    const task = await TestTask.create(masonSession, {
        title: "Actor link test",
        collections: collection,
    });
    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, cassSession);
    await page.goto(`/task/${task.id}`);
    await page.waitForFunction("dev.ready");

    const actorLink = page.getByTestId("TaskActivityFeedAccountNameButton").first();
    await expect(actorLink).toHaveText("Mason");
    await actorLink.click();

    const peek = page.getByTestId("PeekStackOverlay");
    await expect(peek).toBeVisible();
    await expect(
        peek.getByTestId("ChatViewTopBar").getByRole("heading", {name: "Mason Clay"}),
    ).toBeVisible();
});

test("an actor does not link to chat for an anonymous URL-grant viewer", async ({page}) => {
    const space = await TestSpace.create(context);
    const masonSession = await space.createSession({name: "Mason Clay"});
    const task = await TestTask.create(masonSession, {title: "Anonymous actor link test"});
    await task.access.grantUrl(masonSession);
    await ProcessContextModule.waitForTestTasks();

    await page.goto(`/task/${task.id}`);

    await expect(page.getByText("created the task")).toBeVisible();

    const actorName = page.getByText("Mason", {exact: true});
    await expect(actorName).toBeVisible();
    await expect(page.getByRole("link", {name: "Mason"})).toHaveCount(0);

    const taskUrl = page.url();
    await actorName.click();
    await expect(page).toHaveURL(taskUrl);
});

test("an actor removed from the space does not link to chat", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const masonSession = await space.createSession({name: "Mason Clay"});
    const cassSession = await space.createSession({name: "Cass Cade"});
    const collection = await TestTaskCollection.create(masonSession, {
        name: "Bugs",
        access: "Public",
    });
    const task = await TestTask.create(masonSession, {
        title: "Removed actor link test",
        collections: collection,
    });
    await ProcessContextModule.waitForTestTasks();
    await space.removeAccount(masonSession);

    await services.signIn(browserContext, cassSession);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByText("created the task")).toBeVisible();

    const actorName = page.getByText("Mason", {exact: true});
    await expect(actorName).toBeVisible();
    await expect(page.getByRole("link", {name: "Mason"})).toHaveCount(0);

    const taskUrl = page.url();
    await actorName.click();
    await expect(page).toHaveURL(taskUrl);
});

test("activity from other sessions appears in realtime", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    const creationTime = Date.now() - 10 * 60 * 1000;
    const task = await TestTask.create(session, {
        title: "Realtime test",
        time: [creationTime, 0],
        overrideCommittedTimeForTest: new Date(creationTime),
    });
    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);
    await expect(page.getByText("created the task")).toBeVisible();

    // Assert the row is absent before the mutation so the visibility assertion below
    // can only pass via the realtime update, not a row that was somehow already
    // rendered.
    await expect(page.getByText("set the priority to high")).toBeHidden();

    await task.updatePriority(session, "High");
    await ProcessContextModule.waitForTestTasks();

    await expect(page.getByText("set the priority to high")).toBeVisible();
});

test("a ghost task\u2019s activity appears once the task is created", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Mason Clay"});
    const taskId = generateId<TaskId>();

    await services.signIn(browserContext, session);
    await page.goto(`/task/${taskId}?create=${space.id}`);

    // The ghost task doesn't exist on the server yet, so nothing may ask the server
    // about its activity: a backfill or reload here throws a not-found error that
    // takes down the whole page.
    await expect(page.getByTestId("TaskStatusButton")).toBeVisible();
    await expect(page.getByText("created the task")).toBeHidden();

    // Closing the task commits it. Status changes remain visible even inside the
    // creation setup window.
    await page.getByTestId("TaskStatusButton").click();
    await expect(page).not.toHaveURL(/[?&]create/);
    await ProcessContextModule.waitForTestTasks();
    await context.waitForSqsProcessJobs();

    await expect(page.getByText("created the task")).toBeVisible();
    await expect(page.getByText("closed the task")).toBeVisible();
});
