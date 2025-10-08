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

test.beforeAll(async () => {
    await runAllPromises([
        updateAccountReactionCharacter(context.action(session1), {type: "Cat", variant: "Yellow"}),
        updateAccountReactionCharacter(context.action(session2), {type: "Yeti", variant: "Blue"}),
    ]);
});

function getAvatarInPileByInitials(page: Page, initials: string) {
    return page.getByTestId(/PostContentViewFooter/).getByAltText(initials);
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
        fileIds: [],
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    const editTestId = async (testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Edit").click();
            await expect(page.getByTestId("ContextMenu").getByText("Edit")).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeVisible();
            await message.dispatchEvent("touchend");
            await page.getByRole("menuitem", {name: "Edit"}).click();
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
        }
    };

    await expect(page.getByText("Test post comment content 1")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeHidden();
    await editTestId(`MessageView:${post.id}:${comment.index}`);
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeVisible();

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "Yellow cat")).toBeVisible();

    await expect(page.getByLabel("Comment", {exact: true})).toBeFocused();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "Comment", exact: true}).press("ArrowRight");
    } else {
        await page.getByRole("textbox", {name: "Comment", exact: true}).press("End");
    }
    await page.getByRole("textbox", {name: "Comment", exact: true}).press("Backspace");
    await page.getByRole("textbox", {name: "Comment", exact: true}).press("2");
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeVisible();
    if (!isMobile) {
        await page.getByRole("textbox", {name: "Comment", exact: true}).press("Enter");
    } else {
        await expect(page.getByRole("button", {name: "Save"})).toBeEnabled();

        // Make sure the keyboard toolbar isn't animating when we tap.
        await (await page.getByRole("button", {name: "Save"}).elementHandle())!.waitForElementState(
            "stable",
        );

        await page.getByRole("button", {name: "Save"}).tap();
        await expect(page.getByRole("button", {name: "Save"})).toBeHidden();
    }
    await expect(page.getByRole("textbox", {name: "Comment", exact: true})).toBeHidden();

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "Yellow cat")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeHidden();
    await expect(page.getByText("Test post comment content 2")).toBeVisible();
});

test("can’t edit or delete a post comment that’s not yours", async ({
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

    const comment = await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
        fileIds: [],
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page.getByText("Test post comment content 1")).toBeVisible();

    {
        const message = page
            .getByTestId(`MessageView:${post.id}:${comment.index}`)
            .getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await expect(page.getByTestId("ContextMenu").getByText("Copy link")).toBeHidden();
            await expect(page.getByTestId("ContextMenu").getByText("Edit")).toBeHidden();
            await expect(page.getByTestId("ContextMenu").getByText("Delete")).toBeHidden();
            await message.dispatchEvent("contextmenu");
            await expect(page.getByTestId("ContextMenu").getByText("Copy link")).toBeVisible();
            await expect(page.getByTestId("ContextMenu").getByText("Edit")).toBeHidden();
            await expect(page.getByTestId("ContextMenu").getByText("Delete")).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeHidden();
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await message.dispatchEvent("touchend");
        }
    }
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
        fileIds: [],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/posts/${post.id}`);

    const editTestId = async (page: Page, testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Edit").click();
            await expect(page.getByTestId("ContextMenu").getByText("Edit")).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeVisible();
            await message.dispatchEvent("touchend");
            await page.getByRole("menuitem", {name: "Edit"}).click();
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
        }
    };

    await expect(page1.getByText("Test post comment content 1")).toBeVisible();

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();

    await editTestId(page2, `MessageView:${post.id}:${comment.index}`);

    await expect(page2.getByLabel("Comment", {exact: true})).toBeFocused();
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("ArrowRight");
    } else {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("End");
    }
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Backspace");
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("2");
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Enter");
    } else {
        await expect(page2.getByRole("button", {name: "Save"})).toBeEnabled();

        // Make sure the keyboard toolbar isn't animating when we tap.
        await (await page2
            .getByRole("button", {name: "Save"})
            .elementHandle())!.waitForElementState("stable");

        await page2.getByRole("button", {name: "Save"}).tap();
        await expect(page2.getByRole("button", {name: "Save"})).toBeHidden();
    }

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();

    await browserContext2.close();
});

test("can delete a post comment", async ({page, context: browserContext, isMobile}) => {
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
        fileIds: [],
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    const deleteTestId = async (testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Delete").click();
            await expect(page.getByTestId("ContextMenu").getByText("Delete")).toBeHidden();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
            await page.getByRole("button", {name: "Delete"}).click();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeVisible();
            await message.dispatchEvent("touchend");
            await page.getByRole("menuitem", {name: "Delete"}).click();
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
            await page.getByRole("button", {name: "Delete"}).click();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
        }
    };

    await expect(page.getByText("Test post comment content 1")).toBeVisible();
    await expect(page.getByText("Deleted comment")).toBeHidden();

    await deleteTestId(`MessageView:${post.id}:${comment.index}`);

    await expect(page.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page, "Yellow cat")).toBeVisible();
    await expect(page.getByText("Test post comment content 1")).toBeHidden();
    await expect(page.getByText("Deleted comment")).toBeVisible();
});

test("can see a post comment deleted in realtime", async ({
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
        fileIds: [],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/posts/${post.id}`);

    const deleteTestId = async (page: Page, testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Delete").click();
            await expect(page.getByTestId("ContextMenu").getByText("Delete")).toBeHidden();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
            await page.getByRole("button", {name: "Delete"}).click();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeVisible();
            await message.dispatchEvent("touchend");
            await page.getByRole("menuitem", {name: "Delete"}).click();
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
            await page.getByRole("button", {name: "Delete"}).click();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
        }
    };

    await expect(page1.getByText("Test post comment content 1")).toBeVisible();

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Deleted comment")).toBeHidden();

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await deleteTestId(page2, `MessageView:${post.id}:${comment.index}`);

    await expect(page2.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page2, "Blue yeti")).toBeVisible();
    await expect(page2.getByText("Test post comment content 1")).toBeHidden();
    await expect(page2.getByText("Deleted comment")).toBeVisible();

    await expect(page1.getByText("1 comment")).toBeVisible();
    await expect(getAvatarInPileByInitials(page1, "Blue yeti")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Deleted comment")).toBeVisible();

    await browserContext2.close();
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
        fileIds: [],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    const editTestId = async (page: Page, testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Edit").click();
            await expect(page.getByTestId("ContextMenu").getByText("Edit")).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeVisible();
            await message.dispatchEvent("touchend");
            await page.getByRole("menuitem", {name: "Edit"}).click();
            await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
        }
    };

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    if (!isMobile) {
        await page1.getByRole("button", {name: "1 comment"}).click();
    } else {
        await page1.getByRole("button", {name: "Go back"}).click();
    }
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();

    await editTestId(page2, `MessageView:${post.id}:${comment.index}`);

    await expect(page2.getByLabel("Comment", {exact: true})).toBeFocused();
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("ArrowRight");
    } else {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("End");
    }
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Backspace");
    await page2.getByRole("textbox", {name: "Comment", exact: true}).press("2");
    if (!isMobile) {
        await page2.getByRole("textbox", {name: "Comment", exact: true}).press("Enter");
    } else {
        await expect(page2.getByRole("button", {name: "Save"})).toBeEnabled();

        // Make sure the keyboard toolbar isn't animating when we tap.
        await (await page2
            .getByRole("button", {name: "Save"})
            .elementHandle())!.waitForElementState("stable");

        await page2.getByRole("button", {name: "Save"}).tap();
        await expect(page2.getByRole("button", {name: "Save"})).toBeHidden();
    }

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Test post comment content 2")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 2")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();

    await browserContext2.close();
});

test("will backfill a delete in realtime when comments are reopened", async ({
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
        fileIds: [],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    const deleteTestId = async (page: Page, testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Delete").click();
            await expect(page.getByTestId("ContextMenu").getByText("Delete")).toBeHidden();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
            await page.getByRole("button", {name: "Delete"}).click();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeVisible();
            await message.dispatchEvent("touchend");
            await page.getByRole("menuitem", {name: "Delete"}).click();
            await expect(page.getByRole("menuitem", {name: "Delete"})).toBeHidden();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeVisible();
            await page.getByRole("button", {name: "Delete"}).click();
            await expect(page.getByRole("alertdialog", {name: "Delete comment"})).toBeHidden();
        }
    };

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/posts/${post.id}`);

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Deleted comment")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content 1")).toBeVisible();
    await expect(page1.getByText("Deleted comment")).toBeHidden();
    if (!isMobile) {
        await page1.getByRole("button", {name: "1 comment"}).click();
    } else {
        await page1.getByRole("button", {name: "Go back"}).click();
    }
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Deleted comment")).toBeHidden();

    await deleteTestId(page2, `MessageView:${post.id}:${comment.index}`);

    await expect(page1.getByText("Test post comment content 1")).toBeHidden();
    await expect(page1.getByText("Deleted comment")).toBeHidden();
    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Deleted comment")).toBeVisible();
    await expect(page1.getByText("Test post comment content 1")).toBeHidden();

    await browserContext2.close();
});
