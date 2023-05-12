import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {getOrCreateChatForAccounts} from "~/server/dynamo/chat_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {wait} from "~/shared/helpers/async/wait";

const context = createTestContext();
const server = createTestServer(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});
const session3 = createTestSession(context, space, {name: "Kendall Roy"});

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

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/chat/${chat1Id}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session3);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/${chat2Id}`);

    const browserContext3 = await browser.newContext();
    await server.signIn(browserContext3, session1);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/s/${space.id}`);

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeHidden();

    await expect(page3.getByText("No new notifications")).toBeHidden();
    await page3.getByRole("button", {name: "Notifications"}).hover();
    await expect(page3.getByText("No new notifications")).toBeVisible();
    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();
    await expect(page3.getByText("test3")).toBeHidden();
    await page3.mouse.move(10, 10);
    await page3.mouse.move(15, 10);
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await page1.getByRole("textbox", {name: "New message"}).type("test1");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();

    await expect(page3.getByText("test1")).toBeHidden();
    await page3.getByRole("button", {name: "Notifications"}).hover();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByText("test1")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();
    await expect(page3.getByText("test3")).toBeHidden();
    await page3.mouse.move(10, 10);
    await page3.mouse.move(15, 10);
    await expect(page3.getByText("test1")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();

    await page1.getByRole("textbox", {name: "New message"}).type("test2");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();

    await expect(page3.getByText("test2")).toBeHidden();
    await page3.getByRole("button", {name: "Notifications"}).hover();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test3")).toBeHidden();
    await page3.mouse.move(10, 10);
    await page3.mouse.move(15, 10);
    await expect(page3.getByText("test2")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();

    await page2.getByRole("textbox", {name: "New message"}).type("test3");
    await page2.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("2")).toBeVisible();

    await expect(page3.getByText("test2")).toBeHidden();
    await page3.getByRole("button", {name: "Notifications"}).hover();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();
    await page3.mouse.move(10, 10);
    await page3.mouse.move(15, 10);
    await expect(page3.getByText("test2")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("2")).toBeVisible();

    await expect(page3.getByText("test2")).toBeHidden();
    await page3.getByRole("button", {name: "Notifications"}).hover();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();

    await expect(page3.getByText("test1")).toBeHidden();
    await page3.getByText("Siobahn sent you a chat message").click();
    await expect(page3.getByText("test1")).toBeVisible();
    await expect(page3.getByText("test3")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("2")).toBeVisible();

    await page3.getByRole("textbox", {name: "New message"}).type("test4");
    await page3.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("test1")).toBeVisible();
    await expect(page3.getByText("test2")).toBeVisible();
    await expect(page3.getByText("test4")).toBeVisible();

    await page3.getByRole("button", {name: "Close"}).click();

    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();
    await expect(page3.getByText("test4")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();

    await expect(page3.getByText("test3")).toBeHidden();
    await page3.getByRole("button", {name: "Notifications"}).hover();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeHidden();
    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("test1")).toBeHidden();
    await expect(page3.getByText("test2")).toBeHidden();

    await page3.getByText("Kendall sent you a chat message").click();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();

    await page3.getByRole("textbox", {name: "New message"}).type("test5");
    await page3.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("test3")).toBeVisible();
    await expect(page3.getByText("test5")).toBeVisible();

    await page3.getByRole("button", {name: "Close"}).click();

    await expect(page3.getByText("test3")).toBeHidden();
    await expect(page3.getByText("test5")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeHidden();
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

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/chat/${chat1Id}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session3);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/${chat2Id}`);

    const browserContext3 = await browser.newContext();
    await server.signIn(browserContext3, session1);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/s/${space.id}`);

    await page3.getByRole("button", {name: "Notifications"}).click();

    await expect(page3.getByText("No new notifications")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeHidden();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();

    await page1.getByRole("textbox", {name: "New message"}).type("test6");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("No new notifications")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();

    await page3.reload();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByText("No new notifications")).toBeHidden();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();

    await page2.getByRole("textbox", {name: "New message"}).type("test7");
    await page2.getByRole("button", {name: "Send message"}).click();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await page3.getByText("Kendall sent you a chat message").click();

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

    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Done"})).toBeEnabled();
    await page3.getByRole("button", {name: "Done"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
    await expect(page3.getByText("No new notifications")).toBeHidden();

    await page3.getByRole("button", {name: "Old"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeHidden();

    await page3.getByRole("button", {name: "New", exact: true}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();

    await expect(page3.getByRole("button", {name: "Done"})).toBeEnabled();
    await page3.getByRole("button", {name: "Done"}).click();

    await expect(page3.getByText("No new notifications")).toBeVisible();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeHidden();

    await expect(page3.getByRole("button", {name: "Done"})).toBeDisabled();

    await page3.getByRole("button", {name: "Old"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();

    await page3.getByRole("button", {name: "Move to new"}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeVisible();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeHidden();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeVisible();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeHidden();

    await page3.getByRole("button", {name: "New", exact: true}).click();

    await expect(page3.getByTestId("ChatViewTopBar").getByText("Kendall")).toBeHidden();
    await expect(page3.getByTestId("ChatViewTopBar").getByText("Siobahn")).toBeVisible();

    await expect(page3.getByText("Kendall sent you a chat message")).toBeHidden();
    await expect(page3.getByText("Siobahn sent you a chat message")).toBeVisible();
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

    await server.signIn(browserContext1, session2);
    await page1.goto(`/s/${space.id}/chat/${chat1Id}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session1);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}`);

    const browserContext3 = await browser.newContext();
    await server.signIn(browserContext3, session1);
    const page3 = await browserContext3.newPage();
    await page3.goto(`/s/${space.id}/inbox`);

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("1")).toBeHidden();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeHidden();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeHidden();

    await page1.getByRole("textbox", {name: "New message"}).type("@Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).type(" test8");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    await page2.evaluate("dev.myAccount.toggleShouldConnect()");
    await page3.evaluate("dev.myAccount.toggleShouldConnect()");

    await page1.getByRole("textbox", {name: "New message"}).type("@Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).type(" test9");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    await page1.getByRole("textbox", {name: "New message"}).type("@Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).type(" test10");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    // Absolutely make sure realtime events aren't arriving with a delay.
    await wait(2000);

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("1")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeVisible();

    await page2.evaluate("dev.myAccount.toggleShouldConnect()");
    await page3.evaluate("dev.myAccount.toggleShouldConnect()");

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("3")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("3")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test8")).toBeHidden();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test10")).toBeVisible();

    await page1.getByRole("textbox", {name: "New message"}).type("@Logan");
    await page1.getByRole("textbox", {name: "New message"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "New message"}).press("Enter");
    await page1.getByRole("textbox", {name: "New message"}).type(" test11");
    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(page2.getByRole("button", {name: "Notifications"}).getByText("4")).toBeVisible();
    await expect(page3.getByRole("button", {name: "Notifications"}).getByText("4")).toBeVisible();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test10")).toBeHidden();
    await expect(page3.getByRole("listbox", {name: "Inbox"}).getByText("test11")).toBeVisible();
});
