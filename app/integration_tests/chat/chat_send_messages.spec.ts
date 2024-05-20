import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getOrCreateChatForAccounts, sendChatMessage} from "~/server/chat/data/chat_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const {context, services} = createTestServices();

test("chat message stays when changing chat selection", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await page.getByRole("textbox", {name: "New message"}).fill("message0");

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message0");
    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeVisible();
    await page.getByRole("option", {name: "Siobahn Roy"}).click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message0");
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeVisible();
    await page.getByRole("option", {name: "Kendall Roy"}).click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message0");
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message0");
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message0");
    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
});

test("send chat message to another account", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).fill("message1");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message1");
    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Siobahn");

    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("option", {name: "Siobahn Roy"}).click();

    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("message1")).toBeVisible();
});

test("can see chat message from recipient account", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("message1")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Logan");
    await page.getByRole("option", {name: "Logan Roy"}).click();

    await expect(page.getByText("message1")).toBeVisible();
});

test("can not see chat message from non-recipient account but can send a different message", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await services.signIn(browserContext, session3);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).fill("message2");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message2");

    await page.getByRole("combobox", {name: "To"}).fill("Logan");
    await page.getByRole("option", {name: "Logan Roy"}).click();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message2");
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("message2")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
});

test("send chat message to multiple accounts", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const chatId2 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await sendChatMessage(session3.action(), {
        chatId: chatId2,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message2"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).fill("message3");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message3");

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();

    await page.getByRole("combobox", {name: "To"}).fill("Kendall");

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeVisible();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();

    await page.getByRole("option", {name: "Kendall Roy"}).click();

    await expect(page.getByText("message2")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();

    await page.getByRole("combobox", {name: "To"}).fill("Siobahn");

    await page.getByRole("option", {name: "Siobahn Roy"}).click();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message3");
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("message3")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
});

test("reloading the page will keep the chat selection", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const chatId2 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.account.id],
    });

    const chatId3 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await sendChatMessage(session3.action(), {
        chatId: chatId2,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message2"),
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId3,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message3"),
    });

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Logan");
    await page.getByRole("option", {name: "Logan Roy"}).click();

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.reload();

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Kendall");
    await page.getByRole("option", {name: "Kendall Roy"}).click();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();

    await page.reload();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();
});

test("can remove selected chat accounts", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const chatId2 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.account.id],
    });

    const chatId3 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await sendChatMessage(session3.action(), {
        chatId: chatId2,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message2"),
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId3,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message3"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Siobahn");
    await page.getByRole("option", {name: "Siobahn Roy"}).click();

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Kendall");
    await page.getByRole("option", {name: "Kendall Roy"}).click();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("Backspace");

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("Backspace");

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Siobahn");
    await page.getByRole("listbox").getByRole("option", {name: "Siobahn Roy"}).click();

    await page.getByRole("combobox", {name: "To"}).fill("Kendall");
    await page.getByRole("listbox").getByRole("option", {name: "Kendall Roy"}).click();

    await expect(page.getByText("message3")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();

    await page.keyboard.press("Backspace");

    await expect(page.getByText("message2")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.keyboard.press("Backspace");

    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();
});

test("includes recommended group chats for autocomplete", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const chatId2 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.account.id],
    });

    const chatId3 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await sendChatMessage(session3.action(), {
        chatId: chatId2,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message2"),
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId3,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message3"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Siobahn Roy"),
    ).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall Roy"),
    ).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall and Siobahn"),
    ).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Siobahn Roy"),
    ).toBeVisible();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall Roy"),
    ).toBeVisible();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall and Siobahn"),
    ).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).fill("Siobahn");

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Siobahn Roy"),
    ).toBeVisible();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall Roy"),
    ).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall and Siobahn"),
    ).toBeHidden();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("option", {name: "Siobahn Roy"}).click();

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Siobahn Roy"),
    ).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall Roy"),
    ).toBeVisible();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall and Siobahn"),
    ).toBeVisible();

    await page.getByText("Kendall and Siobahn").click();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeVisible();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Siobahn Roy"),
    ).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall Roy"),
    ).toBeHidden();
    await expect(
        page.getByRole("listbox", {name: "Suggestions"}).getByText("Kendall and Siobahn"),
    ).toBeHidden();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeVisible();
});

test("can open chat directly by id", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const chatId2 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.account.id],
    });

    const chatId3 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await sendChatMessage(session3.action(), {
        chatId: chatId2,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message2"),
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId3,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message3"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/${chatId1}`);

    await expect(page.getByRole("heading", {name: "Siobahn"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Kendall"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeHidden();

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId2}`);

    await expect(page.getByRole("heading", {name: "Kendall"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Siobahn"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeHidden();

    await expect(page.getByText("message2")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId3}`);

    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Siobahn", exact: true})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall", exact: true})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Siobahn Roy", exact: true})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall Roy", exact: true})).toBeHidden();

    await expect(page.getByText("message3")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();

    await page.goto(`/s/${space.id}/chat/with/${session2.account.id}`);

    await expect(page.getByRole("heading", {name: "Siobahn"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Kendall"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeHidden();

    await expect(page.getByText("message1")).toBeVisible();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await page.goto(`/s/${space.id}/chat/with/${session3.account.id}`);

    await expect(page.getByRole("heading", {name: "Kendall"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Siobahn"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeHidden();

    await expect(page.getByText("message2")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();
});

test("can send self a message", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    const chatId1 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const chatId2 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.account.id],
    });

    const chatId3 = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id, session3.account.id],
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId1,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message1"),
    });

    await sendChatMessage(session3.action(), {
        chatId: chatId2,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message2"),
    });

    await sendChatMessage(session1.action(), {
        chatId: chatId3,
        parentMessageIndex: null,
        content: createSimpleMessageContent("message3"),
    });

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();
    await expect(page.getByText("message4")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).fill("message4");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message4");

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();
    await expect(page.getByText("message4")).toBeVisible();

    await page.getByRole("option", {name: "Logan Roy"}).click();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();
    await expect(page.getByText("message4")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("message4");
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("message4")).toBeVisible();
    await expect(page.getByText("message1")).toBeHidden();
    await expect(page.getByText("message2")).toBeHidden();
    await expect(page.getByText("message3")).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
});

test("two accounts can look at an empty chat and see new messages appear in realtime", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, , , session4] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
        space.createSession({name: "Roman Roy"}),
    ]);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/chat/new`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session4);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/chat/new`);

    await expect(page1.getByTestId("ChatAccountPickerInput").getByText("Roman Roy")).toBeHidden();
    await page1.getByRole("combobox", {name: "To"}).click();
    await page1.getByRole("option", {name: "Roman Roy"}).click();
    await expect(page1.getByTestId("ChatAccountPickerInput").getByText("Roman Roy")).toBeVisible();

    await expect(page2.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeHidden();
    await page2.getByRole("combobox", {name: "To"}).click();
    await page2.getByRole("option", {name: "Logan Roy"}).click();
    await expect(page2.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeVisible();

    await expect(page1.getByText("message5")).toBeHidden();
    await expect(page1.getByText("message6")).toBeHidden();
    await expect(page2.getByText("message5")).toBeHidden();
    await expect(page2.getByText("message6")).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page1.getByRole("textbox", {name: "New message"}).fill("message5");
    await expect(page1.getByRole("textbox", {name: "New message"})).toHaveText("message5");
    await page1.getByRole("button", {name: "Send message"}).click();
    await expect(page1.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page1.getByText("message5")).toBeVisible();
    await expect(page1.getByText("message6")).toBeHidden();
    await expect(page2.getByText("message5")).toBeVisible();
    await expect(page2.getByText("message6")).toBeHidden();

    await expect(page2.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page2.getByRole("textbox", {name: "New message"}).fill("message6");
    await expect(page2.getByRole("textbox", {name: "New message"})).toHaveText("message6");
    await page2.getByRole("button", {name: "Send message"}).click();
    await expect(page2.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page1.getByText("message5")).toBeVisible();
    await expect(page1.getByText("message6")).toBeVisible();
    await expect(page2.getByText("message5")).toBeVisible();
    await expect(page2.getByText("message6")).toBeVisible();
});
