import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createDocument} from "~/server/documents/data/documents_table.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createSimpleDocumentContent} from "~/shared/documents/document_content_schema.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
createTestSession(context, space, {name: "Siobahn Roy"});
createTestSession(context, space, {name: "Kendall Roy"});

test("will remember the account being messaged in a chat peek", async ({
    context: browserContext,
    page,
}) => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: createSimpleDocumentContent(session1.account.id, "Test document content 1"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Message"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await expect(page.getByTestId("PeekStackOverlay")).toHaveCount(1);

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Document"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toHaveCount(2);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Message"}).click();

    await expect(page.getByTestId("PeekStackOverlay")).toHaveCount(3);

    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Document"}).click();

    await expect(page.getByRole("combobox", {name: "To"})).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("Test document content 2");
    await expect(page.getByText("Test document content 2")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 2")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(
        page.getByTestId("PeekStack").getByRole("textbox", {name: "Document"}),
    ).toBeHidden();

    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByRole("combobox", {name: "To"})).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();
});

test("will expand chat peek on top of chat peek with different selection", async ({
    context: browserContext,
    page,
}) => {
    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Logan Roy")).toBeHidden();

    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Logan Roy")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Message"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();

    await expect(page.getByText("Siobahn Roy")).toHaveCount(2);
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Logan Roy")).toBeVisible();

    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Logan Roy")).toBeHidden();

    await page.getByRole("button", {name: "Expand"}).click();

    await expect(page.getByTestId("PeekStack")).toBeHidden();

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Logan Roy")).toBeHidden();
});
