import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";

const {context, services} = createTestServices();

async function expectPath(page: {url: () => string}, expectedPath: string) {
    await expect
        .poll(() => {
            const url = new URL(page.url());
            return url.pathname + url.search + url.hash;
        })
        .toBe(expectedPath);
}

function encodeLegacyInboxSelectedPath(path: string) {
    const textEncoder = new TextEncoder();
    return encodeBase64(textEncoder.encode(path), "Rfc4648Url");
}

test("redirects legacy space index to home", async ({page, context: browserContext}) => {
    const spaceName = "Legacy Redirect Home";
    const space = await TestSpace.create(context, {name: spaceName});
    const session = await space.createSession();
    await services.signIn(browserContext, session);

    await page.goto(`/s/${space.id}`);

    await expectPath(page, `/home/${space.id}`);
    await page.getByLabel("Space").click();
    await expect(page.getByRole("menu").getByText(spaceName, {exact: true})).toBeVisible();
});

test("redirects legacy task paths to my tasks", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    await services.signIn(browserContext, session);

    await page.goto(`/s/${space.id}/tasks#list`);

    await expectPath(page, `/my-tasks/${space.id}#list`);
    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
});

test("redirects legacy settings paths to people settings", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Legacy Redirect Owner", role: "Owner"});
    await services.signIn(browserContext, session);

    await page.goto(`/s/${space.id}/settings/people`);

    await expectPath(page, `/settings/${space.id}/people`);
    await expect(page.getByText("Members", {exact: true})).toBeVisible();
    await expect(page.getByText("Legacy Redirect Owner", {exact: true})).toBeVisible();
});

test("redirects legacy inbox paths with selected chat", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Legacy Redirect Recipient"});
    const session2 = await space.createSession({name: "Legacy Redirect Sender"});
    const chat = await TestChat.get(session1, session2);
    await chat.sendMessage(session2, "legacy selected chat message");
    await ProcessContextModule.waitForTestTasks();
    await context.waitForSqsProcessJobs();

    await services.signIn(browserContext, session1);

    const selectedParam = encodeLegacyInboxSelectedPath(`chat/${chat.id}`);
    await page.goto(`/s/${space.id}/inbox?selected=${selectedParam}`);

    await expectPath(page, `/inbox/${space.id}?selected=${selectedParam}`);
    await expect(
        page.getByTestId(`MessageView:${chat.id}:0`).getByText("legacy selected chat message"),
    ).toBeVisible();
});
