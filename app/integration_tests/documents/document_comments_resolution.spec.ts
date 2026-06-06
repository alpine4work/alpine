import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can resolve document comment threads", async ({
    browser,
    page: page1,
    context: browserContext1,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);

    await document.type(session1, "Hello, world!");

    await document.createCommentThread(session1, {from: 10, to: 15}, "Test comment 1");

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await expect(page1.getByText("Test comment 1")).toBeHidden();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toBeHidden();
    }

    await page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]").click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page2.getByText("Test comment 1")).toBeHidden();
    await expect(page2.getByText("Mark as resolved")).toBeHidden();
    await expect(page2.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page2.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page2.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toBeHidden();
    }

    await page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]").click();

    await expect(page2.getByText("Test comment 1")).toBeVisible();
    await expect(page2.getByText("Mark as resolved")).toBeVisible();
    await expect(page2.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page2.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page2.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    // Playwright tries to scroll this button into view if we don't have `force: true`
    // which creates weird effects. We already know the button is visible from our check
    // above.
    // eslint-disable-next-line playwright/no-force-option
    await page1.getByText("Mark as resolved").click({force: true});

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page2.getByText("Test comment 1")).toBeVisible();
    await expect(page2.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page2.getByText("Mark as resolved")).toBeHidden();
    await expect(page2.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page2.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page2.reload();

    await expect(page2.getByText("Test comment 1")).toBeVisible();
    await expect(page2.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page2.getByText("Mark as resolved")).toBeHidden();
    await expect(page2.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page2.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page1.getByText("Resolved", {exact: true}).click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page2.getByText("Test comment 1")).toBeVisible();
    await expect(page2.getByText("Mark as resolved")).toBeVisible();
    await expect(page2.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page2.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page2.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page2.reload();

    await expect(page2.getByText("Test comment 1")).toBeVisible();
    await expect(page2.getByText("Mark as resolved")).toBeVisible();
    await expect(page2.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page2.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page2.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await browserContext2.close();
});

test("will preserve document comment snippet even after comment is removed from document", async ({
    browser,
    page: page1,
    context: browserContext1,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);

    await document.type(session1, "Hello, world!");

    const commentThread = await document.createCommentThread(
        session1,
        {from: 10, to: 15},
        "Test comment 1",
    );

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}?thread=${commentThread.id}`);

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");

    await page2.waitForFunction("dev.contentEditor");
    await page2.evaluate("dev.contentEditor.delete(3, 16)");

    await expect(page2.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");
    await expect(page1.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeVisible();
    } else {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeHidden();
    }
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page1.getByText("Mark as resolved").click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page1.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");
    await expect(page2.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");

    await page2.getByRole("button", {name: "More"}).click();
    await page2.getByRole("menuitem", {name: "Undo"}).click();

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");
    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page1.getByText("Resolved", {exact: true}).click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeVisible();
    } else {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeHidden();
    }
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await browserContext2.close();
});

test("will preserve document comment snippet even after resolved comment thread is removed from document", async ({
    browser,
    page: page1,
    context: browserContext1,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);

    await document.type(session1, "Hello, world!");

    const commentThread = await document.createCommentThread(
        session1,
        {from: 10, to: 15},
        "Test comment 1",
    );

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}?thread=${commentThread.id}`);

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeVisible();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page1.getByText("Mark as resolved").click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");

    await page2.waitForFunction("dev.contentEditor");
    await page2.evaluate("dev.contentEditor.delete(3, 16)");

    await expect(page2.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");

    await expect(page1.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page1.getByText("Resolved", {exact: true}).click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeVisible();
    } else {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeHidden();
    }
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await expect(page1.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");
    await expect(page2.getByRole("textbox", {name: "Document"})).not.toHaveText("Hello, world!");

    await page2.getByRole("button", {name: "More"}).click();
    await page2.getByRole("menuitem", {name: "Undo"}).click();

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");
    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText("Hello, world!");

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeVisible();
    } else {
        await expect(
            page1.getByText("Selected text has been removed from the document"),
        ).toBeHidden();
    }
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await page1.getByText("Mark as resolved").click();

    await expect(page1.getByText("Test comment 1")).toBeVisible();
    await expect(page1.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page1.getByText("Mark as resolved")).toBeHidden();
    await expect(page1.getByText("Selected text has been removed from the document")).toBeHidden();
    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toBeHidden();
    if (!isMobile) {
        await expect(
            page1.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("world");
    }

    await browserContext2.close();
});

test("can still go to the next document comment thread after resolving", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session = await space.createSession();

    const document = await TestDocument.create(session);

    await document.type(session, "foo bar qux");

    const commentThread1 = await document.createCommentThread(
        session,
        {from: 3, to: 6},
        "Test comment 1",
    );
    await document.createCommentThread(session, {from: 7, to: 10}, "Test comment 2");
    await document.createCommentThread(session, {from: 11, to: 14}, "Test comment 3");

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}?thread=${commentThread1.id}`);

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(3);
    await expect(page.getByText("Test comment 1")).toBeVisible();
    await expect(page.getByText("Test comment 2")).toBeHidden();
    await expect(page.getByText("Test comment 3")).toBeHidden();
    await expect(page.getByText("Mark as resolved")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("foo");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeEnabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();

    await page.getByRole("button", {name: "Next thread"}).click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(3);
    await expect(page.getByText("Test comment 1")).toBeHidden();
    await expect(page.getByText("Test comment 2")).toBeVisible();
    await expect(page.getByText("Test comment 3")).toBeHidden();
    await expect(page.getByText("Mark as resolved")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("bar");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeEnabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeEnabled();

    await page.getByRole("button", {name: "Previous thread"}).click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(3);
    await expect(page.getByText("Test comment 1")).toBeVisible();
    await expect(page.getByText("Test comment 2")).toBeHidden();
    await expect(page.getByText("Test comment 3")).toBeHidden();
    await expect(page.getByText("Mark as resolved")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("foo");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeEnabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();

    await page.getByText("Mark as resolved").click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(2);
    await expect(page.getByText("Test comment 1")).toBeVisible();
    await expect(page.getByText("Test comment 2")).toBeHidden();
    await expect(page.getByText("Test comment 3")).toBeHidden();
    await expect(page.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page.getByText("Mark as resolved")).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("foo");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeEnabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();

    await page.getByRole("button", {name: "Next thread"}).click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(2);
    await expect(page.getByText("Test comment 1")).toBeHidden();
    await expect(page.getByText("Test comment 2")).toBeVisible();
    await expect(page.getByText("Test comment 3")).toBeHidden();
    await expect(page.getByText("Mark as resolved")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("bar");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeEnabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();

    await page.getByRole("button", {name: "Next thread"}).click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(2);
    await expect(page.getByText("Test comment 1")).toBeHidden();
    await expect(page.getByText("Test comment 2")).toBeHidden();
    await expect(page.getByText("Test comment 3")).toBeVisible();
    await expect(page.getByText("Mark as resolved")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("qux");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeDisabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeEnabled();

    await page.getByText("Mark as resolved").click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(page.getByText("Test comment 1")).toBeHidden();
    await expect(page.getByText("Test comment 2")).toBeHidden();
    await expect(page.getByText("Test comment 3")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeVisible();
    await expect(page.getByText("Mark as resolved")).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("qux");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeDisabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeEnabled();

    await page.getByRole("button", {name: "Previous thread"}).click();

    await expect(
        page.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(page.getByText("Test comment 1")).toBeHidden();
    await expect(page.getByText("Test comment 2")).toBeVisible();
    await expect(page.getByText("Test comment 3")).toBeHidden();
    await expect(page.getByText("Mark as resolved")).toBeVisible();
    await expect(page.getByText("Resolved", {exact: true})).toBeHidden();
    if (!isMobile) {
        await expect(
            page.getByTestId("DocumentCommentThreadPreview").locator("[data-comment]"),
        ).toHaveText("bar");
    }
    await expect(page.getByRole("button", {name: "Next thread"})).toBeDisabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();
});
