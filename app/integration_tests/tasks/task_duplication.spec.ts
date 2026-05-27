import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";

const {context, services} = createTestServices();

test("can duplicate a task without variables", async ({context: browserContext, page}, {
    project,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {title: "Original Task"});
    await task.typeNotes(session, "This is the original content.");

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Original Task");

    // Open the context menu and click Duplicate
    if (project.name === "webkit_mobile") {
        // On mobile, use the "More" menu button since right-click doesn't work
        await page.getByRole("button", {name: "More"}).click();
    } else {
        await page
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"})
            .click({button: "right"});
    }
    await page.getByText("Duplicate").click();

    // The instructional modal appears for tasks without variables - click "Duplicate"
    // to proceed
    const duplicationInstructionalModal = page.getByRole("alertdialog", {name: "Tip: Templates"});
    await expect(duplicationInstructionalModal).toBeVisible();

    const duplicateButton = duplicationInstructionalModal.getByRole("button", {name: "Duplicate"});

    if (project.name === "webkit_mobile") {
        await expect(duplicateButton).toBeFocused();
        await page.keyboard.press("Enter");
    } else {
        await duplicateButton.click();
    }

    // Wait for the duplicate to appear in the peek overlay
    if (project.name !== "webkit_mobile") {
        await expect(
            page
                .getByTestId("PeekStackOverlay")
                .getByTestId("TaskDetailViewMain")
                .getByRole("textbox", {name: "Title"}),
        ).toHaveText("Original Task (copy)");

        // Expand the peek to navigate to the new task
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // After expanding (or on mobile where there's no peek), verify the title
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Original Task (copy)");

    // The URL should have changed to the new task
    expect(page.url()).toContain("/tasks/");
    await expect(page).not.toHaveURL(new RegExp(task.id));

    // Content should be duplicated
    await expect(page.getByText("This is the original content.")).toBeVisible();
});

test("can duplicate a task with template variables in title", async ({
    context: browserContext,
    page,
}, {project}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {title: "Task for {{ClientName}}"});
    await task.typeNotes(session, "Meeting notes go here.");

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Task for {{ClientName}}");

    // Open the context menu and click Duplicate
    if (project.name === "webkit_mobile") {
        // On mobile, use the "More" menu button since right-click doesn't work
        await page.getByRole("button", {name: "More"}).click();
    } else {
        await page
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"})
            .click({button: "right"});
    }
    await page.getByText("Duplicate").click();

    // Should open the duplication view with the title
    await expect(
        page.getByText("Duplicate \u201CTask for {{ClientName}}\u201D", {exact: false}),
    ).toBeVisible();

    // Should show the variable input
    await expect(page.getByLabel("ClientName")).toBeVisible();

    // Fill in the variable
    await page.getByLabel("ClientName").fill("Acme Corp");

    // Click Create - on desktop scope to peek overlay, on mobile there's only one
    // Create
    if (project.name === "webkit_mobile") {
        await page.getByRole("button", {name: "Create"}).click();
    } else {
        await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Create"}).click();
    }

    // Wait for the new task to appear in the peek overlay
    if (project.name !== "webkit_mobile") {
        await expect(
            page
                .getByTestId("PeekStackOverlay")
                .getByTestId("TaskDetailViewMain")
                .getByRole("textbox", {name: "Title"}),
        ).toHaveText("Task for Acme Corp");

        // Expand the peek to navigate
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // After expanding (or on mobile), verify the title
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Task for Acme Corp");

    // Content should be duplicated
    await expect(page.getByText("Meeting notes go here.")).toBeVisible();
});

test("can duplicate a task with template variables in notes", async ({
    context: browserContext,
    page,
}, {project}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {title: "Weekly Report"});
    await task.typeNotes(session, "Report for {{WeekNumber}}: Status update.");

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Weekly Report");

    // Open the context menu and click Duplicate
    if (project.name === "webkit_mobile") {
        // On mobile, use the "More" menu button since right-click doesn't work
        await page.getByRole("button", {name: "More"}).click();
    } else {
        await page
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"})
            .click({button: "right"});
    }
    await page.getByText("Duplicate").click();

    // Should open the duplication view
    await expect(page.getByLabel("WeekNumber")).toBeVisible();

    // Fill in the variable
    await page.getByLabel("WeekNumber").fill("42");

    // Click Create
    if (project.name === "webkit_mobile") {
        await page.getByRole("button", {name: "Create"}).click();
    } else {
        await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Create"}).click();
    }

    // Wait for the new task to appear - title gets (copy) since the title itself had
    // no variable
    if (project.name !== "webkit_mobile") {
        await expect(
            page
                .getByTestId("PeekStackOverlay")
                .getByTestId("TaskDetailViewMain")
                .getByRole("textbox", {name: "Title"}),
        ).toHaveText("Weekly Report (copy)");

        // Expand the peek to navigate
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // After expanding (or on mobile), verify the title
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Weekly Report (copy)");

    // Content should have the variable replaced
    await expect(page.getByText("Report for 42: Status update.")).toBeVisible();
});

test("duplicate with empty variable value leaves variable unchanged", async ({
    context: browserContext,
    page,
}, {project}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {title: "Template: {{Name}}"});
    await task.typeNotes(session, "Hello, {{Name}}!");

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Template: {{Name}}");

    // Open the context menu and click Duplicate
    if (project.name === "webkit_mobile") {
        // On mobile, use the "More" menu button since right-click doesn't work
        await page.getByRole("button", {name: "More"}).click();
    } else {
        await page
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"})
            .click({button: "right"});
    }
    await page.getByText("Duplicate").click();

    // Should open the duplication view
    await expect(page.getByLabel("Name")).toBeVisible();

    // Leave the variable empty and click Create
    if (project.name === "webkit_mobile") {
        await page.getByRole("button", {name: "Create"}).click();
    } else {
        await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Create"}).click();
    }

    // Wait for the new task to appear - title should still have variable and get
    // (copy) suffix
    if (project.name !== "webkit_mobile") {
        await expect(
            page
                .getByTestId("PeekStackOverlay")
                .getByTestId("TaskDetailViewMain")
                .getByRole("textbox", {name: "Title"}),
        ).toHaveText("Template: {{Name}} (copy)");

        // Expand the peek to navigate
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // After expanding (or on mobile), verify the title
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Template: {{Name}} (copy)");

    // Content should have the variable unchanged
    await expect(page.getByText("Hello, {{Name}}!")).toBeVisible();
});

test("can duplicate a task with variable in both title and notes", async ({
    context: browserContext,
    page,
}, {project}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {title: "Project: {{ProjectName}}"});
    await task.typeNotes(session, "This is the {{ProjectName}} project plan.");

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Project: {{ProjectName}}");

    // Open the context menu and click Duplicate
    if (project.name === "webkit_mobile") {
        // On mobile, use the "More" menu button since right-click doesn't work
        await page.getByRole("button", {name: "More"}).click();
    } else {
        await page
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"})
            .click({button: "right"});
    }
    await page.getByText("Duplicate").click();

    // Should only show ONE input for the shared variable (scope to peek to avoid
    // counting other inputs)
    const peekOrPage =
        project.name === "webkit_mobile" ? page : page.getByTestId("PeekStackOverlay");
    await expect(peekOrPage.getByLabel("ProjectName")).toBeVisible();

    // Fill in the variable
    await peekOrPage.getByLabel("ProjectName").fill("Alpha");

    // Click Create
    await peekOrPage.getByRole("button", {name: "Create"}).click();

    // Wait for the new task to appear
    if (project.name !== "webkit_mobile") {
        await expect(
            page
                .getByTestId("PeekStackOverlay")
                .getByTestId("TaskDetailViewMain")
                .getByRole("textbox", {name: "Title"}),
        ).toHaveText("Project: Alpha");

        // Expand the peek to navigate
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // After expanding (or on mobile), verify the title
    await expect(
        page.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Project: Alpha");

    // Content should have the variable replaced in both places
    await expect(page.getByText("This is the Alpha project plan.")).toBeVisible();
});
