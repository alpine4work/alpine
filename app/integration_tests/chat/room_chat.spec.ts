import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {MessageContentProsemirrorSchema} from "~/shared/content/message_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";

const {context, services} = createTestServices();

async function openChatShareOverlay(page: Page) {
    await page.getByTestId("ChatViewTopBar").getByLabel("More").click();
    await page.getByRole("menuitem", {name: "Share"}).click();
    await expect(page.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
}

test("can turn a direct chat into a chat room in realtime", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);
    const chat = await TestChat.get(session1, session2, session3);
    const roomName = "Realtime Room";

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/chat/${chat.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/${chat.id}`);

    await page1.getByTestId("ChatViewTopBar").getByLabel("More").click();
    await page1.getByRole("menuitem", {name: "Turn into chat room"}).click();
    await page1.getByPlaceholder("My Team").fill(roomName);
    await page1.getByRole("button", {name: "Convert"}).click();

    await expect(page1.getByRole("heading", {name: roomName})).toBeVisible();
    await expect(page2.getByRole("heading", {name: roomName})).toBeVisible();

    await browserContext2.close();
});

test("can change a chat room name in realtime", async ({
    browser,
    context: browserContext1,
    page: page1,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const oldName = "Room Name Before";
    const newName = "Room Name After";
    const chat = await TestChat.createRoom(session1, {name: oldName, access: "Public"});

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/chat/${chat.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page1.getByRole("heading", {name: oldName})).toBeVisible();
    await expect(page2.getByRole("heading", {name: oldName})).toBeVisible();

    await page1.getByTestId("ChatViewTopBar").getByLabel("More").click();
    await page1.getByRole("menuitem", {name: "Edit name"}).click();

    if (!isMobile) {
        const roomNameInput = page1.getByTestId("ChatViewTopBar").getByPlaceholder(oldName);
        await roomNameInput.fill(newName);
        await roomNameInput.press("Enter");
    } else {
        const roomNameInput = page1.getByRole("textbox", {name: "Name"});
        await expect(roomNameInput).toBeVisible();
        await roomNameInput.fill(newName);
        await roomNameInput.press("Enter");
    }

    await expect(page1.getByRole("heading", {name: newName})).toBeVisible();
    await expect(page2.getByRole("heading", {name: newName})).toBeVisible();

    await browserContext2.close();
});

test("can change chat room access policy in realtime", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.createRoom(session1, {
        name: "Realtime Access Policy",
        access: "Public",
    });

    await chat.sendMessage(session1, "hello from room");

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/chat/${chat.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page2.getByLabel("New message")).toBeVisible();

    await openChatShareOverlay(page1);
    await page1.getByTestId("ShareOverlayDefaultGrant").getByRole("button").click();
    await page1.getByRole("menuitem", {name: "can view"}).click();

    await expect(page2.getByText("hello from room")).toBeVisible();
    await expect(page2.getByLabel("New message")).toBeHidden();
    await expect(page2.getByRole("button", {name: "Send message"})).toBeHidden();

    await browserContext2.close();
});

test("can lose access to a chat room in realtime", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.createRoom(session1, {
        name: "Loses Access Room",
        access: "Private",
    });

    await chat.roomAccess.grant(session1, session2, "Edit");
    await chat.sendMessage(session1, "hello before revoke");

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/chat/${chat.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page2.getByText("hello before revoke")).toBeVisible();

    await openChatShareOverlay(page1);
    await page1
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button")
        .click();
    await page1.getByRole("menuitem", {name: "remove access"}).click();

    await expect(page2.getByText("Couldn’t open chat")).toBeVisible();
    await expect(page2.getByRole("heading", {name: "Loses Access Room"})).toBeHidden();

    await browserContext2.close();
});

test("view only chat room can read messages but hides message input", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.createRoom(session1, {
        name: "View Only Room",
        access: "Private",
    });

    await chat.roomAccess.grant(session1, session2, "View");
    await chat.sendMessage(session1, "message for viewers");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page.getByRole("heading", {name: "View Only Room"})).toBeVisible();
    await expect(page.getByText("message for viewers")).toBeVisible();
    await expect(page.getByLabel("New message")).toBeHidden();
    await expect(page.getByRole("button", {name: "Send message"})).toBeHidden();
});

test("chat room can be shared by URL with view access", async ({browser, page: page2}) => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const chat = await TestChat.createRoom(session1, {
        name: "URL Shared Room",
        access: "Private",
    });

    await chat.sendMessage(session1, "url-shared message");

    await page2.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page2.getByText("Couldn’t open chat")).toBeVisible();
    await expect(page2.getByRole("heading", {name: "URL Shared Room"})).toBeHidden();

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/chat/${chat.id}`);

    await openChatShareOverlay(page1);
    await page1.getByTestId("ShareOverlayUrlGrant").getByRole("button").click();
    await page1.getByRole("menuitem", {name: "can view"}).click();

    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "URL Shared Room"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("heading", {name: "URL Shared Room"})).toBeVisible();
    await expect(page2.getByText("url-shared message")).toBeVisible();
    await expect(page2.getByLabel("New message")).toBeHidden();
    await expect(page2.getByRole("button", {name: "Send message"})).toBeHidden();

    await browserContext1.close();
});

test("anonymous users can view room chat mentions shared with URL grant", async ({page}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const mentionAccount = await space.createSession({name: "Mentioned Account"});

    const publicDocument = await TestDocument.create(session, {
        title: "Public room chat document",
    });
    await publicDocument.access.grantUrl(session, "View");

    const privateDocument = await TestDocument.create(session, {
        title: "Private room chat document",
    });

    const chat = await TestChat.createRoom(session, {
        name: "URL Shared Mention Room",
        access: "Private",
    });

    await chat.sendMessage(
        session,
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Mentions: "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: mentionAccount.account.id,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text(", "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${publicDocument.id}`,
                    }),
                }),
                MessageContentProsemirrorSchema.text(", "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${privateDocument.id}`,
                    }),
                }),
                MessageContentProsemirrorSchema.text("."),
            ]),
        ]),
    );

    await chat.roomAccess.grantUrl(session, "View");

    await page.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page.getByRole("heading", {name: "URL Shared Mention Room"})).toBeVisible();
    await expect(page.getByText("Mentions:")).toBeVisible();

    const mentions = page.getByTestId("ContentMentionText");

    await expect(mentions.filter({hasText: "Mentioned Account"})).toBeVisible();
    await expect(mentions.filter({hasText: "Public room chat document"})).toBeVisible();
    await expect(mentions.filter({hasText: "Private document"})).toBeVisible();
});

test("anonymous users can view room chat files shared with URL grant", async ({page}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const chat = await TestChat.createRoom(session, {
        name: "URL Shared Files Room",
        access: "Private",
    });

    const file = await TestFile.create(session);
    await file.attach(session, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));

    await chat.sendMessage(session, "message with file", {
        files: [file],
    });

    await chat.roomAccess.grantUrl(session, "View");

    await page.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page.getByRole("heading", {name: "URL Shared Files Room"})).toBeVisible();
    await expect(page.getByText("message with file")).toBeVisible();
    await expect(page.getByTestId("ContentFilePreview:image/png")).toHaveCount(1);
});

test("anonymous users can open message context menu in URL shared room chat", async ({
    page,
    isMobile,
}) => {
    if (isMobile) return;

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const chat = await TestChat.createRoom(session, {
        name: "URL Shared Context Menu Room",
        access: "Private",
    });

    const message = await chat.sendMessage(session, "context menu message");

    await chat.roomAccess.grantUrl(session, "View");

    await page.goto(`/s/${space.id}/chat/${chat.id}`);

    await expect(page.getByText("context menu message")).toBeVisible();

    const messageContent = page
        .getByTestId(new RegExp(`^MessageView:[^:]+:${message.index}$`))
        .getByTestId("MessageViewContent");

    await messageContent.click({button: "right"});
    await expect(page.getByTestId("ContextMenu").getByText("Copy link")).toBeVisible();
});

test("can create a new chat room from create menu", async ({context: browserContext, page}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const roomName = "Created Chat Room";

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/dev/empty`);

    await page.getByLabel("Create").click();
    await page.getByText("More").click();

    await page.getByText("Chat room", {exact: true}).click();

    await page.getByLabel("Name").fill(roomName);
    await page.getByLabel("Name").press("Enter");

    await expect(page.getByRole("heading", {name: roomName})).toBeVisible();
});
