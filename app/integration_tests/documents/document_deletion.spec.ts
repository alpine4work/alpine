import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("deleting a document navigates away and shows a deleted error", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Shared Document"});
    await document.access.grantDefault(session1);

    await services.signIn(browserContext1, session1);
    // Navigate to the space first so there's a history entry to go back to after
    // deleting.
    await page1.goto(`/s/${space.id}`);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    // Both users can see the document.
    await expect(page1.getByRole("textbox", {name: "Document"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "Document"})).toBeVisible();

    // User 1 deletes the document via the more menu.
    await page1.getByRole("button", {name: "More"}).click();
    await page1.getByRole("menuitem", {name: "Delete"}).click();
    await page1.getByRole("alertdialog").getByRole("button", {name: "Delete"}).click();

    await expect(page1).not.toHaveURL(new RegExp(`/documents/${document.id}$`));

    // User 2 sees the deleted error via the realtime collaboration connection.
    await expect(page2.getByText("Document was deleted.")).toBeVisible();

    // Navigating to the deleted document shows the deleted error.
    await page1.goto(`/s/${space.id}/documents/${document.id}`);
    await expect(page1.getByText("Document was deleted.")).toBeVisible();

    await browserContext2.close();
});
