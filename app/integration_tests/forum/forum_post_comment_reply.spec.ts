import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {createPostComment} from "~/server/forum/data/post_messaging.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

async function tapSendComment(page: Page) {
    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();

    // Make sure the keyboard toolbar isn't animating when we tap.
    await (await page
        .getByRole("button", {name: "Send comment"})
        .elementHandle())!.waitForElementState("stable");

    await page.getByRole("button", {name: "Send comment"}).tap();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();
}

test("can reply to a comment", async ({page, context: browserContext, isMobile}) => {
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
        createdTimeZone: defaultTimeZone,
    });

    await createPostComment(context.action(session2), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Test post comment content 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    const replyToTestId = async (testId: string) => {
        const message = page.getByTestId(testId).getByTestId("MessageViewContent");
        await expect(message).toBeVisible();

        if (!isMobile) {
            await message.dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Reply").click();
        } else {
            // Simulate a long press on mobile devices...

            await expect(page.getByRole("menuitem", {name: "Reply"})).toBeHidden();
            await message.dispatchEvent("touchstart");
            await expect(page.getByRole("menuitem", {name: "Reply"})).toBeVisible();
            await message.dispatchEvent("touchend");

            await page.getByRole("menuitem", {name: "Reply"}).click();
        }
    };

    // Existing messages aren't replying to anything.
    await expect(
        page.getByTestId(`MessageView:${post.id}:0`).getByTestId("MessageViewParent"),
    ).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${post.id}:1`).getByTestId("MessageViewParent"),
    ).toBeHidden();

    // Reply to the first comment.
    {
        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeHidden();

        await replyToTestId(`MessageView:${post.id}:0`);

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeVisible();

        await page.getByRole("textbox", {name: "New comment"}).type("Test post comment content 3");
        await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText(
            "Test post comment content 3",
        );
        if (!isMobile) {
            await page.getByRole("textbox", {name: "New comment"}).press("Enter");
        } else {
            await tapSendComment(page);
        }

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeHidden();

        await expect(
            page.getByTestId(`MessageView:${post.id}:2`).getByTestId("MessageViewParent"),
        ).toBeVisible();
        await expect(
            page.getByTestId(`MessageView:${post.id}:2`).getByText("Test post comment content 3"),
        ).toBeVisible();
        await expect(
            page.getByTestId(`MessageView:${post.id}:2`).getByText("Test post comment content 1"),
        ).toBeVisible();
    }

    // Cancel replying to the first comment.
    {
        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeHidden();

        await replyToTestId(`MessageView:${post.id}:0`);

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeVisible();

        await page.getByRole("button", {name: "Cancel reply"}).click();

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeHidden();
    }

    // Reply to the second comment.
    {
        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 2"),
        ).toBeHidden();

        await replyToTestId(`MessageView:${post.id}:1`);

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 2"),
        ).toBeVisible();

        await page.getByRole("textbox", {name: "New comment"}).type("Test post comment content 4");
        await expect(page.getByRole("textbox", {name: "New comment"})).toHaveText(
            "Test post comment content 4",
        );
        if (!isMobile) {
            await page.getByRole("textbox", {name: "New comment"}).press("Enter");
        } else {
            await tapSendComment(page);
        }

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 2"),
        ).toBeHidden();

        await expect(
            page.getByTestId(`MessageView:${post.id}:3`).getByTestId("MessageViewParent"),
        ).toBeVisible();
        await expect(
            page.getByTestId(`MessageView:${post.id}:3`).getByText("Test post comment content 4"),
        ).toBeVisible();
        await expect(
            page.getByTestId(`MessageView:${post.id}:3`).getByText("Test post comment content 2"),
        ).toBeVisible();
    }
});

test("clicking a reply will scroll to the comment", async ({page, context: browserContext}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    for (let i = 0; i < 100; i++) {
        await createPostComment(context.action(session1), {
            postId: post.id,
            parent: null,
            content: createSimpleMessageContent(
                `Test post comment content ${
                    i + 1
                }: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec ac varius turpis, vel lacinia lectus. Cras ultricies felis purus, a mollis leo suscipit nec. Duis in eros libero. Pellentesque sed volutpat nunc. Fusce accumsan, turpis non cursus bibendum, lorem tortor sollicitudin augue, ut efficitur lectus augue id felis. Duis vel dolor ante. Fusce dictum tempor lacus, vitae interdum nibh bibendum eget.`,
            ),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        });
    }

    await createPostComment(context.action(session1), {
        postId: post.id,
        parent: {type: "Message", index: 49},
        content: createSimpleMessageContent("Test post comment content 101"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Scroll through all messages...
    for (let i = 0; i < 101; i++) {
        await page.getByTestId(`MessageView:${post.id}:${i}`).scrollIntoViewIfNeeded();
    }

    await expect(page.getByTestId(`MessageView:${post.id}:100`)).toBeInViewport();
    await expect(page.getByTestId(`MessageView:${post.id}:49`)).not.toBeInViewport();

    await page
        .getByTestId(`MessageView:${post.id}:100`)
        .getByText("Test post comment content 50")
        .click();

    await expect(page.getByTestId(`MessageView:${post.id}:49`)).toBeInViewport();
});
