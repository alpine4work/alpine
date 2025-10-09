import {BrowserContext, Locator, Page, expect, test as playwrightTest} from "@playwright/test";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {PostDraftId} from "~/shared/id/types/id_types.js";

const {context, services} = createTestServices();

// TypeScript requires that we have at least one test cases for every file
// attachment target type.
const testCases: Record<
    FileAttachmentTarget["type"],
    NonEmptyReadonlyArray<{
        only?: CommitBlocker;
        description: string;
        setup: (props: {page: Page; browserContext: BrowserContext}) => Promise<
            | {
                  type: "MessageInput";
                  dropCoords: {x: number; y: number};
                  dropTarget: Locator;
                  messageInput: Locator;
              }
            | {
                  type: "ContentEditor";
                  dropCoords: {x: number; y: number};
                  dropTarget: Locator;
              }
        >;
    }>
> = {
    ChatMessages: [
        {
            description: "chat",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const chat = await TestChat.get(session1, session2);

                await services.signIn(browserContext, session1);
                await page.goto(`/s/${space.id}/chat/${chat.id}`);

                return {
                    type: "MessageInput",
                    dropCoords: {x: 640, y: 360},
                    dropTarget: page.getByTestId("MessagingView"),
                    messageInput: page.getByTestId("MessageInput"),
                };
            },
        },
    ],
    Document: [
        {
            description: "document",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const document = await TestDocument.create(session);

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/documents/${document.id}`);

                return {
                    type: "ContentEditor",
                    dropCoords: {x: 640, y: 360},
                    dropTarget: page.getByRole("textbox", {name: "Document"}),
                };
            },
        },
    ],
    DocumentComments: [
        {
            description: "document comment",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const document = await TestDocument.create(session);
                await document.type(session, "Hello, ");
                const {range} = await document.type(session, "world");
                await document.type(session, "!");
                const commentThread = await document.createCommentThread(
                    session,
                    range,
                    "Test comment",
                );

                await services.signIn(browserContext, session);
                await page.goto(
                    `/s/${space.id}/documents/${document.id}?comments=${commentThread.id}`,
                );

                return {
                    type: "MessageInput",
                    dropCoords: {x: 1076, y: 465},
                    dropTarget: page.getByTestId("DocumentCommentThreadListView"),
                    messageInput: page.getByTestId(`DocumentCommentInput:${commentThread.id}`),
                };
            },
        },
        {
            description: "document comment (in expanded thread)",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const document = await TestDocument.create(session);
                await document.type(session, "Hello, ");
                const {range} = await document.type(session, "world");
                await document.type(session, "!");

                const commentThread = await document.createCommentThread(
                    session,
                    range,
                    "Test comment",
                );

                await services.signIn(browserContext, session);
                await page.goto(
                    `/s/${space.id}/documents/${document.id}/comments/${commentThread.id}`,
                );

                return {
                    type: "MessageInput",
                    dropCoords: {x: 640, y: 360},
                    dropTarget: page.getByTestId("DocumentCommentThreadListView"),
                    messageInput: page.getByTestId(`DocumentCommentInput:${commentThread.id}`),
                };
            },
        },
        {
            description: "document comment (in expanded multi-thread notification)",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const document = await TestDocument.create(session1);
                await document.access.grantDefault(session1);
                const {range: range1} = await document.type(session1, "Hello");
                await document.type(session1, ", ");
                const {range: range2} = await document.type(session1, "world");
                await document.type(session1, "!");

                await document.createCommentThread(session2, range1, "Test comment 1");

                const commentThread2 = await document.createCommentThread(
                    session2,
                    range2,
                    "Test comment 2",
                );

                await services.signIn(browserContext, session1);
                await page.goto(`/s/${space.id}/documents/${document.id}`);

                await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

                await page.getByLabel("Inbox").click();
                await page.getByText("2 new comment threads").click();
                await page.getByLabel("Expand").click();

                await expect(page.getByRole("textbox", {name: "Document"})).toBeHidden();

                await page
                    .getByTestId(`DocumentCommentInput:${commentThread2.id}`)
                    .scrollIntoViewIfNeeded();

                return {
                    type: "MessageInput",
                    dropCoords: {x: 668, y: 491},
                    dropTarget: page.getByTestId("DocumentCommentThreadListView"),
                    messageInput: page.getByTestId(`DocumentCommentInput:${commentThread2.id}`),
                };
            },
        },
    ],
    Post: [
        {
            description: "post",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const channel = await TestChannel.create(session);
                const post = await channel.createPost(session);

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/posts/${post.id}`);

                await page.getByLabel("More").click();
                await page.getByRole("menuitem", {name: "Edit"}).click();

                return {
                    type: "ContentEditor",
                    dropCoords: {x: 465, y: 86},
                    dropTarget: page.getByRole("textbox", {name: "Post"}),
                };
            },
        },
    ],
    PostDraft: [
        {
            description: "post draft",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const draftId = generateChronologicalId<PostDraftId>();

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/posts/new/${draftId}`);

                return {
                    type: "ContentEditor",
                    dropCoords: {x: 640, y: 360},
                    dropTarget: page.getByRole("textbox", {name: "Post"}),
                };
            },
        },
    ],
    PostComments: [
        {
            description: "post comment",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const channel = await TestChannel.create(session);
                const post = await channel.createPost(session);

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/posts/${post.id}`);

                return {
                    type: "MessageInput",
                    dropCoords: {x: 640, y: 360},
                    dropTarget: page.getByTestId("PostListView"),
                    messageInput: page.getByTestId(`PostCommentInput:${post.id}`),
                };
            },
        },
        {
            description: "post comment (in channel)",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const channel = await TestChannel.create(session);
                await channel.createPost(session);
                const post = await channel.createPost(session);
                await channel.createPost(session);

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/channels/${channel.id}`);

                await page.getByLabel("0 comments").nth(1).click();
                await expect(page.getByLabel("New comment")).toHaveCount(1);
                await page.getByLabel("0 comments").nth(0).click();
                await expect(page.getByLabel("New comment")).toHaveCount(2);

                return {
                    type: "MessageInput",
                    dropCoords: {x: 443, y: 458},
                    dropTarget: page.getByTestId("PostListView"),
                    messageInput: page.getByTestId(`PostCommentInput:${post.id}`),
                };
            },
        },
    ],
    TaskNotes: [
        {
            description: "task notes",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const task = await TestTask.create(session);

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/tasks/${task.id}`);

                return {
                    type: "ContentEditor",
                    dropCoords: {x: 320, y: 296},
                    dropTarget: page.getByRole("textbox", {name: "Notes"}),
                };
            },
        },
    ],
    TaskComments: [
        {
            description: "task comment",
            setup: async ({page, browserContext}) => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const task = await TestTask.create(session);

                await services.signIn(browserContext, session);
                await page.goto(`/s/${space.id}/tasks/${task.id}?comments=show`);

                return {
                    type: "MessageInput",
                    dropCoords: {x: 1042, y: 466},
                    dropTarget: page.getByTestId("MessagingView"),
                    messageInput: page.getByTestId("MessageInput"),
                };
            },
        },
    ],
};

for (const testCasesArray of Object.values(testCases)) {
    for (const testCase of testCasesArray) {
        const test = testCase.only ? playwrightTest.only : playwrightTest;

        test(`can drop file into ${testCase.description}`, async ({
            context: browserContext,
            page,
        }) => {
            // Make sure the viewport size never changes since we'll need precise pixel
            // placement when dropping an image.
            await page.setViewportSize({width: 1280, height: 720});

            const result = await testCase.setup({
                page,
                browserContext,
            });

            const file1Contents = await fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
                ),
            );

            const file1DataTransfer = await page.evaluateHandle(file1HexContents => {
                const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

                for (let i = 0; i < file1Contents.length; i++)
                    file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

                const dataTransfer = new DataTransfer();
                const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
                dataTransfer.items.add(file);

                return dataTransfer;
            }, file1Contents.toString("hex"));

            switch (result.type) {
                case "MessageInput": {
                    const {dropTarget, dropCoords, messageInput} = result;

                    await expect(page.getByTestId("MessagingViewDragOverlay")).toBeHidden();
                    await expect(
                        messageInput.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();
                    await expect(
                        page
                            .getByTestId(/^MessageView:[^:]+:1$/)
                            .getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();

                    await dropTarget.dispatchEvent("dragenter", {
                        clientX: dropCoords.x,
                        clientY: dropCoords.y,
                        dataTransfer: file1DataTransfer,
                    });

                    await expect(page.getByTestId("MessagingViewDragOverlay")).toBeVisible();
                    await expect(
                        messageInput.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();
                    await expect(
                        page
                            .getByTestId(/^MessageView:$/)
                            .getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();

                    await dropTarget.dispatchEvent("drop", {
                        clientX: dropCoords.x,
                        clientY: dropCoords.y,
                        dataTransfer: file1DataTransfer,
                    });

                    await expect(page.getByTestId("MessagingViewDragOverlay")).toBeHidden();
                    await expect(
                        messageInput.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeVisible();
                    await expect(
                        page
                            .getByTestId(/^MessageView:/)
                            .getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();

                    await messageInput.getByLabel(/Send (message|comment)/).click();

                    await expect(
                        page
                            .getByTestId(/^MessageView:/)
                            .getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeVisible();
                    await expect(page.getByTestId("MessagingViewDragOverlay")).toBeHidden();
                    await expect(
                        messageInput.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();
                    break;
                }
                case "ContentEditor": {
                    const {dropTarget, dropCoords} = result;

                    await expect(
                        page.getByTestId(/^ContentEditorFileDropTargetIndicator:/),
                    ).toBeHidden();
                    await expect(
                        dropTarget.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();

                    await dropTarget.dispatchEvent("dragenter", {
                        clientX: dropCoords.x,
                        clientY: dropCoords.y,
                        dataTransfer: file1DataTransfer,
                    });

                    await expect(
                        page.getByTestId(/^ContentEditorFileDropTargetIndicator:/),
                    ).toBeVisible();
                    await expect(
                        dropTarget.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeHidden();

                    await dropTarget.dispatchEvent("drop", {
                        clientX: dropCoords.x,
                        clientY: dropCoords.y,
                        dataTransfer: file1DataTransfer,
                    });

                    await expect(
                        page.getByTestId(/^ContentEditorFileDropTargetIndicator:/),
                    ).toBeHidden();
                    await expect(
                        dropTarget.getByTestId("ContentFilePreview:image/jpeg"),
                    ).toBeVisible();
                    break;
                }
                default:
                    throw exhaustive(result);
            }
        });
    }
}
