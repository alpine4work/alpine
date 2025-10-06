import {Locator, Page, ViewportSize, expect, test as playwrightTest} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/chat_actions.js";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createOrReplacePostDraft} from "~/server/forum/data/create_or_replace_post_draft.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {createSimpleDocumentContent} from "~/shared/documents/document_content_schema.js";
import {createSimplePostContent, emptyPostContent} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {PostDraftId} from "~/shared/id/types/id_types.js";

const {context, services} = createTestServices();

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    setup: (options: {
        page: Page;
        isMobile: boolean;
        viewport: ViewportSize | null;
        space: TestSpace;
        session: TestSpaceSession;
    }) => Promise<{
        editorLocator: Locator;
        toolbarLocator?: Locator | Page;
        shouldPressSequentially?: boolean;
    }>;
}> = [
    {
        name: "chat message",
        setup: async ({page, space, session}) => {
            const otherSession = await space.createSession();

            const chatId = await getOrCreateChatForAccounts(session.action(), {
                spaceId: space.id,
                otherAccountIds: [otherSession.account.id],
            });

            await page.goto(`/s/${space.id}/chat/${chatId}`);

            return {
                editorLocator: page.getByRole("textbox", {name: "New message"}),
            };
        },
    },
    {
        name: "post comment",
        setup: async ({page, space, session}) => {
            const channel = await createChannel(session.action(), {
                spaceId: space.id,
                name: "Test Channel",
            });

            const post = await createPost(session.action(), {
                channelId: channel.id,
                content: createSimplePostContent("Test post"),
            });

            await page.goto(`/s/${space.id}/posts/${post.id}`);

            return {
                editorLocator: page.getByRole("textbox", {name: "New comment"}),
            };
        },
    },
    {
        name: "post (new)",
        setup: async ({page, isMobile, space, session}) => {
            const draftId = generateChronologicalId<PostDraftId>();

            const channel = await createChannel(session.action(), {
                spaceId: space.id,
                name: "Test Channel",
            });

            await createOrReplacePostDraft(
                session.action(),
                space.id,
                session.account.id,
                draftId,
                {
                    channelId: channel.id,
                    content: emptyPostContent,
                },
            );

            await page.goto(`/s/${space.id}/posts/new/${draftId}`);

            return {
                editorLocator: page.getByRole("textbox", {name: "New post"}),
                toolbarLocator: isMobile
                    ? page.getByTestId("ContentEditorMobileKeyboardToolbar")
                    : undefined,
            };
        },
    },
    {
        name: "post (existing)",
        setup: async ({page, isMobile, space, session}) => {
            const channel = await createChannel(session.action(), {
                spaceId: space.id,
                name: "Test Channel",
            });

            const post = await createPost(session.action(), {
                channelId: channel.id,
                content: createSimplePostContent("Test post"),
            });

            await page.goto(`/s/${space.id}/posts/${post.id}`);

            await page.getByRole("button", {name: "More"}).click();
            await page.getByRole("menuitem", {name: "Edit"}).click();

            return {
                editorLocator: page.getByRole("textbox", {name: "Post"}),
                toolbarLocator: isMobile
                    ? page.getByTestId("ContentEditorMobileKeyboardToolbar")
                    : undefined,
            };
        },
    },
    {
        name: "document",
        setup: async ({page, isMobile, viewport, space, session}) => {
            assert(viewport);
            const document = await createDocument(session.action(), {
                spaceId: space.id,
            });

            await page.goto(`/s/${space.id}/documents/${document.id}`);

            const editorLocator = page.getByRole("textbox", {name: "Document"});

            const canPrimaryInputHover = await page.evaluate(
                () => !window.matchMedia("(hover: none)").matches,
            );

            if (canPrimaryInputHover) {
                await editorLocator.click({
                    position: {x: viewport.width / 2, y: viewport.height - 100},
                });
            } else {
                await editorLocator.tap({
                    position: {x: viewport.width / 2, y: viewport.height - 150},
                });
            }

            return {
                editorLocator,
                toolbarLocator: isMobile
                    ? page.getByTestId("ContentEditorMobileKeyboardToolbar")
                    : undefined,
                shouldPressSequentially: true,
            };
        },
    },
    {
        name: "document comment (new thread)",
        setup: async ({page, isMobile, viewport, space, session}) => {
            assert(viewport);

            const document = await createDocument(session.action(), {
                spaceId: space.id,
                content: createSimpleDocumentContent(session.account.id, "foobar"),
            });

            await page.goto(`/s/${space.id}/documents/${document.id}`);

            const canPrimaryInputHover = await page.evaluate(
                () => !window.matchMedia("(hover: none)").matches,
            );

            if (canPrimaryInputHover) {
                await page
                    .getByRole("textbox", {name: "Document"})
                    .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
            } else {
                await page
                    .getByRole("textbox", {name: "Document"})
                    .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
            }

            await page.evaluate("dev.contentEditor.setTextSelection(3, 6)");

            if (!isMobile) {
                // Moving the mouse should open the styling toolbar.
                await page.mouse.move(0, 0);
            }

            if (isMobile) {
                // Comment button doesn't use a `<button>` element on mobile so it doesn't
                // move focus.
                await page.getByLabel("Comment").click();
            } else {
                await page.getByTestId("ContentEditorPointerToolbar").getByLabel("Comment").click();
            }

            return {
                editorLocator: page.getByRole("textbox", {name: "New comment"}),
                toolbarLocator: isMobile
                    ? page.getByTestId("MessageInputMobileKeyboardToolbar")
                    : undefined,
            };
        },
    },
    {
        name: "document comment (existing thread)",
        setup: async ({page, isMobile, viewport, space, session}) => {
            assert(viewport);

            const document = await TestDocument.create(session);

            await document.type(session, "foobar");

            const commentThread = await document.createCommentThread(
                session,
                {from: 3, to: 6},
                "Test comment",
            );

            await page.goto(`/s/${space.id}/documents/${document.id}?comments=${commentThread.id}`);

            return {
                editorLocator: page.getByRole("textbox", {name: "New comment"}),
                toolbarLocator: isMobile
                    ? page.getByTestId("MessageInputMobileKeyboardToolbar")
                    : undefined,
            };
        },
    },
    {
        name: "task notes",
        setup: async ({page, isMobile, space, session}) => {
            const task = await TestTask.create(session);

            await page.goto(`/s/${space.id}/tasks/${task.id}`);

            const editorLocator = page.getByRole("textbox", {name: "Notes"});

            if (isMobile) {
                await editorLocator.tap();
            }

            return {
                editorLocator,
                toolbarLocator: isMobile
                    ? page.getByTestId("ContentEditorMobileKeyboardToolbar")
                    : undefined,
            };
        },
    },
];

for (const testCase of testCases) {
    const test = testCase.only ? playwrightTest.only : playwrightTest;

    test(`can insert a link in ${testCase.name}`, async ({
        page,
        context: browserContext,
        isMobile,
        viewport,
    }) => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await services.signIn(browserContext, session);

        const {
            editorLocator,
            toolbarLocator = page,
            shouldPressSequentially = false,
        } = await testCase.setup({
            page,
            isMobile,
            viewport,
            space,
            session,
        });

        await expect(page.getByRole("link", {name: "world"})).toBeHidden();

        if (shouldPressSequentially) {
            await editorLocator.pressSequentially("Hello, world!");
        } else {
            await editorLocator.fill("Hello, world!");
        }

        await expect(page.getByRole("link", {name: "world"})).toBeHidden();

        await editorLocator.press("ArrowLeft");
        await editorLocator.press("Shift+ArrowLeft");
        await editorLocator.press("Shift+ArrowLeft");
        await editorLocator.press("Shift+ArrowLeft");
        await editorLocator.press("Shift+ArrowLeft");
        await editorLocator.press("Shift+ArrowLeft");

        if (!isMobile) {
            // Moving the mouse should open the styling toolbar.
            await page.mouse.move(0, 0);
        }

        await expect(toolbarLocator.getByLabel("Bold")).toBeVisible();

        if (!isMobile || (await toolbarLocator.getByLabel("Link", {exact: true}).isVisible())) {
            await toolbarLocator.getByLabel("Link", {exact: true}).click();
        } else {
            await toolbarLocator.getByLabel("More").click();
            await page
                .getByTestId("ContentEditorMobileKeyboardSubstitute")
                .getByText("Link")
                .click();
        }

        const linkEditorContainerLocator = isMobile
            ? page.getByTestId("ContentEditorMobileLinkModal")
            : page;

        await linkEditorContainerLocator.getByLabel("URL").fill("https://alpine.inc");

        await expect(page.getByRole("link", {name: "world"})).toBeHidden();

        if (!isMobile) {
            await linkEditorContainerLocator.getByLabel("URL").press("Enter");
        } else {
            await linkEditorContainerLocator.getByRole("button", {name: "Save"}).click();
        }

        await expect(page.getByRole("link", {name: "world"})).toBeVisible();
    });
}
