import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel, createPost} from "~/server/forum/data/forum_table.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

const context = createTestContext({shouldStartOpensearch: true});
const services = createTestServices(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

test("can create posts", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByText("Test Channel")).toBeVisible();

    await expect(page.getByRole("button", {name: "Post"})).toBeDisabled();
    await page.getByLabel("New post").type("Test post content 1");
    await expect(page.getByRole("button", {name: "Post"})).toBeEnabled();

    await expect(page.getByLabel("New post")).toHaveText("Test post content 1");
    await expect(page.getByText("0 comments")).toBeHidden();
    await page.getByRole("button", {name: "Post"}).click();
    await expect(page.getByLabel("New post")).not.toHaveText("Test post content 1");
    await expect(page.getByText("0 comments")).toBeVisible();
    await expect(page.getByText("Test post content 1")).toBeVisible();

    await expect(page.getByRole("button", {name: "Post"})).toBeDisabled();
    await page.getByLabel("New post").type("Test post content 2");
    await expect(page.getByRole("button", {name: "Post"})).toBeEnabled();

    await expect(page.getByLabel("New post")).toHaveText("Test post content 2");
    await page.getByRole("button", {name: "Post"}).click();
    await expect(page.getByLabel("New post")).not.toHaveText("Test post content 2");
    await expect(page.getByText("Test post content 2")).toBeVisible();
});

test("can create multiline formatted posts", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByText("Test Channel")).toBeVisible();

    await expect(page.getByRole("button", {name: "Post"})).toBeDisabled();
    await page.getByLabel("New post").type("Test post content 1");
    await page.getByLabel("New post").press("Enter");
    await page.getByLabel("New post").type("# Test heading");
    await page.getByLabel("New post").press("Enter");
    await page.getByLabel("New post").type("More test post content");
    await expect(page.getByRole("button", {name: "Post"})).toBeEnabled();

    await page.getByRole("button", {name: "Post"}).click();

    await expect(page.getByText("0 comments")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Test heading"})).toBeVisible();
});

test("can edit a post", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByText("Test post content 1")).toBeVisible();

    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
    await page.getByRole("button", {name: "More"}).click();
    await expect(page.getByRole("alertdialog", {name: "Edit post"})).toBeHidden();
    await page.getByRole("menuitem", {name: "Edit"}).click();
    await expect(page.getByRole("alertdialog", {name: "Edit post"})).toBeVisible();

    await expect(page.getByLabel("Post", {exact: true})).toHaveText("Test post content 1");

    // Can update with the save button.
    await page.getByLabel("Post", {exact: true}).press("Backspace");
    await page.getByLabel("Post", {exact: true}).type("2");
    await page.getByRole("button", {name: "Save"}).click();

    await expect(page.getByRole("alertdialog", {name: "Edit post"})).toBeHidden();
    await expect(page.getByText("Test post content 1")).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeVisible();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Edit"}).click();
    await expect(page.getByRole("alertdialog", {name: "Edit post"})).toBeVisible();

    // Can update with Cmd-Enter keyboard shortcut.
    await page.getByLabel("Post", {exact: true}).press("Backspace");
    await page.getByLabel("Post", {exact: true}).type("3");
    await page.getByLabel("Post", {exact: true}).press(`${modifier}+Enter`);

    await expect(page.getByRole("alertdialog", {name: "Edit post"})).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeHidden();
    await expect(page.getByText("Test post content 3")).toBeVisible();
});

test("asks for confirmation when closing edit post modal", async ({
    page,
    context: browserContext,
}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeHidden();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
    await page.getByRole("button", {name: "More"}).click();
    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
});
