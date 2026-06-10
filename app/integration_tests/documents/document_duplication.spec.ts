import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can duplicate a document without variables", async ({context: browserContext, page}, {
    project,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Original Document",
        body: "This is the original content.",
    });

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    await expect(page.getByRole("heading", {name: "Original Document"})).toBeVisible();

    // Open the more menu and click Duplicate
    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Duplicate"}).click();

    // An instructional modal appears for documents without variables - click Duplicate
    await page.getByRole("alertdialog").getByRole("button", {name: "Duplicate"}).click();

    // Wait for the duplicate to appear
    await expect(page.getByRole("heading", {name: "Original Document (copy)"})).toBeVisible();

    // On desktop, the duplicate opens in a peek - expand it to navigate, then wait for
    // peek to close On mobile, navigation goes directly to the new document (no peeks)
    if (project.name !== "webkit_mobile") {
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // The URL should have changed to the new document
    expect(page.url()).toContain("/doc/");
    await expect(page).not.toHaveURL(new RegExp(document.id));

    // Content should be duplicated
    await expect(page.getByText("This is the original content.")).toBeVisible();
});

test("can duplicate a document with template variables", async ({context: browserContext, page}, {
    project,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Template: {{Name}}",
        body: "Hello, {{Name}}! Welcome to our service.",
    });

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    await expect(page.getByRole("heading", {name: "Template: {{Name}}"})).toBeVisible();

    // Open the more menu and click Duplicate
    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Duplicate"}).click();

    // Should open the duplication view with the title
    await expect(
        page.getByText("Duplicate \u201CTemplate: {{Name}}\u201D", {exact: false}),
    ).toBeVisible();

    // Should show the variable input
    await expect(page.getByLabel("Name")).toBeVisible();

    // Fill in the variable
    await page.getByLabel("Name").fill("Alice");

    // Click Create - on desktop scope to peek overlay, on mobile there's only one
    // Create
    if (project.name === "webkit_mobile") {
        await page.getByRole("button", {name: "Create"}).click();
    } else {
        await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Create"}).click();
    }

    // Wait for the new document to appear
    await expect(page.getByRole("heading", {name: "Template: Alice", exact: true})).toBeVisible();

    // On desktop, expand the peek to navigate
    if (project.name !== "webkit_mobile") {
        await page.getByRole("button", {name: "Expand"}).click();
    }

    // Content should have the variable replaced
    await expect(page.getByText("Hello, Alice! Welcome to our service.")).toBeVisible();
});

test("duplicate with empty variable value leaves variable unchanged", async ({
    context: browserContext,
    page,
}, {project}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Template: {{Name}}",
        body: "Hello, {{Name}}!",
    });

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    await expect(page.getByRole("heading", {name: "Template: {{Name}}"})).toBeVisible();

    // Open the more menu and click Duplicate
    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Duplicate"}).click();

    // Should open the duplication view
    await expect(page.getByLabel("Name")).toBeVisible();

    // Leave the variable empty and click Create
    if (project.name === "webkit_mobile") {
        await page.getByRole("button", {name: "Create"}).click();
    } else {
        await page.getByTestId("PeekStackOverlay").getByRole("button", {name: "Create"}).click();
    }

    // Wait for the new document to appear
    await expect(page.getByRole("heading", {name: "Template: {{Name}} (copy)"})).toBeVisible();

    // On desktop, expand the peek to navigate, then wait for peek to close
    if (project.name !== "webkit_mobile") {
        await page.getByRole("button", {name: "Expand"}).click();
        await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // Content should have the variable unchanged
    await expect(page.getByText("Hello, {{Name}}!")).toBeVisible();
});

test("viewer can duplicate a document they have view access to", async ({
    browser,
    context: browserContext1,
    page: page1,
}, {project}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        title: "Original Document",
        body: "This is the content.",
        access: "Public",
    });

    // Sign in as the viewer (session2)
    await services.signIn(browserContext1, session2);
    await page1.goto(`/doc/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Original Document"})).toBeVisible();

    // Open the more menu and click Duplicate
    await page1.getByRole("button", {name: "More"}).click();
    await page1.getByRole("menuitem", {name: "Duplicate"}).click();

    // An instructional modal appears for documents without variables - click Duplicate
    await page1.getByRole("alertdialog").getByRole("button", {name: "Duplicate"}).click();

    // Wait for the duplicate to appear
    await expect(page1.getByRole("heading", {name: "Original Document (copy)"})).toBeVisible();

    // On desktop, expand the peek to navigate, then wait for peek to close
    if (project.name !== "webkit_mobile") {
        await page1.getByRole("button", {name: "Expand"}).click();
        await expect(page1.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    // The URL should have changed to the new document
    await expect(page1).not.toHaveURL(new RegExp(document.id));
    expect(page1.url()).toContain("/doc/");

    // Content should be duplicated
    await expect(page1.getByText("This is the content.")).toBeVisible();

    // Verify the duplicate is owned by session2 by checking that session1 can't see it
    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session1);
    const page2 = await browserContext2.newPage();

    // Extract the new document ID from the URL
    const newDocumentUrl = page1.url();
    await page2.goto(newDocumentUrl);

    // session1 should not be able to access session2's duplicate
    await expect(page2.getByText("Couldn\u2019t open document")).toBeVisible();

    await browserContext2.close();
});
