import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});
const session3 = createTestSession(context, space, {name: "Kendall Roy"});

test("site breadcrumb opens site chrome around a chat from inbox", async ({
    page,
    context: browserContext,
}) => {
    const testSpace = await TestSpace.create(context);
    const recipient = await testSpace.createSession({name: "Inbox Recipient"});
    const sender = await testSpace.createSession({name: "Inbox Sender"});
    const siteName = "Inbox Site";
    const documentTitle = "Lorem ipsum";
    const chatName = "Inbox Site Chat";

    const site = await TestSite.create(recipient, {name: siteName, access: "Public"});
    const document = await TestDocument.create(recipient, {title: documentTitle});
    await site.addEntity(recipient, {
        entityId: `Document:${document.id}`,
        parentId: site.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    const chat = await TestChat.createRoom(recipient, {name: chatName, access: "Public"});
    await site.addEntity(recipient, {
        entityId: `Chat:${chat.id}`,
        parentId: site.initialRootContainerId,
        orderKey: generateOrderKeyBetween(initialOrderKey, null),
    });

    await chat.sendMessage(sender, "Message from the second site entity");
    await ProcessContextModule.waitForTestTasks();
    await context.waitForSqsProcessJobs();

    await services.signIn(browserContext, recipient);
    await page.goto(`/inbox/${testSpace.id}`);
    await page.waitForFunction("dev.ready");

    const chatTopBar = page.getByTestId("ChatViewTopBar");
    await chatTopBar.getByRole("button", {name: siteName}).click();

    await expect(chatTopBar.getByText(chatName, {exact: true})).toBeVisible();
    await expect(page.getByTestId("SiteSideBarNavigationBar")).toBeVisible();
    await expect(page.getByTestId("InboxViewEntries")).toHaveCount(0);
});

test("can see new chat notifications on inbox button and preview", async ({
    page: page1,
    context: browserContext1,
    browser,
}) => {
    const chat1Id = await getOrCreateChatForAccounts(context.action(session2), {
        spaceId: space.id,
        otherAccountIds: [session1.accountId],
    });

    const chat2Id = await getOrCreateChatForAccounts(context.action(session3), {
        spaceId: space.id,
        otherAccountIds: [session1.accountId],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/chat/${chat1Id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session3);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/chat/${chat2Id}`);

    const browserContext3 = await browser.newContext();
    await services.signIn(browserContext3, session1);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/dev/empty/${space.id}`);

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeHidden();

    await expect(page3.getByText("No new notifications")).toBeHidden();
    await page3.getByRole("button", {name: "Inbox"}).click();
    await expect(page3.getByText("No new notifications")).toBeVisible();
    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();
    await expect(page3.getByText("test3")).toBeHidden();
    await page3.click("body");
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("test1");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();

    await expect(page3.getByText("test1")).toBeHidden();
    await page3.getByRole("button", {name: "Inbox"}).click();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByText("test1")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();
    await expect(page3.getByText("test3")).toBeHidden();
    await page3.click("body");
    await expect(page3.getByText("test1")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();

    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("test2");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();

    await expect(page3.getByText("test2")).toBeHidden();
    await page3.getByRole("button", {name: "Inbox"}).click();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test3")).toBeHidden();
    await page3.click("body");
    await expect(page3.getByText("test2")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();

    await page2.getByRole("textbox", {name: "New message"}).pressSequentially("test3");
    await page2.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("2")).toBeVisible();

    await expect(page3.getByText("test2")).toBeHidden();
    await page3.getByRole("button", {name: "Inbox"}).click();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();
    await page3.click("body");
    await expect(page3.getByText("test2")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("2")).toBeVisible();

    await expect(page3.getByText("test2")).toBeHidden();
    await page3.getByRole("button", {name: "Inbox"}).click();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();

    await expect(page3.getByText("test1")).toBeHidden();
    await page3.getByRole("option", {name: "Siobahn sent you a message"}).click();
    await expect(page3.getByText("test1")).toBeVisible();
    await expect(page3.getByText("test3")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("2")).toBeVisible();

    await page3.getByRole("textbox", {name: "New message"}).pressSequentially("test4");
    await page3.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("test1")).toBeVisible();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("test4")).toBeVisible();

    await page3.getByRole("button", {name: "Close"}).click();

    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();
    await expect(page3.getByText("test4")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();

    await expect(page3.getByText("test3")).toBeHidden();
    await page3.getByRole("button", {name: "Inbox"}).click();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeHidden();
    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();

    await page3.getByRole("option", {name: "Kendall sent you a message"}).click();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();

    await page3.getByRole("textbox", {name: "New message"}).pressSequentially("test5");
    await page3.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("test5")).toBeVisible();

    await page3.getByRole("button", {name: "Close"}).click();

    await expect(page3.getByText("test3")).toBeHidden();
    await expect(page3.getByText("test5")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeHidden();

    await browserContext2.close();
    await browserContext3.close();
});

test("can see new chat notifications from inbox", async ({
    page: page1,
    context: browserContext1,
    browser,
}) => {
    const chat1Id = await getOrCreateChatForAccounts(context.action(session2), {
        spaceId: space.id,
        otherAccountIds: [session1.accountId],
    });

    const chat2Id = await getOrCreateChatForAccounts(context.action(session3), {
        spaceId: space.id,
        otherAccountIds: [session1.accountId],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/chat/${chat1Id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session3);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/chat/${chat2Id}`);

    const browserContext3 = await browser.newContext();
    await services.signIn(browserContext3, session1);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/dev/empty/${space.id}`);

    await page3.getByRole("button", {name: "Inbox"}).click();
    await page3
        .getByTestId("SpaceLayoutSideBarInboxOverlay")
        .getByRole("button", {name: "Inbox"})
        .click();

    await expect(page3.getByText("No new notifications")).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeHidden();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();

    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("test6");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("No new notifications")).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();

    await page3.reload();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();

    await page2.getByRole("textbox", {name: "New message"}).pressSequentially("test7");
    await page2.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await page3.getByRole("option", {name: "Kendall sent you a message"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Next notification"})).toBeEnabled();
    await expect(page3.getByRole("button", {name: "Previous notification"})).toBeDisabled();

    await page3.getByRole("button", {name: "Next notification"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Next notification"})).toBeDisabled();
    await expect(page3.getByRole("button", {name: "Previous notification"})).toBeEnabled();

    await page3.getByRole("button", {name: "Previous notification"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await expect(page3.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toBeEnabled();
    await page3.getByTestId(/^InboxBannerOutletContainerDoneButton:/).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await page3.getByTestId("InboxViewEntries").getByRole("button", {name: "Done"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeHidden();

    await page3.getByRole("button", {name: "New", exact: true}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();

    await expect(page3.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toBeEnabled();
    await page3.getByTestId(/^InboxBannerOutletContainerDoneButton:/).click();

    await expect(page3.getByText("No new notifications")).toBeVisible();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeHidden();

    await expect(page3.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toBeHidden();

    await page3.getByTestId("InboxViewEntries").getByRole("button", {name: "Done"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();

    await page3.getByTestId(/^InboxBannerOutletContainerDoneButton:/).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeVisible();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeHidden();

    await page3.getByRole("button", {name: "New", exact: true}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByRole("option", {name: "Kendall sent you a message"})).toBeHidden();
    await expect(page3.getByRole("option", {name: "Siobahn sent you a message"})).toBeVisible();

    await browserContext2.close();
    await browserContext3.close();
});

test("can go offline then when reconnecting notifications catch up", async ({
    page: page1,
    context: browserContext1,
    browser,
}) => {
    const chat1Id = await getOrCreateChatForAccounts(context.action(session2), {
        spaceId: space.id,
        otherAccountIds: [session1.accountId],
    });

    await services.signIn(browserContext1, session2);
    await page1.goto(`/chat/${chat1Id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session1);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/dev/empty/${space.id}`);

    const browserContext3 = await browser.newContext();
    await services.signIn(browserContext3, session1);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/inbox/${space.id}`);

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("1")).toBeHidden();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeHidden();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeHidden();

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("@");
    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially(" test8");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    await page2.evaluate("dev.myAccount.toggleShouldConnect()");
    await page3.evaluate("dev.myAccount.toggleShouldConnect()");

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("@");
    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially(" test9");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("@");
    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially(" test10");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    // Absolutely make sure realtime events aren't arriving with a delay.
    await wait(2000);

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    await page2.evaluate("dev.myAccount.toggleShouldConnect()");
    await page3.evaluate("dev.myAccount.toggleShouldConnect()");

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("3")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("3")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeHidden();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test10")).toBeVisible();

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("@");
    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially("Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).pressSequentially(" test11");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Inbox"}).getByText("4")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Inbox"}).getByText("4")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test10")).toBeHidden();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test11")).toBeVisible();

    await browserContext2.close();
    await browserContext3.close();
});
