import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";

const {context, services} = createTestServices();

// These tests feature multiple browsers collaboratively editing the same task
// notes so they may take a while.
test.setTimeout(2 * 60 * 1000);

function notes(page: Page) {
    return page.getByRole("textbox", {name: "Notes"});
}

// Append text to the end of the task notes editor. Focusing places the caret in
// the editor and pressing `End` moves it to the end of the (single-line) content
// so we always append rather than prepend.
async function appendTextToNotes(page: Page, text: string) {
    await notes(page).focus();
    await notes(page).press("End");
    await notes(page).pressSequentially(text);
}

test("can write collaboratively in task notes", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/task/${task.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/task/${task.id}`);

    await expect(notes(page1)).toHaveText("");
    await expect(notes(page2)).toHaveText("");

    await appendTextToNotes(page1, "Test notes content 1");

    await expect(notes(page1)).toHaveText("Test notes content 1");
    await expect(notes(page2)).toHaveText("Test notes content 1");

    await appendTextToNotes(page2, " and 2");

    await expect(notes(page1)).toHaveText("Test notes content 1 and 2");
    await expect(notes(page2)).toHaveText("Test notes content 1 and 2");

    await appendTextToNotes(page1, " and 3");

    await expect(notes(page1)).toHaveText("Test notes content 1 and 2 and 3");
    await expect(notes(page2)).toHaveText("Test notes content 1 and 2 and 3");

    await browserContext2.close();
});

test("task notes survive a reload mid-collaboration", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/task/${task.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/task/${task.id}`);

    await expect(notes(page1)).toHaveText("");
    await expect(notes(page2)).toHaveText("");

    await appendTextToNotes(page1, "Before reload");

    await expect(notes(page2)).toHaveText("Before reload");

    // Make sure the change has been persisted before reloading the second client.
    await page2.evaluate("dev.globalLoadingIndicator.waitForSavingIndicator()");
    await page2.reload();

    await expect(notes(page2)).toHaveText("Before reload");

    await appendTextToNotes(page2, " after reload");

    await expect(notes(page1)).toHaveText("Before reload after reload");
    await expect(notes(page2)).toHaveText("Before reload after reload");

    await browserContext2.close();
});
