import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createDocument} from "~/server/documents/data/documents_table.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
    createSimpleDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});
createTestSession(context, space, {name: "Kendall Roy"});

test("can comment on a document and use the comment thread sidebar", async ({
    browser,
    page: page1,
    context: browserContext1,
    viewport,
}) => {
    assert(viewport);

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Hello, world!"),
    });

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();

    // Moving the mouse should open the styling toolbar.
    await page1.evaluate("dev.contentEditor.setTextSelection(10, 15)");
    await page1.mouse.move(0, 0);

    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await page1.getByRole("button", {name: "Comment"}).click();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

    await expect(page1.getByRole("button", {name: "Save comment"})).toBeDisabled();
    await page1.getByRole("textbox", {name: "New comment"}).type("Test comment content 1");
    await expect(page1.getByRole("button", {name: "Save comment"})).toBeEnabled();

    await expect(
        page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
    ).toBeHidden();
    await expect(
        page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/),
    ).toBeHidden();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await page1.getByRole("textbox", {name: "New comment"}).press("Enter");
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeHidden();
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

    await expect(page1.getByText("Test comment content 1")).toBeHidden();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await expect(page2.getByText("Test comment content 1")).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await page1.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).click();
    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();

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

    await page1.getByRole("textbox", {name: "New comment"}).type("Test comment content 2");
    await page1.getByRole("textbox", {name: "New comment"}).press("Enter");

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

    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeHidden();
    await expect(page2.getByText("Test comment content 2")).toBeHidden();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await page2.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).click();
    await expect(page1.getByText("Test comment content 1")).toBeVisible();
    await expect(page1.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 1")).toBeVisible();
    await expect(page2.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeVisible();

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

    await page2.getByRole("textbox", {name: "New comment"}).type("Test comment content 3");
    await page2.getByRole("textbox", {name: "New comment"}).press("Enter");

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

    await page1.reload();
    await page2.reload();

    await expect(page1.getByText("Test comment content 1")).toBeHidden();
    await expect(page1.getByText("Test comment content 2")).toBeHidden();
    await expect(page1.getByText("Test comment content 3")).toBeHidden();
    await expect(page2.getByText("Test comment content 1")).toBeVisible();
    await expect(page2.getByText("Test comment content 2")).toBeVisible();
    await expect(page2.getByText("Test comment content 3")).toBeVisible();

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
});

test("can leave multiple comments on a document and navigate between them", async ({
    page,
    context: browserContext,
    viewport,
}) => {
    assert(viewport);

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

    await page.getByRole("textbox", {name: "Document"}).focus();

    // Moving the mouse should open the styling toolbar.
    await page.evaluate("dev.contentEditor.setTextSelection(8, 11)");
    await page.mouse.move(0, 0);

    await page.getByRole("button", {name: "Comment"}).click();
    await page.getByRole("textbox", {name: "New comment"}).type("Test comment content 1");
    await page.getByRole("textbox", {name: "New comment"}).press("Enter");

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await page.getByTestId(/DocumentContentEditorCommentThreadSideDecoration/).click();
    await expect(page.getByText("Test comment content 1")).toBeVisible();

    await page.getByRole("textbox", {name: "Document"}).focus();

    // Moving the mouse should open the styling toolbar.
    await page.evaluate("dev.contentEditor.setTextSelection(23, 26)");
    await page.mouse.move(0, 0);

    await page
        .getByTestId("DocumentContentEditorMain")
        .getByRole("button", {name: "Comment"})
        .click();
    await page
        .getByTestId("DocumentContentEditorMain")
        .getByRole("textbox", {name: "New comment"})
        .type("Test comment content 2");
    await page
        .getByTestId("DocumentContentEditorMain")
        .getByRole("textbox", {name: "New comment"})
        .press("Enter");

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

    await page
        .getByTestId(/DocumentContentEditorCommentThreadSideDecoration/)
        .first()
        .click();

    await expect(page.getByText("Test comment content 1")).toBeVisible();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test comment content 1")).toBeHidden();
    await expect(page.getByText("Test comment content 2")).toBeHidden();

    await page
        .getByTestId(/DocumentContentEditorCommentThreadSideDecoration/)
        .last()
        .click();

    await expect(page.getByText("Test comment content 2")).toBeVisible();
    await expect(page.getByText("Test comment content 1")).toBeHidden();
});
