import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
    createSimpleDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

const {context, services} = createTestServices();

test("can comment on a document and use the comment thread sidebar", async ({
    browser,
    page: page1,
    context: browserContext1,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
    ]);

    const document = await TestDocument.create(session1, {
        content: createSimpleDocumentContent(session1.account.id, "Hello, world!"),
    });
    await document.access.grantDefault(session1);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    // Make pages a bit wider so comment thread decorations show up even when the
    // comment sidebar is open.
    await page1.setViewportSize({width: viewport.width + 120, height: viewport.height});
    await page2.setViewportSize({width: viewport.width + 120, height: viewport.height});

    const canPrimaryInputHover = await page1.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    if (canPrimaryInputHover) {
        await page1
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page1
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeFocused();

    await page1.evaluate("dev.contentEditor.setTextSelection(10, 15)");

    if (!isMobile) {
        // Moving the mouse should open the styling toolbar.
        await page1.mouse.move(0, 0);
    }

    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

    if (isMobile) {
        // Comment button doesn't use a `<button>` element on mobile so it doesn't
        // move focus.
        await page1.getByLabel("Comment").click();
    } else {
        await page1.getByTestId("ContentEditorPointerToolbar").getByLabel("Comment").click();
    }

    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

    await expect(page1.getByRole("button", {name: "Save comment"})).toBeDisabled();
    await page1.getByRole("textbox", {name: "New comment"}).fill("Test comment content 1");
    await expect(page1.getByRole("button", {name: "Save comment"})).toBeEnabled();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(0);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(0);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeHidden();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeHidden();
    }

    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await page1.getByRole("button", {name: "Save comment"}).click();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeHidden();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("1"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("1"),
        ).toBeVisible();
    }

    await expect(page1.getByText("Test comment content 1")).toBeHidden();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await expect(page2.getByText("Test comment content 1")).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

    if (isMobile) {
        await page1.locator("[data-comment]").click();
    } else {
        // Test once that we can click the side decoration. From here on out we'll
        // click the comment itself which works on desktop and mobile.
        await page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).click();
    }

    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("1"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("1"),
        ).toBeVisible();
    }

    if (isMobile) {
        await expect(
            page1.getByTestId("DocumentContentEditorMobileFakeCommentInput"),
        ).toBeVisible();
        await page1.getByText("Add a comment").tap();
        await expect(
            page1.getByTestId("DocumentContentEditorMobileFakeCommentInput"),
        ).not.toBeAttached();
    }

    await page1.getByRole("textbox", {name: "New comment"}).fill("Test comment content 2");
    await page1.getByRole("button", {name: "Send comment"}).click();
    await expect(page1.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("2"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("2"),
        ).toBeVisible();
    }

    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeHidden();
    await expect(page2.getByText("Test comment content 2")).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

    await page2.locator("[data-comment]").click();

    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeVisible();
    await expect(page2.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeVisible();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("2"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeHidden();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("2"),
        ).toBeVisible();
    }

    if (isMobile) {
        await expect(
            page2.getByTestId("DocumentContentEditorMobileFakeCommentInput"),
        ).toBeVisible();
        await page2.getByText("Add a comment").tap();
        await expect(
            page2.getByTestId("DocumentContentEditorMobileFakeCommentInput"),
        ).not.toBeAttached();
    }

    await page2.getByRole("textbox", {name: "New comment"}).fill("Test comment content 3");
    await expect(page2.getByRole("button", {name: "Send comment"})).toBeEnabled();
    await page2.getByRole("button", {name: "Send comment"}).click();
    await expect(page2.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("3"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("3"),
        ).toBeVisible();
    }

    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByText("Test comment content 2")).toBeVisible();
    await expect(page1.getByText("Test comment content 3")).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeVisible();
    await expect(page2.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 3")).toBeVisible();

    await page1.getByRole("button", {name: "Close"}).click();

    await expect(page1.getByText("Test comment content 1")).toBeHidden();
    await expect(page1.getByText("Test comment content 2")).toBeHidden();
    await expect(page1.getByText("Test comment content 3")).toBeHidden();
    await expect(page2.getByText("Test comment content 1")).toBeVisible();
    await expect(page2.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 3")).toBeVisible();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("3"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("3"),
        ).toBeVisible();
    }

    await page1.reload();
    await page2.reload();

    await expect(page1.getByText("Test comment content 1")).toBeHidden();
    await expect(page1.getByText("Test comment content 2")).toBeHidden();
    await expect(page1.getByText("Test comment content 3")).toBeHidden();
    await expect(page2.getByText("Test comment content 1")).toBeVisible();
    await expect(page2.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 3")).toBeVisible();

    await expect(
        page1.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);
    await expect(
        page2.getByTestId("DocumentContentEditorMain").locator("[data-comment]"),
    ).toHaveCount(1);

    if (!isMobile) {
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeVisible();
        await expect(
            page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("3"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("LR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("SR"),
        ).toBeVisible();
        await expect(
            page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).getByText("3"),
        ).toBeVisible();
    }

    await browserContext2.close();
});

test("can leave multiple comments on a document and navigate between them", async ({
    page,
    context: browserContext,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Logan Roy"});

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("test foo test"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("test bar test"),
                ]),
            ]),
        ),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    const canPrimaryInputHover = await page.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    if (canPrimaryInputHover) {
        await page
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await expect(page.getByRole("textbox", {name: "Document"})).toBeFocused();

    await page.evaluate("dev.contentEditor.setTextSelection(8, 11)");

    if (!isMobile) {
        // Moving the mouse should open the styling toolbar.
        await page.mouse.move(0, 0);
    }

    if (isMobile) {
        // Comment button doesn't use a `<button>` element on mobile so it doesn't
        // move focus.
        await page.getByLabel("Comment").click();
    } else {
        await page.getByTestId("ContentEditorPointerToolbar").getByLabel("Comment").click();
    }

    await page.getByRole("textbox", {name: "New comment"}).fill("Test comment content 1");
    await page.getByRole("button", {name: "Save comment"}).click();

    await expect(page.getByText("Test comment content 1")).toBeHidden();

    await page.locator("[data-comment]").click();

    await expect(page.getByText("Test comment content 1")).toBeVisible();

    if (isMobile) {
        // Must close the comment overlay on mobile for the underlying document to be
        // accessible.
        await page.getByRole("button", {name: "Close"}).click();
        await expect(page.getByText("Test comment content 1")).toBeHidden();
    }

    if (canPrimaryInputHover) {
        await page
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await expect(page.getByRole("textbox", {name: "Document"})).toBeFocused();

    await page.evaluate("dev.contentEditor.setTextSelection(23, 26)");

    if (!isMobile) {
        // Moving the mouse should open the styling toolbar.
        await page.mouse.move(0, 0);
    }

    if (isMobile) {
        // Comment button doesn't use a `<button>` element on mobile so it doesn't
        // move focus.
        await page.getByLabel("Comment").click();
    } else {
        await page.getByTestId("ContentEditorPointerToolbar").getByLabel("Comment").click();
    }

    if (isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).fill("Test comment content 2");
    } else {
        // On desktop, disambiguate between the comment input in the sidebar and in the
        // main document area.
        await page
            .getByTestId("ContentEditorCommentInputFloater")
            .getByRole("textbox", {name: "New comment"})
            .fill("Test comment content 2");
    }

    await page.getByRole("button", {name: "Save comment"}).click();

    if (isMobile) {
        // On mobile we closed the comment thread so reopen it now.
        await page.locator("[data-comment]").last().click();
    }

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await expect(page.getByText("Test comment content 2")).toBeVisible();

    await expect(page.getByRole("button", {name: "Next thread"})).toBeDisabled();
    await page.getByRole("button", {name: "Previous thread"}).click();

    await expect(page.getByText("Test comment content 1")).toBeVisible();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();
    await page.getByRole("button", {name: "Next thread"}).click();

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await expect(page.getByText("Test comment content 2")).toBeVisible();

    await page.reload();

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await expect(page.getByText("Test comment content 2")).toBeVisible();

    await expect(page.getByRole("button", {name: "Next thread"})).toBeDisabled();
    await page.getByRole("button", {name: "Previous thread"}).click();

    await expect(page.getByText("Test comment content 1")).toBeVisible();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page.reload();

    await expect(page.getByText("Test comment content 1")).toBeVisible();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page.locator("[data-comment]").first().click();

    await expect(page.getByText("Test comment content 1")).toBeVisible();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page.locator("[data-comment]").last().click();

    await expect(page.getByText("Test comment content 2")).toBeVisible();
    await expect(page.getByText("Test comment content 1")).toBeHidden();
});

test("can leave a document comment across multiple paragraphs", async ({
    page,
    context: browserContext,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Logan Roy"});

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("test foo test"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("test bar test"),
                ]),
            ]),
        ),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    const canPrimaryInputHover = await page.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    if (canPrimaryInputHover) {
        await page
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await expect(page.getByRole("textbox", {name: "Document"})).toBeFocused();

    await page.evaluate("dev.contentEditor.setTextSelection(8, 26)");

    if (!isMobile) {
        // Moving the mouse should open the styling toolbar.
        await page.mouse.move(0, 0);
    }

    if (isMobile) {
        // Comment button doesn't use a `<button>` element on mobile so it doesn't
        // move focus.
        await page.getByLabel("Comment").click();
    } else {
        await page.getByTestId("ContentEditorPointerToolbar").getByLabel("Comment").click();
    }

    await page.getByRole("textbox", {name: "New comment"}).fill("Test comment content 3");
    await page.getByRole("button", {name: "Save comment"}).click();

    await expect(page.getByText("Test comment content 3")).toBeHidden();

    await page.locator("[data-comment]").first().click();

    await expect(page.getByText("Test comment content 3")).toBeVisible();

    await expect(page.getByRole("button", {name: "Next thread"})).toBeDisabled();
    await expect(page.getByRole("button", {name: "Previous thread"})).toBeDisabled();
});
