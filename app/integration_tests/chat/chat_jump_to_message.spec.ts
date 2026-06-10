import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can jump to message in chat", async ({context: browserContext, page}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);

    for (let i = 0; i < 300; i++) {
        await chat.sendMessage(session1, `Message ${i}`);
    }

    await services.signIn(browserContext, session1);
    await page.goto(`/chat/${chat.id}`);

    await expect(page.getByText("Message 299", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 279", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();

    await page.goto(`/chat/${chat.id}?message=0`);

    await expect(page.getByText("Message 0", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 5", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 279", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 299", {exact: true})).toBeHidden();

    await page.goto(`/chat/${chat.id}?message=5`);

    await expect(page.getByText("Message 0", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 5", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 279", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 299", {exact: true})).toBeHidden();

    await page.goto(`/chat/${chat.id}?message=149`);

    await expect(page.getByText("Message 149", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 279", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 299", {exact: true})).toBeHidden();

    await page.goto(`/chat/${chat.id}?message=299`);

    await expect(page.getByText("Message 279", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 299", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();

    await page.goto(`/chat/${chat.id}?message=279`);

    await expect(page.getByText("Message 279", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 299", {exact: true})).toBeVisible();
    await expect(page.getByText("Message 149", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 0", {exact: true})).toBeHidden();
    await expect(page.getByText("Message 5", {exact: true})).toBeHidden();
});
