import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createDocument} from "~/server/dynamo/documents_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";

const context = createTestContext();
const services = createTestServices(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});
createTestSession(context, space, {name: "Kendall Roy"});

test("can search for an account in mention menu", async ({
    page,
    context: browserContext,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await page.getByRole("textbox", {name: "Document"}).focus();
    await page
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await page.getByRole("textbox", {name: "Document"}).type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeVisible();
    await page.getByRole("textbox", {name: "Document"}).type("Siobahn");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await page.getByTestId("ContentEditorMentionFloater").getByText("Siobahn").click();
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();

    await expect(page.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
});

test("can see a mention added by another user", async ({
    page: page1,
    context: browserContext1,
    browser,
    viewport,
}) => {
    assert(viewport);

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();
    await page1
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    // Focusing the document in the second browser will wait for the document to
    // be interactive.
    await page2.getByRole("textbox", {name: "Document"}).focus();

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).type("@");

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeVisible();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).type("Siobahn");

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "Document"}).press("Enter");

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
});
