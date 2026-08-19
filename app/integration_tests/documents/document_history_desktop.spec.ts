import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can inspect a nested document history entry", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({name: "Owner Account"});
    const editorSession = await space.createSession({name: "Editor Account"});
    const document = await TestDocument.create(ownerSession, {
        title: "Launch checklist",
        body: "Status: draft",
        access: "Public",
        cover: {
            type: "Blobs",
            seed: "history-cover",
            themeColor: "blue",
            hueSpread: 10,
        },
    });
    await document.type(ownerSession, ", owner draft", {
        overrideCreatedTimeForTest: new Date("2026-08-12T09:00:00-04:00"),
    });
    await document.type(editorSession, ", editor update", {
        overrideCreatedTimeForTest: new Date("2026-08-12T09:06:00-04:00"),
    });
    await document.type(ownerSession, ", owner final", {
        overrideCreatedTimeForTest: new Date("2026-08-12T09:06:30-04:00"),
    });
    await document.type(ownerSession, ", owner current", {
        overrideCreatedTimeForTest: new Date("2026-08-12T09:12:00-04:00"),
    });
    await document.type(editorSession, ", editor later", {
        overrideCreatedTimeForTest: new Date("2026-08-12T10:30:00-04:00"),
    });
    await document.type(ownerSession, ", owner latest", {
        overrideCreatedTimeForTest: new Date("2026-08-12T10:36:00-04:00"),
    });

    await services.signIn(browserContext, ownerSession);
    await page.goto(`/doc/${document.id}`);
    await page.waitForFunction("dev.ready");

    const liveDocument = page.getByRole("textbox", {name: "Document"});
    await expect(liveDocument).toContainText("owner final");

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Version history"}).click();
    await expect(page).toHaveURL(new RegExp(`/doc/${document.id}/history$`));

    const historyHeading = page.getByRole("heading", {name: "Version history"});
    await expect(historyHeading).toBeVisible();
    await expect(page.getByText("Version history", {exact: true})).toHaveCount(1);
    await expect(page.getByText("Launch checklist", {exact: true})).toHaveCount(2);
    await expect(page.getByTestId("BlobsArtCanvas")).toHaveCount(2);
    await expect(page.getByLabel("Document at version 6")).toBeVisible();
    await expect(page.getByText("Current version")).toHaveCount(0);
    const expandGroupButtons = page.getByRole("button", {name: "Expand version group"});
    await expect(expandGroupButtons).toHaveCount(2);
    await expect(page.getByRole("button", {name: "Collapse version group"})).toHaveCount(0);
    await expandGroupButtons.first().click();
    await expect(page).toHaveURL(new RegExp(`/doc/${document.id}/history$`));
    await expect(page.getByRole("button", {name: "Collapse version group"})).toHaveCount(1);

    await page.getByRole("button", {name: "View version entry"}).nth(1).click();
    await expect(page.getByRole("button", {name: "Collapse version group"})).toHaveCount(1);

    const groupButton = page.getByRole("button", {name: "View version group"}).first();
    await groupButton.click();
    await expect(page).toHaveURL(new RegExp(`/doc/${document.id}/history\\?version=6&group`));

    await page.goto(`/doc/${document.id}/history?version=2&group`);
    await page.waitForFunction("dev.ready");
    await expect(page.getByLabel("Document at version 4")).toBeVisible();

    await page.goto(`/doc/${document.id}/history?version=5`);
    await page.waitForFunction("dev.ready");
    await expect(page.getByLabel("Document at version 5")).toBeVisible();

    await page.goto(`/doc/${document.id}/history?version=2`);
    await page.waitForFunction("dev.ready");
    await expect(page.getByRole("button", {name: "Collapse version group"})).toBeVisible();

    const historicalDocument = page.getByLabel("Document at version 3");
    await expect(historicalDocument).toBeVisible();
    await expect(historicalDocument).toContainText("owner draft, editor update, owner final");
    await expect(historicalDocument).not.toContainText("owner current");
    await expect(historicalDocument.locator("ins")).toHaveText(", editor update, owner final");
    await expect(liveDocument).toHaveCount(0);

    await historicalDocument.click();
    await expect(historyHeading).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();
    await expect(page).toHaveURL(new RegExp(`/doc/${document.id}$`));
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();
});
