import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {getBotSettingsForManagement} from "~/server/bots/with_spaces/get_bot_settings_for_management.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

const webhookUrl = "https://bot.test.cyberworlds.dev/webhook";
const webhookSecret = "super-secret-signing-value";

describe("getCustomBotSettings()", () => {
    test("returns the signing secret", async () => {
        const session = await (await TestSpace.create(context)).createSession();
        const {id: botId} = await createBotForTest(context, {
            name: "Test Bot",
            webhook: {url: webhookUrl, secret: webhookSecret},
            ownerEntity: {type: "Account", accountId: session.account.id},
        });

        await expect(getBotSettingsForManagement(session.action(), botId)).resolves.toMatchObject({
            webhookUrl,
            webhookSecret,
        });
    });

    test("returns null when no signing secret is set", async () => {
        const session = await (await TestSpace.create(context)).createSession();
        const {id: botId} = await createBotForTest(context, {
            name: "Test Bot",
            webhook: {url: webhookUrl, secret: null},
            ownerEntity: {type: "Account", accountId: session.account.id},
        });

        await expect(getBotSettingsForManagement(session.action(), botId)).resolves.toMatchObject({
            webhookSecret: null,
        });
    });
});
