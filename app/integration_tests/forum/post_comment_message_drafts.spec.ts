import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {
    clearMessageDraftInput,
    fillMessageDraftInput,
    getMessageDraftBehaviorTests,
    getMessageDraftInput,
    seedMessageDraft,
    seedMessageDraftWithParent,
    waitForDraftToBeEmpty,
    waitForDraftToContainText,
    waitForPageReady,
} from "~/app/integration_tests/helpers/get_message_draft_behavior_tests.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";

const {context, services} = createTestServices();
const supportsFileDrop = false;

async function openPostComments(page: Page, commentCountLabel: string) {
    await page.getByRole("button", {name: commentCountLabel}).click();
    await expect(getMessageDraftInput(page, "comment")).toBeVisible();
}

async function closePostComments(page: Page, commentCountLabel: string) {
    await page.getByRole("button", {name: commentCountLabel}).click();
    await expect(getMessageDraftInput(page, "comment")).toBeHidden();
}

const prepares = {
    prepare: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, "Post for comment drafts");

        return {
            session,
            surface: {type: "PostComment" as const, postId: post.id},
            path: `/post/${post.id}`,
            messageNoun: "comment" as const,
            draftLabel: "post comment draft",
        };
    },
    prepareWithMention: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const mentionSession = await space.createSession({name: "Bob"});
        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, "Post for mention drafts");

        return {
            session,
            surface: {type: "PostComment" as const, postId: post.id},
            path: `/post/${post.id}`,
            messageNoun: "comment" as const,
            draftLabel: "post comment mention draft",
            mentionAccountName: mentionSession.account.initialName,
            mentionAccountId: mentionSession.account.id,
        };
    },
    prepareWithReplyParent: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, "Post for parent drafts");

        await TestMessagingRoomBase.createMessage(post, session, "abcdefghi");
        await TestMessagingRoomBase.createMessage(post, session, "jklmnopqr");

        return {
            session,
            surface: {type: "PostComment" as const, postId: post.id},
            path: `/post/${post.id}`,
            channelPath: `/channel/${channel.id}`,
            commentCountLabel: "2 comments",
            messageNoun: "comment" as const,
            draftLabel: "post comment parent draft",
            replyMessageText: "jklmnopqr",
            replyParentStartIndex: 1,
            replyParentEndIndex: 1,
        };
    },
};

for (const behaviorTest of getMessageDraftBehaviorTests()) {
    test(behaviorTest.title, async ({page, context: browserContext, isMobile}) => {
        if (behaviorTest.skipOnMobile && isMobile) return;
        if (behaviorTest.requiresFileDrop && !supportsFileDrop) return;

        await behaviorTest.run({page, context: browserContext, isMobile}, prepares, services);
    });
}

test("clears the reply parent after sending when the draft was resaved from the client", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const scenario = await prepares.prepareWithReplyParent();
    const {surface} = scenario;

    await seedMessageDraftWithParent(scenario.session, surface, "reply draft", {
        type: "MessagesRange",
        startIndex: scenario.replyParentStartIndex,
        endIndex: scenario.replyParentEndIndex,
        startContentVersion: 0,
        endContentVersion: 0,
        startPos: 3,
        endPos: 9,
    });

    await services.signIn(browserContext, scenario.session);
    await page.goto(scenario.channelPath);
    await waitForPageReady(page);

    await openPostComments(page, scenario.commentCountLabel);

    const input = getMessageDraftInput(page, scenario.messageNoun);
    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await expect(input).toHaveText("reply draft", {timeout: 10_000});

    // Re-save the draft from the client so a draft write carrying the reply parent
    // lands on the server before sending. Regression guard: a resaved draft must never
    // be reflected back into the input in a way that re-applies its reply parent after
    // send clears it. Wait for the save to round-trip before sending.
    const draftSaved = page.waitForResponse(response => {
        const url = response.url();
        if (url.includes("/api/rpc/updateMessageDraft")) return true;
        return (
            url.includes("/api/rpc/_batch") &&
            !!response.request().postData()?.includes("updateMessageDraft")
        );
    });
    await input.click();
    await input.press("End");
    await input.pressSequentially(" edited");
    await expect(input).toHaveText("reply draft edited");
    await draftSaved;
    await waitForDraftToContainText(scenario.session, surface, "reply draft edited");

    await page.getByRole("button", {name: `Send ${scenario.messageNoun}`}).click();
    await expect(input).toHaveText("");

    // Regression: the reply parent must not be re-applied from the resaved draft after
    // `onParentClear()` runs on send.
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await waitForDraftToBeEmpty(scenario.session, surface);
});

test("hydrates a prefetched post comment draft when comments open", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post with prefetched draft");
    const surface: MessageDraftSurface = {type: "PostComment", postId: post.id};

    await seedMessageDraft(session, surface, "prefetched post comment draft");

    await services.signIn(browserContext, session);
    await page.goto(`/channel/${channel.id}`);
    await waitForPageReady(page);

    await expect(page.getByText("Post with prefetched draft")).toBeVisible();
    await expect(getMessageDraftInput(page, "comment")).toBeHidden();

    await openPostComments(page, "0 comments");

    await expect(getMessageDraftInput(page, "comment")).toHaveText("prefetched post comment draft");
});

test("restores post comment draft text after collapsing and reopening comments", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);
    await channel.createPost(session, "Post for restore stash");

    await services.signIn(browserContext, session);
    await page.goto(`/channel/${channel.id}`);
    await waitForPageReady(page);

    await openPostComments(page, "0 comments");
    await fillMessageDraftInput(page, "comment", "restored without reopening server", isMobile);

    await closePostComments(page, "0 comments");
    await openPostComments(page, "0 comments");

    await expect(getMessageDraftInput(page, "comment")).toHaveText(
        "restored without reopening server",
    );
});

test("persists post comment draft text when collapsing comments before debounce", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for collapse persistence");
    const surface: MessageDraftSurface = {type: "PostComment", postId: post.id};

    await services.signIn(browserContext, session);
    await page.goto(`/channel/${channel.id}`);
    await waitForPageReady(page);

    await openPostComments(page, "0 comments");
    await fillMessageDraftInput(page, "comment", "persisted after collapse", isMobile);
    await closePostComments(page, "0 comments");

    await waitForDraftToContainText(session, surface, "persisted after collapse");
});

test("does not restore a cleared post comment draft after collapsing and reopening comments", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for clear and collapse");
    const surface: MessageDraftSurface = {type: "PostComment", postId: post.id};

    await seedMessageDraft(session, surface, "stale prefetched draft");

    await services.signIn(browserContext, session);
    await page.goto(`/channel/${channel.id}`);
    await waitForPageReady(page);

    await openPostComments(page, "0 comments");
    await expect(getMessageDraftInput(page, "comment")).toHaveText("stale prefetched draft");

    await clearMessageDraftInput(page, "comment", isMobile);
    await waitForDraftToBeEmpty(session, surface);

    await closePostComments(page, "0 comments");
    await openPostComments(page, "0 comments");

    await expect(getMessageDraftInput(page, "comment")).toHaveText("");
});
