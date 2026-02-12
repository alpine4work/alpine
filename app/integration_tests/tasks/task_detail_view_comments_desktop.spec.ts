import {Page, expect, test} from "@playwright/test";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const {context, services} = createTestServices();

async function getMessageInputDropPosition(page: Page) {
    const messageInputBox = assertExists(
        await page.getByTestId("MessageInputDropTarget").boundingBox(),
    );

    return {
        clientX: Math.round(messageInputBox.x + messageInputBox.width / 2),
        clientY: Math.round(messageInputBox.y + messageInputBox.height / 2),
    };
}

async function openGhostTaskFromCreateMenu(page: Page) {
    await page.getByLabel("Create").click();
    await page.getByRole("menuitem", {name: "Task"}).click();

    const peek = page.getByTestId("PeekStackOverlay");
    await expect(peek).toBeVisible();
    await expect(peek.getByTestId("TaskDetailViewMain")).toBeVisible();

    await peek.getByRole("button", {name: "Expand"}).click();
    await expect(peek).toBeHidden();
    await expect(page.getByTestId("TaskDetailViewMain")).toBeVisible();
}

test("can create a comment on a ghost task", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/dev/empty`);

    await openGhostTaskFromCreateMenu(page);

    await page.getByRole("textbox", {name: "New comment"}).fill("Test task comment");
    await page.getByRole("button", {name: "Send comment"}).click();

    await expect(page.getByTestId(/^MessageView:/).getByText("Test task comment")).toBeVisible();

    await page.evaluate("dev.globalLoadingIndicator.waitForSavingIndicator()");
    await page.reload();

    await expect(page.getByTestId(/^MessageView:/).getByText("Test task comment")).toBeVisible();
});

test("can create a comment with a file on a ghost task", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/dev/empty`);

    await openGhostTaskFromCreateMenu(page);

    await expect(page.getByRole("textbox", {name: "New comment"})).toBeVisible();

    const fileContents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const fileDataTransfer = await page.evaluateHandle(fileHexContents => {
        const fileBytes = new Uint8Array(Math.ceil(fileHexContents.length / 2));

        for (let i = 0; i < fileBytes.length; i++)
            fileBytes[i] = parseInt(fileHexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([fileBytes], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, fileContents.toString("hex"));

    const dropTarget = page.getByTestId("MessageInputDropTarget");
    await expect(dropTarget).toBeVisible();

    await dropTarget.dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: fileDataTransfer,
    });

    await dropTarget.dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: fileDataTransfer,
    });

    const inputPreview = dropTarget.getByTestId("ContentFilePreview:image/jpeg");
    await expect(inputPreview).toBeVisible();

    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    await page.getByRole("button", {name: "Send comment"}).click();

    await expect(inputPreview).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    await page.evaluate("dev.globalLoadingIndicator.waitForSavingIndicator()");
    await page.reload();

    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
});

test("comment access can be gained and lost in realtime", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection1 = await TestTaskCollection.create(session1, {name: "Collection 1"});
    const task1 = await TestTask.create(session1, {title: "Task 1"});
    await task1.addCollection(session1, collection1);
    await task1.createComment(session1, "Comment 1");
    await collection1.access.grant(session1, session2, "View");

    const collection2 = await TestTaskCollection.create(session1, {name: "Collection 2"});
    const task2 = await TestTask.create(session1, {title: "Task 2"});
    await task2.addCollection(session1, collection2);
    await task2.createComment(session1, "Comment 2");
    await collection2.access.grant(session1, session2, "Comment");

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/tasks/collections/${collection1.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/tasks/${task1.id}`);

    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await expect(page2.getByText("Comment 1")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();
    await page1
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button", {name: "can view"})
        .click();
    await page1.getByRole("menuitem", {name: "can comment"}).click();

    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByText("Comment 1")).toBeVisible();

    await page2.goto(`/s/${space.id}/tasks/${task2.id}`);

    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByText("Comment 2")).toBeVisible();

    await page1.goto(`/s/${space.id}/tasks/collections/${collection2.id}`);
    await page1.getByRole("button", {name: "Share"}).click();
    await page1
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button", {name: "can comment"})
        .click();
    await page1.getByRole("menuitem", {name: "can view"}).click();

    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await expect(page2.getByText("Comment 2")).toBeHidden();

    await browserContext2.close();
});

test("task comments update in realtime across accounts", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {name: "Test Collection"});
    const task = await TestTask.create(session1, {title: "Task"});
    await task.addCollection(session1, collection);
    await collection.access.grant(session1, session2, "Comment");

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/tasks/${task.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/tasks/${task.id}`);

    await expect(page1.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "New comment"})).toBeVisible();

    await expect(page2.getByText("Realtime comment")).toBeHidden();

    await page1.getByRole("textbox", {name: "New comment"}).fill("Realtime comment");
    await page1.getByRole("button", {name: "Send comment"}).click();

    await expect(page2.getByText("Realtime comment")).toBeVisible();

    await browserContext2.close();
});
