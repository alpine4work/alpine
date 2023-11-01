import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel, createPost} from "~/server/forum/data/forum_table.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

const context = createTestContext();
const services = createTestServices(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
createTestSession(context, space, {name: "Siobahn Roy"});
createTestSession(context, space, {name: "Kendall Roy"});
createTestSession(context, space, {name: "Emily 1"});
createTestSession(context, space, {name: "Emily 2"});
createTestSession(context, space, {name: "Emily 3"});

test("can search for an account in mention menu", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await page.getByRole("textbox", {name: "New comment"}).type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeVisible();
    await page.getByRole("textbox", {name: "New comment"}).type("Siobahn");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("ArrowDown");
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        // NOTE(calebmer): In CI mobile doesn't seem to like `ArrowDown`?
        await page.getByTestId("ContentEditorMentionFloater").getByText("Siobahn").click();
    }
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall", {exact: true})).toBeHidden();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await page.getByRole("button", {name: "Send comment"}).click();
    }
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(page.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall", {exact: true})).toBeHidden();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn", {exact: true}),
    ).toBeVisible();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn Roy", {exact: true}),
    ).toBeHidden();

    await page.reload();

    await expect(page.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall", {exact: true})).toBeHidden();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn")).toBeVisible();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn Roy"),
    ).toBeHidden();
});

test("can undo to get the full mention when a short mention was inferred", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await page.getByRole("textbox", {name: "New comment"}).type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await page.getByRole("textbox", {name: "New comment"}).type("Siobahn");
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("ArrowDown");
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        // NOTE(calebmer): In CI mobile doesn't seem to like `ArrowDown`?
        await page.getByTestId("ContentEditorMentionFloater").getByText("Siobahn").click();
    }
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn", {exact: true})).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await page.getByRole("textbox", {name: "New comment"}).press(`${modifier}+z`);
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await page.getByRole("button", {name: "Send comment"}).click();
    }
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn Roy", {exact: true}),
    ).toBeVisible();

    await page.reload();

    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn Roy", {exact: true}),
    ).toBeVisible();
});

test("if a name is ambiguous you get the full mention and pressing backspace will get a short mention", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await page.getByRole("textbox", {name: "New comment"}).type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await page.getByRole("textbox", {name: "New comment"}).type("Emily 1");
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("ArrowDown");
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        // NOTE(calebmer): In CI mobile doesn't seem to like `ArrowDown`?
        await page.getByTestId("ContentEditorMentionFloater").getByText("Emily 1").click();
    }
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Emily", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 1", {exact: true})).toBeVisible();
    await expect(page.getByText("Emily 2", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 3", {exact: true})).toBeHidden();
    await page.getByRole("textbox", {name: "New comment"}).press("Backspace");
    await expect(page.getByText("Emily", {exact: true})).toBeVisible();
    await expect(page.getByText("Emily 1", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 2", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 3", {exact: true})).toBeHidden();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await page.getByRole("button", {name: "Send comment"}).click();
    }
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(page.getByText("Emily", {exact: true})).toBeVisible();
    await expect(page.getByText("Emily 1", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 2", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 3", {exact: true})).toBeHidden();

    await page.reload();

    await expect(page.getByText("Emily", {exact: true})).toBeVisible();
    await expect(page.getByText("Emily 1", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 2", {exact: true})).toBeHidden();
    await expect(page.getByText("Emily 3", {exact: true})).toBeHidden();
});
