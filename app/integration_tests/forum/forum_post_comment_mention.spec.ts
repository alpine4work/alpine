import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {createChannel, createPost} from "~/server/dynamo/forum_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {createSimplePostContent} from "~/shared/content/post_content_schema";

const context = createTestContext();
const server = createTestServer(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
createTestSession(context, space, {name: "Siobahn Roy"});
createTestSession(context, space, {name: "Kendall Roy"});

test("can search for an account in mention menu", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await page.getByRole("textbox", {name: "New comment"}).type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await page.getByRole("textbox", {name: "New comment"}).type("Siobahn");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await page.getByRole("textbox", {name: "New comment"}).press("ArrowDown");
    await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await page.getByRole("button", {name: "Send comment"}).click();
    }
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn Roy"),
    ).toBeVisible();

    await page.reload();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByText("Siobahn Roy"),
    ).toBeVisible();
});
