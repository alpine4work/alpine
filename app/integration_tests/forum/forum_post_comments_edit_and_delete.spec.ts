import {Page, expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {createChannel, createPost, createPostComment} from "~/server/dynamo/forum_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {createSimplePostContent} from "~/shared/forum/post_content_schema";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema";

const context = createTestContext();
const server = createTestServer(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});

function getAvatarInPileByInitials(page: Page, initials: string) {
    return page.getByTestId(/PostContentViewFooter/).getByText(initials);
}

test("can edit a post comment", async ({page, context: browserContext, isMobile}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    const comment = await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();

    await page
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeVisible();

    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeVisible();
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeHidden();
    await page.getByRole("menuitem", {name: "Edit"}).click();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeVisible();

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "LR")).toBeVisible();

    await page.getByRole("textbox", {name: "Comment", exact: true}).press("ArrowRight");
    await page.getByRole("textbox", {name: "Comment", exact: true}).press("Backspace");
    await page.getByRole("textbox", {name: "Comment", exact: true}).press("2");
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeVisible();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "Comment", exact: true}).press("Enter");
    } else {
        await page.getByRole("button", {name: "Save"}).click();
    }
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeHidden();

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "LR")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeHidden();
    await expect(page.getByText("Test post comment content 2")).toBeVisible();
});

test("can not edit a post comment that's not yours", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();

    await page
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
});

test("can see a post comment edited in realtime", async ({
    page: page1,
    context: browserContext1,
    browser,
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

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("Test post comment content 1")).toBeVisible();

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "SR")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();

    await page2
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await page2.getByRole("menuitem", {name: "Edit"}).click();

    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("ArrowRight");
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Backspace");
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("2");
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Enter");
    } else {
        await page2.getByRole("button", {name: "Save"}).click();
    }

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "SR")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
});

test("can delete a post comment", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    const comment = await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();

    await page
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await expect(page.getByRole("menuitem", {name: "Delete"})).toBeVisible();

    await expect(page.getByRole("menuitem", {name: "Delete"})).toBeVisible();
    await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
    await page.getByRole("menuitem", {name: "Delete"}).click();
    await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
    await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "LR")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByText("Comment deleted")).toBeHidden();

    await page.getByRole("button", {name: "Delete"}).click();

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "LR")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeHidden();
    await expect(page.getByText("Comment deleted")).toBeVisible();
});

test("can not delete a post comment that's not yours", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();

    await page
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
});

test("can see a post comment deleted in realtime", async ({
    page: page1,
    context: browserContext1,
    browser,
}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("Test post comment content 1")).toBeVisible();

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "SR")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Comment deleted")).toBeHidden();

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await page2
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await expect(page2.getByRole("menuitem", {name: "Delete"})).toBeVisible();
    await expect(page2.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
    await page2.getByRole("menuitem", {name: "Delete"}).click();
    await expect(page2.getByRole("menuitem", {name: "Delete"})).toBeHidden();
    await expect(page2.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
    await page2.getByRole("button", {name: "Delete"}).click();
    await expect(page2.getByRole("menuitem", {name: "Delete"})).toBeHidden();
    await expect(page2.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "SR")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Comment deleted")).toBeVisible();
});

test("will backfill an edit in realtime when comments are reopened", async ({
    page: page1,
    context: browserContext1,
    browser,
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

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();

    await page2
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await page2.getByRole("menuitem", {name: "Edit"}).click();

    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("ArrowRight");
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Backspace");
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("2");
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Enter");
    } else {
        await page2.getByRole("button", {name: "Save"}).click();
    }

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
});

test("will backfill a delete in realtime when comments are reopened", async ({
    page: page1,
    context: browserContext1,
    browser,
}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Comment deleted")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Comment deleted")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Comment deleted")).toBeHidden();

    await page2
        .getByTestId(`MessageView:${post.id}:${comment.index}`)
        .getByRole("button", {name: "More"})
        .press("Enter");

    await page2.getByRole("menuitem", {name: "Delete"}).click();
    await expect(page2.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
    await page2.getByRole("button", {name: "Delete"}).click();

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Comment deleted")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Comment deleted")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
});
