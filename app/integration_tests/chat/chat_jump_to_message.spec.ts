import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getOrCreateChatForAccounts, sendChatMessage} from "~/server/dynamo/chat_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

const context = createTestContext();
const services = createTestServices(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

test("can jump to message in chat", async ({context: browserContext, page}) => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    for (let i = 0; i < 300; i++) {
        await sendChatMessage(context.action(session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent(`Message ${i}`),
        });
    }

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/${chatId}`);

    await expect(page.getByText("Message 299", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 279", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId}?message=0`);

    await expect(page.getByText("Message 0", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 5", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 279", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 299", {exact: true})).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId}?message=5`);

    await expect(page.getByText("Message 0", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 5", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 279", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 299", {exact: true})).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId}?message=149`);

    await expect(page.getByText("Message 149", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 279", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 299", {exact: true})).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId}?message=299`);

    await expect(page.getByText("Message 279", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 299", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();

    await page.goto(`/s/${space.id}/chat/${chatId}?message=279`);

    await expect(page.getByText("Message 279", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 299", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();
});
