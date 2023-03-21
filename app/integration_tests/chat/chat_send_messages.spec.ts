import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {getSharedChats} from "~/server/dynamo/chat_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {assert} from "~/shared/helpers/control/assert";

const context = createTestContext();
const server = createTestServer(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space, {name: "Logan Roy"});
const session2 = createTestSession(context, space, {name: "Siobahn Roy"});
const session3 = createTestSession(context, space, {name: "Kendall Roy"});

test("chat message stays when changing chat selection", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await page.getByRole("textbox", {name: "New message"}).type("This is some message content");

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "This is some message content",
    );
    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeVisible();
    await page.getByText("Siobahn Roy").click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "This is some message content",
    );
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeVisible();
    await page.getByText("Kendall Roy").click();
    await expect(page.getByRole("listbox", {name: "Suggestions"})).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "This is some message content",
    );
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await page.getByRole("combobox", {name: "To"}).press("Backspace");

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeVisible();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "This is some message content",
    );
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await page.getByRole("combobox", {name: "To"}).press("Backspace");

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "This is some message content",
    );
    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
});

test("send chat message to another account", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Siobahn");

    await expect(page.getByText("Kendall Roy")).toBeHidden();
    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall and Siobahn")).toBeHidden();

    await page.getByText("Siobahn Roy").click();

    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).type("Test message content 1");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "Test message content 1",
    );
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("Test message content 1")).toBeVisible();
});

test("can see chat message from recipient account", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Test message content 1")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Logan");
    await page.getByText("Logan Roy").click();

    await expect(page.getByText("Test message content 1")).toBeVisible();
});

test("can not see chat message from non-recipient account but can send a different message", async ({
    page,
    context: browserContext,
}) => {
    await server.signIn(browserContext, session3);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Logan");
    await page.getByText("Logan Roy").click();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).type("Test message content 2");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "Test message content 2",
    );
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("Test message content 2")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
});

test("send chat message to multiple accounts", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByText("Siobahn Roy")).toBeVisible();
    await expect(page.getByText("Kendall Roy")).toBeVisible();

    await page.getByRole("combobox", {name: "To"}).type("Kendall");

    await expect(page.getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByText("Kendall Roy")).toBeVisible();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Test message content 2")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Siobahn");

    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).type("Test message content 3");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "Test message content 3",
    );
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("Test message content 3")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
});

test("reloading the page will keep the chat selection", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Logan");
    await page.getByText("Logan Roy").click();

    await expect(page.getByText("Test message content 1")).toBeVisible();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.reload();

    await expect(page.getByText("Test message content 1")).toBeVisible();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Kendall");
    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeVisible();

    await page.reload();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeVisible();
});

test("can remove selected chat accounts", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Siobahn");
    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Test message content 1")).toBeVisible();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Kendall");
    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeVisible();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("Backspace");

    await expect(page.getByText("Test message content 1")).toBeVisible();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("Backspace");

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).type("Siobahn");
    await page.getByText("Siobahn Roy").click();

    await page.getByRole("combobox", {name: "To"}).type("Kendall");
    await page.getByText("Kendall Roy").click();

    await expect(page.getByText("Test message content 3")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeVisible();

    await page.keyboard.press("Backspace");

    await expect(page.getByText("Test message content 2")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.keyboard.press("Backspace");

    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();
});

test("includes recommended group chats for autocomplete", async ({
    page,
    context: browserContext,
}) => {
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

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

    await page.getByRole("combobox", {name: "To"}).type("Siobahn");

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

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.getByText("Siobahn Roy").click();

    await expect(page.getByText("Test message content 1")).toBeVisible();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

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

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeVisible();
});

test("can open chat directly by id", async ({page, context: browserContext}) => {
    const sharedChats1 = await getSharedChats(context.request(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });
    assert(
        sharedChats1[0] &&
            sharedChats1[0].accountCount === 2 &&
            sharedChats1[0].includedOtherAccountIds.length === 1,
    );

    const sharedChats2 = await getSharedChats(context.request(session1), {
        spaceId: space.id,
        otherAccountIds: [session3.accountId],
    });
    assert(
        sharedChats2[0] &&
            sharedChats2[0].accountCount === 2 &&
            sharedChats2[0].includedOtherAccountIds.length === 1,
    );

    const sharedChats3 = await getSharedChats(context.request(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId, session3.accountId],
    });
    assert(
        sharedChats3[0] &&
            sharedChats3[0].accountCount === 3 &&
            sharedChats3[0].includedOtherAccountIds.length === 2,
    );

    const chatId1 = sharedChats1[0].id;
    const chatId2 = sharedChats2[0].id;
    const chatId3 = sharedChats3[0].id;

    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/${chatId1}`);

    await expect(page.getByRole("heading", {name: "Siobahn", exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Kendall", exact: true})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeHidden();

    await expect(page.getByText("Test message content 1")).toBeVisible();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId2}`);

    await expect(page.getByRole("heading", {name: "Kendall", exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Siobahn", exact: true})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeHidden();

    await expect(page.getByText("Test message content 2")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId3}`);

    await expect(page.getByRole("heading", {name: "Kendall and Siobahn"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Siobahn", exact: true})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Kendall", exact: true})).toBeHidden();

    await expect(page.getByText("Test message content 3")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
});

test("can send self a message", async ({page, context: browserContext}) => {
    await server.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/new`);

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();
    await expect(page.getByText("Test message content 4")).toBeHidden();

    await page.getByRole("combobox", {name: "To"}).click();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();
    await expect(page.getByText("Test message content 4")).toBeHidden();

    await page.getByText("Logan Roy").click();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();

    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();
    await expect(page.getByText("Test message content 4")).toBeHidden();

    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");
    await page.getByRole("textbox", {name: "New message"}).type("Test message content 4");
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText(
        "Test message content 4",
    );
    await page.getByRole("button", {name: "Send message"}).click();
    await expect(page.getByRole("textbox", {name: "New message"})).toHaveText("");

    await expect(page.getByText("Test message content 4")).toBeVisible();
    await expect(page.getByText("Test message content 1")).toBeHidden();
    await expect(page.getByText("Test message content 2")).toBeHidden();
    await expect(page.getByText("Test message content 3")).toBeHidden();

    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Logan Roy")).toBeVisible();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Siobahn Roy")).toBeHidden();
    await expect(page.getByTestId("ChatAccountPickerInput").getByText("Kendall Roy")).toBeHidden();
});
