import {type Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {pageKeyboardShortcut} from "~/app/integration_tests/helpers/page_keyboard_shortcut.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);

async function replacePostEditorText({page, text}: {page: Page; text: string}) {
    const postEditor = page.getByLabel("Post", {exact: true});
    await postEditor.press(await pageKeyboardShortcut(page, "mod", "a"));
    await postEditor.type(text);
}

test("can create posts", async ({page, context: browserContext, isMobile}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/channel/${channel.id}`);

    await expect(page.getByText("Test Channel")).toBeVisible();

    await page.getByRole("button", {name: "Post"}).click();

    const newPostLocator = !isMobile ? page.getByTestId("PeekStack") : page;

    await expect(newPostLocator.getByRole("button", {name: "Post"})).toBeDisabled();
    await page.getByLabel("New post").type("Test post content 1");
    await page.getByLabel("New post").blur();
    await expect(page.getByLabel("New post")).toHaveText("Test post content 1");
    await expect(page.getByLabel("0 comments")).toBeHidden();
    await expect(newPostLocator.getByRole("button", {name: "Post"})).toBeEnabled();
    await newPostLocator.getByRole("button", {name: "Post"}).click();
    await expect(page.getByTestId("PeekStack")).toBeHidden();
    await expect(page.getByLabel("0 comments")).toBeVisible();
    await expect(page.getByText("Test post content 1")).toBeVisible();

    if (!isMobile) {
        await page.getByRole("button", {name: "Post"}).click();
    } else {
        await expect(page.getByRole("button", {name: "Post"})).toBeHidden();
        await page.goBack();
        await page.getByRole("button", {name: "Post"}).click();
    }

    await page.getByLabel("New post").type("Test post content 2");
    await page.getByLabel("New post").blur();
    await expect(page.getByLabel("New post")).toHaveText("Test post content 2");
    await newPostLocator.getByRole("button", {name: "Post"}).click();
    await expect(page.getByTestId("PeekStack")).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeVisible();
});

test("can create multiline formatted posts", async ({page, context: browserContext, isMobile}) => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/channel/${channel.id}`);

    await expect(page.getByText("Test Channel")).toBeVisible();

    const newPostLocator = !isMobile ? page.getByTestId("PeekStack") : page;

    await page.getByRole("button", {name: "Post"}).click();
    await expect(newPostLocator.getByRole("button", {name: "Post"})).toBeDisabled();
    await page.getByLabel("New post").type("Test post content 1");
    await page.getByLabel("New post").press("Enter");
    await page.getByLabel("New post").type("# Test heading");
    await page.getByLabel("New post").press("Enter");
    await page.getByLabel("New post").type("More test post content");
    await page.getByLabel("New post").blur();
    await expect(newPostLocator.getByRole("button", {name: "Post"})).toBeEnabled();

    await newPostLocator.getByRole("button", {name: "Post"}).click();
    await expect(page.getByTestId("PeekStack")).toBeHidden();

    await expect(page.getByLabel("0 comments")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Test heading"})).toBeVisible();
});

test("can edit a post in a channel", async ({page, context: browserContext, viewport}) => {
    assert(viewport);

    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
        createdTimeZone: defaultTimeZone,
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/channel/${channel.id}`);

    await expect(page.getByText("Test post content 1")).toBeVisible();

    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
    await page
        .getByTestId(/PostContentView/)
        .getByRole("button", {name: "More"})
        .click();
    await page.getByRole("menuitem", {name: "Edit"}).click();

    await expect(page.getByLabel("Post", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Post", {exact: true})).toHaveText("Test post content 1");

    // Can update with the save button.
    await replacePostEditorText({page, text: "Test post content 2"});
    await page.getByRole("button", {name: "Save"}).click();

    await expect(page.getByRole("button", {name: "Save"})).toBeHidden();
    await expect(page.getByText("Test post content 1")).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeVisible();

    await page
        .getByTestId(/PostContentView/)
        .getByRole("button", {name: "More"})
        .click();
    await page.getByRole("menuitem", {name: "Edit"}).click();

    await expect(page.getByLabel("Post", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Post", {exact: true})).toHaveText("Test post content 2");

    // Can update with Cmd-Enter keyboard shortcut.
    await replacePostEditorText({page, text: "Test post content 3"});
    await page
        .getByLabel("Post", {exact: true})
        .press(await pageKeyboardShortcut(page, "mod", "enter"));

    await expect(page.getByRole("button", {name: "Save"})).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeHidden();
    await expect(page.getByText("Test post content 3")).toBeVisible();
});

test("can edit a standalone post", async ({page, context: browserContext, isMobile, viewport}) => {
    assert(viewport);

    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
        createdTimeZone: defaultTimeZone,
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/post/${post.id}`);

    await expect(page.getByText("Test post content 1")).toBeVisible();

    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Edit"}).click();

    await expect(page.getByLabel("Post", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Post", {exact: true})).toHaveText("Test post content 1");

    // Can update with the save button.
    await replacePostEditorText({page, text: "Test post content 2"});
    if (!isMobile) {
        await page.getByRole("button", {name: "Save"}).click();
    } else {
        await page.getByLabel("Post", {exact: true}).blur();

        // TODO(calebmer): We should open a `<MobileModal>` on mobile when editing a post
        // so we can have a save button in the header.
        await page
            .getByLabel("Post", {exact: true})
            .press(await pageKeyboardShortcut(page, "mod", "enter"));
    }

    await expect(page.getByRole("button", {name: "Save"})).toBeHidden();
    await expect(page.getByText("Test post content 1")).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeVisible();

    await page.getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Edit"}).click();

    await expect(page.getByLabel("Post", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Post", {exact: true})).toHaveText("Test post content 2");

    // Can update with Cmd-Enter keyboard shortcut.
    await replacePostEditorText({page, text: "Test post content 3"});
    await page
        .getByLabel("Post", {exact: true})
        .press(await pageKeyboardShortcut(page, "mod", "enter"));

    await expect(page.getByRole("button", {name: "Save"})).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeHidden();
    await expect(page.getByText("Test post content 3")).toBeVisible();
});

test("asks for confirmation to save edited post", async ({
    page,
    context: browserContext,
    isMobile,
    viewport,
}) => {
    assert(viewport);

    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test Channel",
    });

    await createPost(context.action(session1), {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
        createdTimeZone: defaultTimeZone,
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/channel/${channel.id}`);

    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeHidden();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeHidden();
    await page
        .getByTestId(/PostContentView/)
        .getByRole("button", {name: "More"})
        .click();
    await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page.getByRole("menuitem", {name: "Edit"})).toBeVisible();

    await page.getByRole("menuitem", {name: "Edit"}).click();

    await expect(page.getByLabel("Post", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Post", {exact: true})).toHaveText("Test post content 1");

    await replacePostEditorText({page, text: "Test post content 2"});

    if (!isMobile) {
        await expect(page.getByRole("alertdialog", {name: "Save post"})).toBeHidden();
        await page.getByText("Test Channel").click();
        await expect(page.getByRole("alertdialog", {name: "Save post"})).toBeVisible();

        await page.getByRole("button", {name: "Discard changes"}).click();
    } else {
        await page.getByRole("button", {name: "Cancel"}).click();
    }

    await expect(page.getByRole("button", {name: "Save"})).toBeHidden();
    await expect(page.getByText("Test post content 2")).toBeHidden();
    await expect(page.getByText("Test post content 1")).toBeVisible();
});
