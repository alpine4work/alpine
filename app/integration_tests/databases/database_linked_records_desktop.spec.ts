import {type BrowserContext, type Locator, type Page, expect, test} from "@playwright/test";

import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can create and update linked records", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);

    const peopleUrl = await createDatabaseWithRow(page, space.id, "People", "Alice");
    const companiesUrl = await createDatabaseWithRow(page, space.id, "Companies", "Acme");

    await page.goto(peopleUrl);
    await createRelationField(page, "Company", "Companies");

    const companyPage = await openPage(browserContext, companiesUrl);
    await expect(companyPage.getByRole("button", {name: "People", exact: true})).toBeVisible();

    await page.bringToFront();
    const companyCell = databaseGridViewCell(page, "Company");
    await openRelationOption(page, companyCell, "Acme");
    await page.getByLabel("Search records").fill("Acme");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByLabel("Search records")).toHaveValue("");
    await expect(page.getByRole("button", {name: "Remove Acme"})).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(companyCell).toContainText("Acme");
    const peopleCell = databaseGridViewCell(companyPage, "People");
    await expect(peopleCell).toContainText("Alice");

    await renameFirstNameCell(companyPage, "OpenAI");

    await expect(databaseGridViewCell(companyPage, "Name")).toContainText("OpenAI");
    await expect(companyCell).toContainText("OpenAI");
    await expect(companyCell).not.toContainText("Acme");
});

async function createDatabaseWithRow(
    page: Page,
    spaceId: string,
    databaseName: string,
    rowName: string,
): Promise<string> {
    await page.goto(`/database/new/${spaceId}?focus=name`);
    await page.getByLabel("Name").fill(databaseName);
    await page.getByTestId("NavigationBar").getByRole("button", {name: "Create"}).click();

    const newRowButton = page.getByText("New row", {exact: true});
    await expect(newRowButton).toBeVisible();

    // Reload before writing: on the page reached through the create navigation the
    // database worker replica may not have received the new table yet, and writes
    // issued before it catches up are rejected.
    await page.reload();

    // Clicking "New row" creates the row and immediately opens the first cell's
    // editor.
    await newRowButton.click();
    await fillOpenCellEditor(page, rowName);
    await expect(page.getByText(rowName, {exact: true})).toBeVisible();

    return page.url();
}

async function createRelationField(page: Page, fieldName: string, linkedTableName: string) {
    await page.getByLabel("Add field").click();

    await page.getByLabel("Field name").fill(fieldName);
    await page.getByRole("option", {name: "Linked record"}).click();

    // Selecting a table on the linked table screen creates the field immediately.
    await page.getByRole("option", {name: linkedTableName, exact: true}).click();

    await expect(page.getByRole("button", {name: fieldName, exact: true})).toBeVisible();
}

async function renameFirstNameCell(page: Page, value: string) {
    await databaseGridViewCell(page, "Name").click();
    await fillOpenCellEditor(page, value);
}

function databaseGridViewCell(page: Page, fieldName: string): Locator {
    return page.locator(`[data-testid="DatabaseGridViewCell"][data-field-name="${fieldName}"]`);
}

async function openRelationOption(page: Page, cell: Locator, optionName: string): Promise<Locator> {
    const option = page.getByRole("option", {name: optionName, exact: true});

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await cell.click();
        if (await option.isVisible({timeout: 1000})) return option;

        await cell.click();
        if (await option.isVisible({timeout: 1000})) return option;

        await page.keyboard.press("Enter");
        if (await option.isVisible({timeout: 1000})) return option;

        await page.keyboard.press("Escape");
    }

    await expect(option).toBeVisible();
    return option;
}

async function fillOpenCellEditor(page: Page, value: string) {
    const editor = page.locator("textarea").last();
    await expect(editor).toBeVisible();
    await editor.fill(value);
    await editor.press("Escape");
}

async function openPage(browserContext: BrowserContext, url: string): Promise<Page> {
    const page = await browserContext.newPage();
    await page.goto(url);
    return page;
}
