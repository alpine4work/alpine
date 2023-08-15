import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createChannel, createPost, createPostComment} from "~/server/forum/data/forum_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const context = createTestContext();
const services = createTestServices(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

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
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 1"),
    });

    await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test post comment content 2"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Existing messages aren't replying to anything.
    await expect(page.getByTestId(`MessageView:${post.id}:0`).getByText("replied to")).toBeHidden();
    await expect(page.getByTestId(`MessageView:${post.id}:1`).getByText("replied to")).toBeHidden();

    // Reply to the first comment.
    {
        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeHidden();

        await page
            .getByTestId(`MessageView:${post.id}:0`)
            .getByRole("button", {name: "Reply"})
            .press("Enter");

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
            await page.getByRole("button", {name: "Send comment"}).click();
        }

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 1"),
        ).toBeHidden();

        await expect(
            page.getByTestId(`MessageView:${post.id}:2`).getByText("replied to"),
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

        await page
            .getByTestId(`MessageView:${post.id}:0`)
            .getByRole("button", {name: "Reply"})
            .press("Enter");

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

        await page
            .getByTestId(`MessageView:${post.id}:1`)
            .getByRole("button", {name: "Reply"})
            .press("Enter");

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
            await page.getByRole("button", {name: "Send comment"}).click();
        }

        await expect(
            page
                .getByTestId(`PostCommentInput:${post.id}`)
                .getByText("Test post comment content 2"),
        ).toBeHidden();

        await expect(
            page.getByTestId(`MessageView:${post.id}:3`).getByText("replied to"),
        ).toBeVisible();
        await expect(
            page.getByTestId(`MessageView:${post.id}:3`).getByText("Test post comment content 4"),
        ).toBeVisible();
        await expect(
            page.getByTestId(`MessageView:${post.id}:3`).getByText("Test post comment content 2"),
        ).toBeVisible();
    }
});

test("clicking a reply bubble will scroll to the comment", async ({
    page,
    context: browserContext,
}) => {
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
            parentCommentIndex: null,
            content: createSimpleMessageContent(
                `Test post comment content ${
                    i + 1
                }: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec ac varius turpis, vel lacinia lectus. Cras ultricies felis purus, a mollis leo suscipit nec. Duis in eros libero. Pellentesque sed volutpat nunc. Fusce accumsan, turpis non cursus bibendum, lorem tortor sollicitudin augue, ut efficitur lectus augue id felis. Duis vel dolor ante. Fusce dictum tempor lacus, vitae interdum nibh bibendum eget.`,
            ),
        });
    }

    await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: 49,
        content: createSimpleMessageContent("Test post comment content 101"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Make sure our scroll view is focused so pressing `End` will scroll the
    // nested scroll view.
    await page.getByText("Test post content 1").click();

    // We may need to scroll a couple times because layout shifts while the
    // virtualized view measured items.
    //
    // The message we are looking for may not be mounted until we scroll to the
    // end of the view.
    let remainingScrollAttempts = 10;
    while (remainingScrollAttempts > 0) {
        remainingScrollAttempts--;
        await page.keyboard.down("End");
        // Small timeout to wait for React to render.
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(150);
        if (await page.getByTestId(`MessageView:${post.id}:100`).isVisible()) break;
    }

    await page.getByTestId(`MessageView:${post.id}:100`).scrollIntoViewIfNeeded();

    await expect(page.getByTestId(`MessageView:${post.id}:49`)).not.toBeInViewport();

    await page
        .getByTestId(`MessageView:${post.id}:100`)
        .getByText("Test post comment content 50")
        .click();

    await expect(page.getByTestId(`MessageView:${post.id}:49`)).toBeInViewport();
});
