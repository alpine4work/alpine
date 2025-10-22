import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {updateAccountReactionCharacter} from "~/server/accounts/accounts_actions.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {createPostComment} from "~/server/forum/data/post_messaging.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});
const session3 = createTestSession(context, space, {name: "Kendall Roy"});

test.beforeAll(async () => {
    await runAllPromises([
        updateAccountReactionCharacter(context.action(session1), {type: "Cat", variant: "Yellow"}),
        updateAccountReactionCharacter(context.action(session2), {type: "Yeti", variant: "Blue"}),
        updateAccountReactionCharacter(context.action(session3), {type: "Tree", variant: "Green"}),
    ]);
});

function getAvatarInPileByInitials(page: Page, initials: string) {
    return page.getByTestId(/PostContentViewFooter/).getByAltText(initials);
}

async function tapSendComment(page: Page) {
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();

    // Make sure the keyboard toolbar isn't animating when we tap.
    await (await page
        .getByRole("button", {name: "Send comment"})
        .elementHandle())!.waitForElementState("stable");

    await page.getByRole("button", {name: "Send comment"}).tap();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();
}

test("can open and close post comments in channel", async ({
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

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 1"),
        fileIds: [],
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 2"),
        fileIds: [],
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 3"),
        fileIds: [],
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByText("Test post content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeHidden();
    await expect(page.getByText("Test post comment content 2")).toBeHidden();
    await expect(page.getByText("Test post comment content 3")).toBeHidden();

    await page.getByRole("button", {name: "3 comments"}).click();

    await expect(page.getByText("Test post content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 2")).toBeVisible();
    await expect(page.getByText("Test post comment content 3")).toBeVisible();

    if (!isMobile) {
        await page.getByRole("button", {name: "3 comments"}).click();
    } else {
        await page.getByRole("button", {name: "Go back"}).click();
    }

    await expect(page.getByText("Test post content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeHidden();
    await expect(page.getByText("Test post comment content 2")).toBeHidden();
    await expect(page.getByText("Test post comment content 3")).toBeHidden();
});

test("comments are always open at a direct post url", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 1"),
        fileIds: [],
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 2"),
        fileIds: [],
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 3"),
        fileIds: [],
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByText("Test post content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 2")).toBeVisible();
    await expect(page.getByText("Test post comment content 3")).toBeVisible();

    await expect(page.getByLabel("3 comments")).toBeVisible();
    await expect(page.getByRole("button", {name: "3 comments"})).toBeHidden();

    await page.getByLabel("3 comments").click();

    await expect(page.getByText("Test post content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByText("Test post comment content 2")).toBeVisible();
    await expect(page.getByText("Test post comment content 3")).toBeVisible();
});

test("can comment on a post", async ({page, context: browserContext, isMobile}) => {
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

    await expect(page.getByRole("textbox", {name: "New comment"})).toBeHidden();
    await page.getByRole("button", {name: "0 comments"}).click();
    await expect(page.getByRole("textbox", {name: "New comment"})).toBeVisible();

    await expect(getAvatarInPileByInitials(page, "Blue yeti")).toBeHidden();
    await expect(page.getByLabel("0 comments")).toBeVisible();
    await expect(page.getByLabel("1 comment")).toBeHidden();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();
    await page.getByRole("textbox", {name: "New comment"}).type("Test post comment content 1");
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 1",
    );
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page);
    }
    await expect(getAvatarInPileByInitials(page, "Blue yeti")).toBeVisible();
    await expect(page.getByLabel("0 comments")).toBeHidden();
    await expect(page.getByLabel("1 comment")).toBeVisible();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText("");
    await expect(page.getByText("Test post comment content 1")).toBeVisible();

    await expect(getAvatarInPileByInitials(page, "Blue yeti")).toBeVisible();
    await expect(page.getByLabel("1 comment")).toBeVisible();
    await expect(page.getByLabel("2 comments")).toBeHidden();
    await page.getByRole("textbox", {name: "New comment"}).type("Test post comment content 2");
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 2",
    );
    if (!isMobile) {
        await page.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page);
    }
    await expect(getAvatarInPileByInitials(page, "Blue yeti")).toBeVisible();
    await expect(page.getByLabel("1 comment")).toBeHidden();
    await expect(page.getByLabel("2 comments")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText("");
    await expect(page.getByText("Test post comment content 2")).toBeVisible();
});

test("can see comments appear in realtime", async ({
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

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByLabel("0 comments")).toBeVisible();
    await expect(page1.getByLabel("1 comment")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await page2.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 1");
    await expect(page2.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 1",
    );
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page2);
    }

    await expect(page1.getByLabel("0 comments")).toBeHidden();
    await expect(page1.getByLabel("1 comment")).toBeVisible();
    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    const browserContext3 = await browser.newContext();
    await services.signIn(browserContext3, session3);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/s/${space.id}/posts/${post.id}`);

    await page3.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 2");
    await expect(page3.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 2",
    );
    if (!isMobile) {
        await page3.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page3);
    }

    await expect(page1.getByLabel("1 comment")).toBeHidden();
    await expect(page1.getByLabel("2 comments")).toBeVisible();
    await expect(page1.getByLabel("3 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeVisible();
    await expect(page1.getByText("Test post content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    await page2.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 3");
    await expect(page2.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 3",
    );
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page2);
    }

    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(page1.getByLabel("3 comments")).toBeVisible();
    await expect(page1.getByLabel("4 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeVisible();
    await expect(page1.getByText("Test post content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 3")).toBeVisible();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    await page1.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 4");
    await expect(page1.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 4",
    );
    if (!isMobile) {
        await page1.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page1);
    }

    await expect(page1.getByLabel("3 comments")).toBeHidden();
    await expect(page1.getByLabel("4 comments")).toBeVisible();
    await expect(page1.getByLabel("5 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeVisible();
    await expect(page1.getByText("Test post content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 3")).toBeVisible();
    await expect(page1.getByText("Test post comment content 4")).toBeVisible();

    await browserContext2.close();
    await browserContext3.close();
});

test("can see new comments when opening post comments", async ({
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

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await page1.getByRole("button", {name: "0 comments"}).click();

    await expect(page1.getByLabel("0 comments")).toBeVisible();
    await expect(page1.getByLabel("1 comment")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await page2.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 1");
    await expect(page2.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 1",
    );
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page2);
    }

    await expect(page1.getByLabel("0 comments")).toBeHidden();
    await expect(page1.getByLabel("1 comment")).toBeVisible();
    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    if (!isMobile) {
        await page1.getByRole("button", {name: "1 comment"}).click();
    } else {
        await page1.getByRole("button", {name: "Go back"}).click();
    }

    await expect(page1.getByLabel("0 comments")).toBeHidden();
    await expect(page1.getByLabel("1 comment")).toBeVisible();
    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    const browserContext3 = await browser.newContext();
    await services.signIn(browserContext3, session3);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/s/${space.id}/posts/${post.id}`);

    await page3.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 2");
    await expect(page3.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 2",
    );
    if (!isMobile) {
        await page3.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page3);
    }

    await expect(page1.getByLabel("0 comments")).toBeHidden();
    await expect(page1.getByLabel("1 comment")).toBeVisible();
    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    await page2.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 3");
    await expect(page2.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 3",
    );
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page2);
    }

    await expect(page1.getByLabel("0 comments")).toBeHidden();
    await expect(page1.getByLabel("1 comment")).toBeVisible();
    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeHidden();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await expect(page1.getByText("Test post comment content 3")).toBeHidden();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    await page1.getByRole("button", {name: "1 comment"}).click();

    await expect(page1.getByLabel("2 comments")).toBeHidden();
    await expect(page1.getByLabel("3 comments")).toBeVisible();
    await expect(page1.getByLabel("4 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeVisible();
    await expect(page1.getByText("Test post content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 3")).toBeVisible();
    await expect(page1.getByText("Test post comment content 4")).toBeHidden();

    await page1.getByRole("textbox", {name: "New comment"}).fill("Test post comment content 4");
    await expect(page1.getByRole("textbox", {name: "New comment"})).toHaveText(
        "Test post comment content 4",
    );
    if (!isMobile) {
        await page1.getByRole("textbox", {name: "New comment"}).press("Enter");
    } else {
        await tapSendComment(page1);
    }

    await expect(page1.getByLabel("3 comments")).toBeHidden();
    await expect(page1.getByLabel("4 comments")).toBeVisible();
    await expect(page1.getByLabel("5 comments")).toBeHidden();
    await expect(getAvatarInPileByInitials(page1, "Yellow cat")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Green tree")).toBeVisible();
    await expect(page1.getByText("Test post content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 3")).toBeVisible();
    await expect(page1.getByText("Test post comment content 4")).toBeVisible();

    await browserContext2.close();
    await browserContext3.close();
});
