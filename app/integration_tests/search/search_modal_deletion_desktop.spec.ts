import {Locator, Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {DocumentId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";

const {context, services} = createTestServices();
const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

test("deleting a document from search keeps the modal open, removes the result, and selects the previous result", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document1 = await TestDocument.create(session, {
        title: "Alpha search deletion document",
        access: "Public",
    });
    const document2 = await TestDocument.create(session, {
        title: "Bravo search deletion document",
        access: "Public",
    });
    const document3 = await TestDocument.create(session, {
        title: "Charlie search deletion document",
        access: "Public",
    });

    await indexEntitiesForKeywordSearch(space.id, [
        {type: "Document", id: document1.id},
        {type: "Document", id: document2.id},
        {type: "Document", id: document3.id},
    ]);

    await services.signIn(browserContext, session);
    await openSearchModal(page, space.id);

    const modal = page.getByTestId("SearchModal");
    const input = modal.getByPlaceholder(/^Search/).first();
    await input.fill("search deletion document");

    await expect(resultRow(modal, "Alpha search deletion document")).toBeVisible();
    await expect(resultRow(modal, "Bravo search deletion document")).toBeVisible();
    await expect(resultRow(modal, "Charlie search deletion document")).toBeVisible();

    await selectSearchResult(page, modal, input, "Bravo search deletion document");
    await expect(page.getByTestId("SearchModalPeek")).toBeVisible();
    await expect(
        page
            .getByTestId("SearchModalPeek")
            .getByRole("heading", {name: "Bravo search deletion document"}),
    ).toBeVisible();

    const expectedAdjacentTitle = await getExpectedAdjacentResultTitle(
        modal,
        "Bravo search deletion document",
    );

    await page.getByTestId("SearchModalPeek").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Delete"}).click();
    await page
        .getByRole("alertdialog", {name: "Delete document?"})
        .getByRole("button", {name: "Delete"})
        .click();
    await expect(page.getByRole("alertdialog", {name: "Delete document?"})).toBeHidden();

    await expect(modal).toBeVisible();
    await expect(input).toHaveValue("search deletion document");
    await expect(resultRow(modal, "Bravo search deletion document")).toBeHidden();
    await expect(resultRow(modal, "Alpha search deletion document")).toBeVisible();
    await expect(resultRow(modal, "Charlie search deletion document")).toBeVisible();

    await expect(
        page.getByTestId("SearchModalPeek").getByRole("heading", {name: expectedAdjacentTitle}),
    ).toBeVisible();
    await expect(
        modal.locator('[aria-selected="true"]').filter({hasText: expectedAdjacentTitle}),
    ).toBeVisible();
});

test("deleting a task from search keeps the modal open, removes the result, and selects the previous result", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task1 = await TestTask.create(session, {title: "Alpha search deletion task"});
    const task2 = await TestTask.create(session, {title: "Bravo search deletion task"});
    const task3 = await TestTask.create(session, {title: "Charlie search deletion task"});

    await indexEntitiesForKeywordSearch(space.id, [
        {type: "Task", id: task1.id},
        {type: "Task", id: task2.id},
        {type: "Task", id: task3.id},
    ]);

    await services.signIn(browserContext, session);
    await openSearchModal(page, space.id);

    const modal = page.getByTestId("SearchModal");
    const input = modal.getByPlaceholder(/^Search/).first();
    await input.fill("search deletion task");

    await expect(resultRow(modal, "Alpha search deletion task")).toBeVisible();
    await expect(resultRow(modal, "Bravo search deletion task")).toBeVisible();
    await expect(resultRow(modal, "Charlie search deletion task")).toBeVisible();

    await selectSearchResult(page, modal, input, "Bravo search deletion task");
    await expect(page.getByTestId("SearchModalPeek")).toBeVisible();
    await expect(
        page
            .getByTestId("SearchModalPeek")
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"}),
    ).toHaveText("Bravo search deletion task");

    const expectedAdjacentTitle = await getExpectedAdjacentResultTitle(
        modal,
        "Bravo search deletion task",
    );

    // Use the peek navigation-bar menu (same path as documents) so deletion goes
    // through the shared menuActions + onBeforeDelete hook.
    await page.getByTestId("SearchModalPeek").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Delete"}).click();
    await page
        .getByRole("alertdialog", {name: "Delete task?"})
        .getByRole("button", {name: "Delete"})
        .click();
    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await expect(modal).toBeVisible();
    await expect(input).toHaveValue("search deletion task");
    await expect(resultRow(modal, "Bravo search deletion task")).toBeHidden();
    await expect(resultRow(modal, "Alpha search deletion task")).toBeVisible();
    await expect(resultRow(modal, "Charlie search deletion task")).toBeVisible();

    await expect(
        page
            .getByTestId("SearchModalPeek")
            .getByTestId("TaskDetailViewMain")
            .getByRole("textbox", {name: "Title"}),
    ).toHaveText(expectedAdjacentTitle);
    await expect(
        modal.locator('[aria-selected="true"]').filter({hasText: expectedAdjacentTitle}),
    ).toBeVisible();
});

test("a rejected task deletion does not remove the search result", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task1 = await TestTask.create(session, {title: "Alpha rejected deletion task"});
    const task2 = await TestTask.create(session, {title: "Bravo rejected deletion task"});
    const task3 = await TestTask.create(session, {title: "Charlie rejected deletion task"});

    await indexEntitiesForKeywordSearch(space.id, [
        {type: "Task", id: task1.id},
        {type: "Task", id: task2.id},
        {type: "Task", id: task3.id},
    ]);

    await services.signIn(browserContext, session);
    await openSearchModal(page, space.id);

    const modal = page.getByTestId("SearchModal");
    const input = modal.getByPlaceholder(/^Search/).first();
    await input.fill("rejected deletion task");
    await expect(resultRow(modal, "Bravo rejected deletion task")).toBeVisible();
    await selectSearchResult(page, modal, input, "Bravo rejected deletion task");

    await page.route("**/api/rpc/**", async route => {
        const request = route.request();
        const requestBody = request.postData() ?? "";
        if (
            !request.url().includes("/deleteTaskAndAllChildren") &&
            !requestBody.includes("deleteTaskAndAllChildren")
        ) {
            await route.continue();
            return;
        }

        await route.abort("failed");
    });

    await page.getByTestId("SearchModalPeek").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Delete"}).click();

    const dialog = page.getByRole("alertdialog", {name: "Delete task?"});
    const deleteButton = dialog.getByRole("button", {name: "Delete"});
    await deleteButton.click();
    await expect(deleteButton).toBeEnabled();

    await expect(dialog).toBeVisible();
    await expect(resultRow(modal, "Bravo rejected deletion task")).toBeVisible();
});

test("deleting a nested task does not remove or advance from the selected search result", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task1 = await TestTask.create(session, {title: "Alpha nested deletion task"});
    const selectedTask = await TestTask.create(session, {
        title: "Bravo nested deletion task",
        layout: "Project",
    });
    const childTask = await TestTask.create(session, {
        title: "Nested child task",
        parent: selectedTask,
    });
    const task3 = await TestTask.create(session, {title: "Charlie nested deletion task"});

    await indexEntitiesForKeywordSearch(space.id, [
        {type: "Task", id: task1.id},
        {type: "Task", id: selectedTask.id},
        {type: "Task", id: task3.id},
    ]);

    await services.signIn(browserContext, session);
    await openSearchModal(page, space.id);

    const modal = page.getByTestId("SearchModal");
    const input = modal.getByPlaceholder(/^Search/).first();
    await input.fill("nested deletion task");
    await selectSearchResult(page, modal, input, "Bravo nested deletion task");

    const peek = page.getByTestId("SearchModalPeek");
    const childTaskRow = peek.getByTestId(`TaskRowView:${childTask.id}`);
    await expect(childTaskRow).toBeVisible();
    await childTaskRow.hover();
    await childTaskRow.locator('button[aria-label="Open"]').click();
    await expect(
        peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Nested child task");

    await peek.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Delete"}).click();
    await page
        .getByRole("alertdialog", {name: "Delete task?"})
        .getByRole("button", {name: "Delete"})
        .click();
    await expect(page.getByRole("alertdialog", {name: "Delete task?"})).toBeHidden();

    await expect(
        peek.getByTestId("TaskDetailViewMain").getByRole("textbox", {name: "Title"}),
    ).toHaveText("Bravo nested deletion task");
    await expect(resultRow(modal, "Bravo nested deletion task")).toBeVisible();
    await expect(
        modal.locator('[aria-selected="true"]').filter({hasText: "Bravo nested deletion task"}),
    ).toBeVisible();
});

function resultRow(modal: Locator, title: string) {
    return modal.locator("[aria-selected]").filter({hasText: title});
}

async function openSearchModal(page: Page, spaceId: SpaceId) {
    await page.goto(`/dev/empty/${spaceId}`);
    await page.waitForFunction("dev.ready");
    await page.getByLabel("Search").first().click();
    await expect(page.getByTestId("SearchModal")).toBeVisible();
}

async function selectSearchResult(page: Page, modal: Locator, input: Locator, resultText: string) {
    const selectedRow = modal.locator('[aria-selected="true"]').filter({hasText: resultText});

    let selected = false;
    for (let i = 0; i < 12 && !selected; i++) {
        await input.focus();
        await page.keyboard.press("ArrowDown");
        selected = await selectedRow
            .waitFor({timeout: 2000})
            .then(() => true)
            .catch(() => false);
    }

    expect(selected).toBe(true);
}

/**
 * Prefer the previous result in the current list order; fall back to the next
 * result when the deleted item is first. Matches search modal delete navigation.
 */
async function getExpectedAdjacentResultTitle(modal: Locator, deletedTitle: string) {
    const noun = deletedTitle.includes("document") ? "document" : "task";
    const resultTitles = [
        `Alpha search deletion ${noun}`,
        `Bravo search deletion ${noun}`,
        `Charlie search deletion ${noun}`,
    ];

    // Sort by visual Y position so list order matches what the modal advances through.
    const titlesWithPosition = await runAllPromises(
        resultTitles.map(async title => {
            const row = resultRow(modal, title);
            const box = (await row.count()) > 0 ? await row.first().boundingBox() : null;
            return box ? {title, y: box.y} : null;
        }),
    );

    const sortedTitles = titlesWithPosition
        .filter((entry): entry is {title: string; y: number} => entry !== null)
        .sort((a, b) => a.y - b.y)
        .map(entry => entry.title);

    const deletedIndex = sortedTitles.indexOf(deletedTitle);
    expect(deletedIndex).toBeGreaterThanOrEqual(0);

    const previousTitle = sortedTitles[deletedIndex - 1];
    const nextTitle = sortedTitles[deletedIndex + 1];
    const adjacentTitle = previousTitle ?? nextTitle;
    expect(adjacentTitle).toBeTruthy();
    return assertExists(adjacentTitle);
}

type KeywordSearchEntity =
    | {readonly type: "Document"; readonly id: DocumentId}
    | {readonly type: "Task"; readonly id: TaskId};

async function indexEntitiesForKeywordSearch(
    spaceId: SpaceId,
    entities: ReadonlyArray<KeywordSearchEntity>,
) {
    await runAllPromises(
        entities.map(async entity => {
            switch (entity.type) {
                case "Document":
                    await context.jobs.sendAndWait({
                        type: "IndexSearchEntity",
                        spaceId,
                        update: {
                            type: "Document",
                            documentId: entity.id,
                            updatedTraits: {type: "None"},
                        },
                    });
                    break;
                case "Task":
                    await context.jobs.sendAndWait({
                        type: "IndexSearchEntity",
                        spaceId,
                        update: {
                            type: "Task",
                            taskId: entity.id,
                            updatedTraits: {type: "None"},
                        },
                    });
                    break;
                default:
                    throw exhaustive(entity);
            }

            const searchEntityId =
                entity.type === "Document"
                    ? (`Document:${entity.id}` as const)
                    : (`Task:${entity.id}` as const);

            await expect(async () => {
                expect(
                    await context.opensearch.getDocWithoutSourceIfExists(
                        SearchEntityKeywordIndex,
                        spaceId,
                        searchEntityId,
                    ),
                ).not.toBeNull();
            }).toPass({timeout: 5000});
        }),
    );

    await context.opensearch.refresh(SearchEntityKeywordIndex);
}
