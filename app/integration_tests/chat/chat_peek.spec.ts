import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {createDocument} from "~/server/dynamo/documents_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {createSimpleDocumentContent} from "~/shared/content/document_content_schema";

const context = createTestContext();
const server = createTestServer(context);
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
        content: createSimpleDocumentContent("Test document content 1"),
    });

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Send a chat message"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Send a chat message"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Create a document"}).click();

    await expect(page.getByRole("combobox", {name: "To"})).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.keyboard.type("Test document content 2");
    await expect(page.getByText("Test document content 2")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 2")).toBeHidden();

    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("button", {name: "Close"}).click();

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
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByRole("combobox", {name: "To"})).toBeVisible();
    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();

    await page.getByRole("button", {name: "Create"}).click();
    await page.getByRole("menuitem", {name: "Send a chat message"}).click();

    await expect(page.getByTestId("PeekStack")).toBeVisible();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByTestId("PeekStack").getByRole("combobox", {name: "To"})).toBeVisible();
    await page.getByTestId("PeekStack").getByRole("combobox", {name: "To"}).click();
    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();

    await page.getByRole("button", {name: "Expand"}).click();

    await expect(page.getByTestId("PeekStack")).toBeHidden();

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
});
