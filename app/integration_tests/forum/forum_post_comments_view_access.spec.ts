import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {createPostComment} from "~/server/forum/data/post_messaging.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const {context, services} = createTestServices();

// Post comments are readable at "View" while writing them needs "Comment", so a
// read-only member follows the conversation with every way to contribute to it
// removed. Task comments work the same way — see
// `task_comments_view_access.spec.ts`.
async function createPostWithViewOnlyMember() {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({name: "Logan Roy"});
    const viewerSession = await space.createSession({name: "Siobahn Roy"});

    const channel = await TestChannel.create(ownerSession, {
        name: "Read Only Channel",
        access: {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [ownerSession.account.id, {level: "Manage", generation: 0}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const post = await createPost(context.action(ownerSession), {
        channelId: channel.id,
        content: createSimplePostContent("Post a viewer can read"),
        createdTimeZone: defaultTimeZone,
    });

    await createPostComment(context.action(ownerSession), {
        postId: post.id,
        parent: null,
        content: createSimpleMessageContent("Comment a viewer can read"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    return {post, ownerSession, viewerSession};
}

test("a view-only member reads a post\u2019s comments", async ({page, context: browserContext}) => {
    const {post, viewerSession} = await createPostWithViewOnlyMember();

    await services.signIn(browserContext, viewerSession);
    await page.goto(`/post/${post.id}`);

    await expect(page.getByText("Comment a viewer can read")).toBeVisible();
});

test("a view-only member gets a disabled comment input on a post", async ({
    page,
    context: browserContext,
    browser,
}) => {
    const {post, ownerSession, viewerSession} = await createPostWithViewOnlyMember();

    await services.signIn(browserContext, viewerSession);
    await page.goto(`/post/${post.id}`);

    await expect(page.getByTestId("DisabledMessageInput")).toBeVisible();
    await expect(page.getByRole("textbox", {name: "New comment"})).toHaveCount(0);

    // The same post gives a member who can comment a working composer, so the
    // assertions above are about access and not about the page failing to render.
    const ownerBrowser = await browser.newContext();
    await services.signIn(ownerBrowser, ownerSession);
    const ownerPage = await ownerBrowser.newPage();
    await ownerPage.goto(`/post/${post.id}`);
    await expect(ownerPage.getByRole("textbox", {name: "New comment"})).toBeVisible();
    await expect(ownerPage.getByTestId("DisabledMessageInput")).toHaveCount(0);
    await ownerBrowser.close();
});

test("a view-only member can\u2019t react to a post comment", async ({
    page,
    context: browserContext,
}) => {
    const {post, viewerSession} = await createPostWithViewOnlyMember();

    await services.signIn(browserContext, viewerSession);
    await page.goto(`/post/${post.id}`);

    const comment = page.getByText("Comment a viewer can read");
    await expect(comment).toBeVisible();
    await comment.click({button: "right"});

    // Read-only comments offer no reaction, reply, or edit actions. Copying a link
    // stays available, so an empty menu wouldn't prove the gating works.
    await expect(page.getByText("Add reaction")).toHaveCount(0);
    await expect(page.getByText("Reply", {exact: true})).toHaveCount(0);
});
