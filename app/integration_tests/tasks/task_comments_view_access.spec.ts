import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const {context, services} = createTestServices();

// A task's comments are readable at "View" because the activity feed interleaves
// activity with them — a read-only member needs the whole conversation to make
// sense of the timeline. Writing still needs "Comment", so these members get the
// conversation with every way to contribute to it removed.
async function createTaskWithViewOnlyMember() {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({name: "Mason Clay"});
    const viewerSession = await space.createSession({name: "Rachel Stone"});

    const task = await TestTask.create(ownerSession, {title: "Shared read-only"});
    await task.createComment(ownerSession, "Comment a viewer can read");

    const collection = await TestTaskCollection.create(ownerSession);
    await collection.access.set(ownerSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [ownerSession.account.id, {level: "Manage", generation: 0}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });
    await task.addCollection(ownerSession, collection);
    await ProcessContextModule.waitForTestTasks();

    return {task, ownerSession, viewerSession};
}

test("a view-only member reads a task\u2019s comments", async ({page, context: browserContext}) => {
    const {task, viewerSession} = await createTaskWithViewOnlyMember();

    await services.signIn(browserContext, viewerSession);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByText("Comment a viewer can read")).toBeVisible();
});

test("a view-only member gets a disabled comment input", async ({
    page,
    context: browserContext,
    browser,
}) => {
    const {task, ownerSession, viewerSession} = await createTaskWithViewOnlyMember();

    await services.signIn(browserContext, viewerSession);
    await page.goto(`/task/${task.id}`);

    await expect(page.getByTestId("DisabledMessageInput")).toBeVisible();
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveCount(0);

    // The same task gives its owner a working composer, so the assertions above are
    // about this member's access and not about the page failing to render.
    const ownerBrowser = await browser.newContext();
    await services.signIn(ownerBrowser, ownerSession);
    const ownerPage = await ownerBrowser.newPage();
    await ownerPage.goto(`/task/${task.id}`);
    await expect(ownerPage.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(ownerPage.getByTestId("DisabledMessageInput")).toHaveCount(0);
    await ownerBrowser.close();
});

test("a view-only member can\u2019t react to a comment", async ({
    page,
    context: browserContext,
}) => {
    const {task, viewerSession} = await createTaskWithViewOnlyMember();

    await services.signIn(browserContext, viewerSession);
    await page.goto(`/task/${task.id}`);

    const comment = page.getByText("Comment a viewer can read");
    await expect(comment).toBeVisible();
    await comment.click({button: "right"});

    // Read-only comments offer no reaction, reply, or edit actions. Copying a link
    // stays available, so an empty menu wouldn't prove the gating works.
    await expect(page.getByText("Add reaction")).toHaveCount(0);
    await expect(page.getByText("Reply", {exact: true})).toHaveCount(0);
});
