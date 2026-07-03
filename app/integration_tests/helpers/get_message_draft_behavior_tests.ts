import {BrowserContext, Locator, Page, expect} from "@playwright/test";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {isAppleDevicePage} from "~/app/integration_tests/helpers/is_apple_device_page.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getMessageDraft} from "~/server/messaging/drafts/get_message_draft.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

type MessageDraftTestSession = {
    action: () => ServerSessionActionContext;
    space: {id: TestSpaceSession["space"]["id"]};
};

type MessageDraftTestScenario = {
    session: TestSpaceSession;
    surface: MessageDraftSurface;
    path: string;
    messageNoun: "message" | "comment";
    draftLabel: string;
    prepareInput?: (page: Page, isMobile: boolean) => Promise<void>;
};

type MessageDraftTestScenarioWithMention = MessageDraftTestScenario & {
    mentionAccountName: string;
    mentionAccountId: AccountId;
};

type MessageDraftTestScenarioWithReplyParent = MessageDraftTestScenario & {
    replyMessageText: string;
    replyParentStartIndex: number;
    replyParentEndIndex: number;
};

type MessageDraftTestPrepareFunctions = {
    prepare: () => Promise<MessageDraftTestScenario>;
    prepareWithMention: () => Promise<MessageDraftTestScenarioWithMention>;
    prepareWithReplyParent: () => Promise<MessageDraftTestScenarioWithReplyParent>;
};

type MessageDraftTestFixtures = {
    page: Page;
    context: BrowserContext;
    isMobile: boolean;
};

type MessageDraftBehaviorTest = {
    title: string;
    skipOnMobile?: boolean;
    requiresFileDrop?: boolean;
    run: (
        fixtures: MessageDraftTestFixtures,
        prepares: MessageDraftTestPrepareFunctions,
        services: TestServices,
    ) => Promise<void>;
};

const draftPollOptions = {timeout: 10_000};
const messageDraftVersionClock = new HybridLogicalClock(unsynchronizedSystemClock);

const jpegFixturePath = joinPath(
    runfilesPath,
    "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
);

type TestServices = {
    signIn: (browserContext: BrowserContext, session: TestSpaceSession) => Promise<void>;
};

export function getMessageDraftInput(page: Page, messageNoun: "message" | "comment") {
    return page.getByRole("textbox", {name: `New ${messageNoun}`});
}

function getMessageInput(page: Page) {
    return page.getByTestId("MessageInput");
}

export async function waitForPageReady(page: Page) {
    await page.waitForFunction("dev.ready");
}

async function signInAndGoTo(
    page: Page,
    browserContext: BrowserContext,
    services: TestServices,
    session: TestSpaceSession,
    path: string,
) {
    await services.signIn(browserContext, session);
    await page.goto(path);
    await waitForPageReady(page);
}

async function blurMessageDraftInput(
    page: Page,
    messageNoun: "message" | "comment",
    isMobile = false,
) {
    if (isMobile) {
        await getMessageInput(page).evaluate(element => {
            element.blur();
        });
    } else {
        await getMessageDraftInput(page, messageNoun).blur();
    }
}

async function focusMessageDraftInput(
    page: Page,
    messageNoun: "message" | "comment",
    isMobile: boolean,
) {
    const input = getMessageDraftInput(page, messageNoun);

    if (isMobile) {
        const addPlaceholder = page.getByText(`Add a ${messageNoun}`, {exact: true});
        if (await addPlaceholder.isVisible()) {
            await addPlaceholder.tap();
            await expect(input).toBeVisible();
            const elementHandle = await input.elementHandle();
            if (elementHandle) {
                await elementHandle.waitForElementState("stable");
            }
        }
        await input.tap();
    } else {
        await input.click();
    }
}

export async function fillMessageDraftInput(
    page: Page,
    messageNoun: "message" | "comment",
    text: string,
    isMobile = false,
) {
    const input = getMessageDraftInput(page, messageNoun);
    await focusMessageDraftInput(page, messageNoun, isMobile);
    await input.fill(text);
    await expect(input).toHaveText(text);
    await input.blur();
    return input;
}

export async function clearMessageDraftInput(
    page: Page,
    messageNoun: "message" | "comment",
    isMobile = false,
) {
    const input = getMessageDraftInput(page, messageNoun);
    const modKey = (await isAppleDevicePage(page)) ? "Meta" : "Control";

    await expect
        .poll(async () => {
            await focusMessageDraftInput(page, messageNoun, isMobile);
            await page.keyboard.press(`${modKey}+A`);
            await page.keyboard.press("Backspace");
            return (await input.textContent()) ?? "";
        }, draftPollOptions)
        .toBe("");

    await input.blur();
}

async function insertAccountMentionInMessageDraftInput(
    page: Page,
    messageNoun: "message" | "comment",
    accountName: string,
    isMobile: boolean,
) {
    const input = getMessageDraftInput(page, messageNoun);
    const [firstName] = accountName.split(" ");

    await focusMessageDraftInput(page, messageNoun, isMobile);
    await input.type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();

    await input.type(firstName!);

    if (!isMobile) {
        await input.press("ArrowDown");
        await input.press("Enter");
        await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    } else {
        const mentionItem = page
            .getByTestId("ContentEditorMentionFloater")
            .getByText(firstName!, {exact: true});
        await expect(mentionItem).toBeVisible();
        await mentionItem.tap();
        await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
        await expect(input).toContainText(firstName!);
        await focusMessageDraftInput(page, messageNoun, isMobile);
    }
}

async function setReplyParentOnMessageDraftInput(
    page: Page,
    messageNoun: "message" | "comment",
    messageText: string,
    isMobile: boolean,
) {
    await page.getByText(messageText).evaluate(element => {
        const selection = globalThis.window.getSelection()!;

        const range = globalThis.document.createRange();
        range.setStart(element.firstChild!, 2);
        range.setEnd(element.firstChild!, 8);

        selection.removeAllRanges();
        selection.addRange(range);
    });

    await expect(page.getByText("Reply", {exact: true})).toBeVisible();
    await page.getByText("Reply", {exact: true}).click();

    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await focusMessageDraftInput(page, messageNoun, isMobile);
}

async function cancelMessageDraftReplyParent(page: Page) {
    await page.getByRole("button", {name: "Cancel reply"}).click();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
}

async function sendMessageDraft(page: Page, messageNoun: "message" | "comment", isMobile = false) {
    const sendButton = page.getByRole("button", {name: `Send ${messageNoun}`});
    await expect(sendButton).toBeEnabled();

    if (isMobile) {
        await getMessageDraftInput(page, messageNoun).blur();
        await sendButton.tap();
    } else {
        await sendButton.click();
    }

    await expect(getMessageDraftInput(page, messageNoun)).toHaveText("");
}

async function getMessageInputDropPosition(pageOrLocator: Page | Locator) {
    const messageInputBox = assertExists(
        await (
            "addInitScript" in pageOrLocator
                ? pageOrLocator.getByTestId("MessageInputDropTarget")
                : pageOrLocator
        ).boundingBox(),
    );

    return {
        clientX: Math.round(messageInputBox.x + messageInputBox.width / 2),
        clientY: Math.round(messageInputBox.y + messageInputBox.height / 2),
    };
}

async function createJpegDataTransfer(page: Page) {
    const fileContents = await fs.readFile(jpegFixturePath);

    return await page.evaluateHandle(fileHexContents => {
        const contents = new Uint8Array(Math.ceil(fileHexContents.length / 2));

        for (let i = 0; i < contents.length; i++)
            contents[i] = parseInt(fileHexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, fileContents.toString("hex"));
}

async function prepareMessageDraftInputForFiles(page: Page, messageNoun: "message" | "comment") {
    await page.setViewportSize({width: 1280, height: 720});

    const input = getMessageDraftInput(page, messageNoun);
    await input.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("MessageInputDropTarget")).toBeVisible({timeout: 10_000});
}

async function dropJpegOnMessageDraftInput(page: Page, messageNoun: "message" | "comment") {
    await prepareMessageDraftInputForFiles(page, messageNoun);

    const dataTransfer = await createJpegDataTransfer(page);
    const dropTarget = page.getByTestId("MessageInputDropTarget");

    await dropTarget.dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer,
    });

    await dropTarget.dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer,
    });

    await expect(getMessageInput(page).getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();
}

async function removeAttachedFileFromMessageDraftInput(page: Page) {
    await getMessageInput(page).getByLabel("Remove").first().click();
    await expect(getMessageInput(page).getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();
}

export async function waitForDraftToContainText(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
    text: string,
) {
    await expect
        .poll(async () => {
            const draft = await getMessageDraft(session.action(), {
                spaceId: session.space.id,
                surface,
            });
            return draft.content.doc.textContent;
        }, draftPollOptions)
        .toContain(text);
}

async function waitForDraftToContainFile(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
) {
    await expect
        .poll(async () => {
            const draft = await getMessageDraft(session.action(), {
                spaceId: session.space.id,
                surface,
            });
            return draft.fileIds.length;
        }, draftPollOptions)
        .toBeGreaterThan(0);
}

export async function waitForDraftToBeEmpty(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
) {
    await expect
        .poll(async () => {
            const draft = await getMessageDraft(session.action(), {
                spaceId: session.space.id,
                surface,
            });
            return isContentEmpty(draft.content.doc) && draft.parent === null;
        }, draftPollOptions)
        .toBe(true);
}

async function waitForDraftAccountMention(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
    accountId: AccountId,
) {
    await expect
        .poll(async () => {
            const draft = await getMessageDraft(session.action(), {
                spaceId: session.space.id,
                surface,
            });
            return draft.content.references.accountById.has(accountId);
        }, draftPollOptions)
        .toBe(true);
}

export async function waitForDraftMessagesRangeParent(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
    {
        startIndex,
        endIndex,
    }: {
        startIndex: number;
        endIndex: number;
    },
) {
    await expect
        .poll(async () => {
            const parent = (
                await getMessageDraft(session.action(), {
                    spaceId: session.space.id,
                    surface,
                })
            ).parent;
            return (
                parent?.type === "MessagesRange" &&
                parent.startIndex === startIndex &&
                parent.endIndex === endIndex
            );
        }, draftPollOptions)
        .toBe(true);
}

export async function seedMessageDraft(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
    text: string,
) {
    await updateMessageDraft(session.action(), {
        spaceId: session.space.id,
        surface,
        content: createSimpleMessageContent(text),
        parent: null,
        version: messageDraftVersionClock.now(),
    });
}

export async function seedMessageDraftWithParent(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
    text: string,
    parent: MessageContentPayloadParent,
) {
    await updateMessageDraft(session.action(), {
        spaceId: session.space.id,
        surface,
        content: createSimpleMessageContent(text),
        parent,
        version: messageDraftVersionClock.now(),
    });
}

async function seedMessageDraftWithMention(
    session: MessageDraftTestSession,
    surface: MessageDraftSurface,
    {
        accountId,
        beforeText = "",
        afterText = "",
    }: {
        accountId: AccountId;
        beforeText?: string;
        afterText?: string;
    },
) {
    const content = MessageContentProsemirrorSchema.node("doc", {}, [
        MessageContentProsemirrorSchema.node("paragraph", {}, [
            ...(beforeText ? [MessageContentProsemirrorSchema.text(beforeText)] : []),
            MessageContentProsemirrorSchema.node("mention", {
                mention: cast<ContentMention>({
                    type: "Account",
                    accountId,
                    isShort: false,
                }),
            }),
            ...(afterText ? [MessageContentProsemirrorSchema.text(afterText)] : []),
        ]),
    ]);

    await updateMessageDraft(session.action(), {
        spaceId: session.space.id,
        surface,
        content: assertMessageContent(content),
        parent: null,
        version: messageDraftVersionClock.now(),
    });
}

async function navigate(
    page: Page,
    browserContext: BrowserContext,
    services: TestServices,
    scenario: MessageDraftTestScenario,
    isMobile: boolean,
) {
    await signInAndGoTo(page, browserContext, services, scenario.session, scenario.path);
    await scenario.prepareInput?.(page, isMobile);
}

function getReplyParentForScenario(
    scenario: MessageDraftTestScenarioWithReplyParent,
): MessageContentPayloadParent {
    return {
        type: "MessagesRange" as const,
        startIndex: scenario.replyParentStartIndex,
        endIndex: scenario.replyParentEndIndex,
        startContentVersion: 0,
        endContentVersion: 0,
        startPos: 3,
        endPos: 9,
    };
}

export function getMessageDraftBehaviorTests(): Array<MessageDraftBehaviorTest> {
    return [
        {
            title: "creates a draft",
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await navigate(page, browserContext, services, scenario, isMobile);

                await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText("");

                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} v1`,
                    isMobile,
                );
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} v1`,
                );
            },
        },
        {
            title: "updates a draft",
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await seedMessageDraft(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} v1`,
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} v2`,
                    isMobile,
                );
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} v2`,
                );
            },
        },
        {
            title: "deletes a draft",
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await seedMessageDraft(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} to delete`,
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await clearMessageDraftInput(page, scenario.messageNoun, isMobile);
                await waitForDraftToBeEmpty(scenario.session, scenario.surface);
            },
        },
        {
            title: "hydrates a saved draft after reload",
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await seedMessageDraft(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} after reload`,
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await page.reload();
                await waitForPageReady(page);
                await scenario.prepareInput?.(page, isMobile);

                await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText(
                    `${scenario.draftLabel} after reload`,
                    {timeout: 10_000},
                );
            },
        },
        {
            title: "creates a draft with an account mention",
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithMention();

                await navigate(page, browserContext, services, scenario, isMobile);

                const input = getMessageDraftInput(page, scenario.messageNoun);
                await insertAccountMentionInMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    scenario.mentionAccountName,
                    isMobile,
                );
                await input.pressSequentially(" says hello");
                await blurMessageDraftInput(page, scenario.messageNoun, isMobile);

                await waitForDraftAccountMention(
                    scenario.session,
                    scenario.surface,
                    scenario.mentionAccountId,
                );
                await waitForDraftToContainText(scenario.session, scenario.surface, " says hello");
            },
        },
        {
            title: "updates a draft with an account mention",
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithMention();

                await seedMessageDraftWithMention(scenario.session, scenario.surface, {
                    accountId: scenario.mentionAccountId,
                    afterText: " v1",
                });
                await navigate(page, browserContext, services, scenario, isMobile);

                const input = getMessageDraftInput(page, scenario.messageNoun);
                await focusMessageDraftInput(page, scenario.messageNoun, isMobile);
                await input.press("End");
                await input.pressSequentially(" updated");
                await blurMessageDraftInput(page, scenario.messageNoun, isMobile);

                await waitForDraftAccountMention(
                    scenario.session,
                    scenario.surface,
                    scenario.mentionAccountId,
                );
                await waitForDraftToContainText(scenario.session, scenario.surface, " updated");
            },
        },
        {
            title: "deletes a draft with an account mention",
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithMention();

                await seedMessageDraftWithMention(scenario.session, scenario.surface, {
                    accountId: scenario.mentionAccountId,
                    afterText: " to delete",
                });
                await navigate(page, browserContext, services, scenario, isMobile);

                await clearMessageDraftInput(page, scenario.messageNoun, isMobile);
                await waitForDraftToBeEmpty(scenario.session, scenario.surface);
            },
        },
        {
            title: "hydrates a saved draft with an account mention after reload",
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithMention();

                await seedMessageDraftWithMention(scenario.session, scenario.surface, {
                    accountId: scenario.mentionAccountId,
                    afterText: " after reload",
                });
                await navigate(page, browserContext, services, scenario, isMobile);

                await page.reload();
                await waitForPageReady(page);
                await scenario.prepareInput?.(page, isMobile);

                await expect(getMessageDraftInput(page, scenario.messageNoun)).toContainText(
                    scenario.mentionAccountName,
                    {timeout: 10_000},
                );
                await expect(getMessageDraftInput(page, scenario.messageNoun)).toContainText(
                    "after reload",
                );
            },
        },
        {
            title: "creates a draft with a reply parent",
            // Mobile has no text-selection reply toolbar (`MessagingViewPointerToolbar` is
            // desktop-only). Long-press/swipe reply creates a whole-message parent, not the
            // `MessagesRange` parent this test creates via UI.
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithReplyParent();

                await navigate(page, browserContext, services, scenario, isMobile);

                await setReplyParentOnMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    scenario.replyMessageText,
                    isMobile,
                );
                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} with parent`,
                    isMobile,
                );
                await waitForDraftMessagesRangeParent(scenario.session, scenario.surface, {
                    startIndex: scenario.replyParentStartIndex,
                    endIndex: scenario.replyParentEndIndex,
                });
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with parent`,
                );
            },
        },
        {
            title: "updates a draft with a reply parent",
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithReplyParent();

                await seedMessageDraftWithParent(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with parent v1`,
                    getReplyParentForScenario(scenario),
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} with parent v2`,
                    isMobile,
                );
                await waitForDraftMessagesRangeParent(scenario.session, scenario.surface, {
                    startIndex: scenario.replyParentStartIndex,
                    endIndex: scenario.replyParentEndIndex,
                });
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with parent v2`,
                );
            },
        },
        {
            title: "deletes a draft with a reply parent",
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithReplyParent();

                await seedMessageDraftWithParent(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with parent to delete`,
                    getReplyParentForScenario(scenario),
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await clearMessageDraftInput(page, scenario.messageNoun, isMobile);
                await cancelMessageDraftReplyParent(page);
                await blurMessageDraftInput(page, scenario.messageNoun);
                await waitForDraftToBeEmpty(scenario.session, scenario.surface);
            },
        },
        {
            title: "clears a draft with a reply parent after sending",
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithReplyParent();

                await seedMessageDraftWithParent(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with parent to send`,
                    getReplyParentForScenario(scenario),
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await expect(page.getByTestId("MessageInputParent")).toBeVisible();
                await waitForDraftMessagesRangeParent(scenario.session, scenario.surface, {
                    startIndex: scenario.replyParentStartIndex,
                    endIndex: scenario.replyParentEndIndex,
                });
                await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText(
                    `${scenario.draftLabel} with parent to send`,
                    {timeout: 10_000},
                );

                await sendMessageDraft(page, scenario.messageNoun, isMobile);
                await expect(page.getByTestId("MessageInputParent")).toBeHidden();
                await waitForDraftToBeEmpty(scenario.session, scenario.surface);
            },
        },
        {
            title: "hydrates a saved draft with a reply parent after reload",
            skipOnMobile: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepareWithReplyParent();

                await seedMessageDraftWithParent(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with parent after reload`,
                    getReplyParentForScenario(scenario),
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await page.reload();
                await waitForPageReady(page);
                await scenario.prepareInput?.(page, isMobile);

                await expect(page.getByTestId("MessageInputParent")).toBeVisible();
                await expect(page.getByTestId("MessageInputParent")).toContainText("lmnopq");
                await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText(
                    `${scenario.draftLabel} with parent after reload`,
                    {timeout: 10_000},
                );
            },
        },
        {
            title: "creates a draft with an attached file",
            skipOnMobile: true,
            requiresFileDrop: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await navigate(page, browserContext, services, scenario, isMobile);

                await dropJpegOnMessageDraftInput(page, scenario.messageNoun);
                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} with file`,
                    isMobile,
                );
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with file`,
                );
                await expect(
                    getMessageInput(page).getByTestId("ContentFilePreview:image/jpeg"),
                ).toBeVisible();
            },
        },
        {
            title: "hydrates a saved draft with an attached file after reload",
            skipOnMobile: true,
            requiresFileDrop: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await navigate(page, browserContext, services, scenario, isMobile);

                await dropJpegOnMessageDraftInput(page, scenario.messageNoun);
                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} with file after reload`,
                    isMobile,
                );
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with file after reload`,
                );
                await waitForDraftToContainFile(scenario.session, scenario.surface);

                await page.reload();
                await waitForPageReady(page);
                await scenario.prepareInput?.(page, isMobile);

                await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText(
                    `${scenario.draftLabel} with file after reload`,
                    {timeout: 10_000},
                );
                await expect(
                    getMessageInput(page).getByTestId("ContentFilePreview:image/jpeg"),
                ).toBeVisible();
            },
        },
        {
            title: "updates a draft with an attached file",
            skipOnMobile: true,
            requiresFileDrop: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await seedMessageDraft(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with file v1`,
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await dropJpegOnMessageDraftInput(page, scenario.messageNoun);
                await fillMessageDraftInput(
                    page,
                    scenario.messageNoun,
                    `${scenario.draftLabel} with file v2`,
                    isMobile,
                );
                await waitForDraftToContainText(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with file v2`,
                );
                await expect(
                    getMessageInput(page).getByTestId("ContentFilePreview:image/jpeg"),
                ).toBeVisible();
            },
        },
        {
            title: "deletes a draft with an attached file",
            skipOnMobile: true,
            requiresFileDrop: true,
            run: async ({page, context: browserContext, isMobile}, prepares, services) => {
                const scenario = await prepares.prepare();

                await seedMessageDraft(
                    scenario.session,
                    scenario.surface,
                    `${scenario.draftLabel} with file to delete`,
                );
                await navigate(page, browserContext, services, scenario, isMobile);

                await dropJpegOnMessageDraftInput(page, scenario.messageNoun);
                await removeAttachedFileFromMessageDraftInput(page);
                await clearMessageDraftInput(page, scenario.messageNoun, isMobile);
                await waitForDraftToBeEmpty(scenario.session, scenario.surface);
            },
        },
    ];
}
