import {createUnscopedApiKeyForTest} from "~/server/bots/create_api_key_for_test.js";
import {getSystemBotsForAdminSettingsPage} from "~/server/bots/get_system_bots_for_admin_settings_page.js";
import {deleteBotIfExistsWithoutAuthorization} from "~/server/bots/internal/delete_bot_if_exists_without_authorization.js";
import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const context = createTestContext();

let scenario: Awaited<ReturnType<typeof createScenario>>;

beforeAll(async () => {
    scenario = await createScenario();
});

/**
 * One bot for each kind of owner, plus a soft-deleted system bot. Every test only
 * reads so they can all share a single scenario.
 */
async function createScenario() {
    const space = await TestSpace.create(context);

    const [internalSession, session] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
    ]);

    const [systemBot, accountBot, spaceBot, deletedSystemBot] = await runAllPromises([
        createBotForTest(context, {
            name: "System Bot",
            description: "A bot Alpine manages",
            webhook: {url: "https://example.com/webhook", secret: "webhook-secret"},
            ownerEntity: {type: "System"},
        }),
        createBotForTest(context, {
            name: "Account Bot",
            webhook: null,
            ownerEntity: {type: "Account", accountId: session.account.id},
        }),
        createBotForTest(context, {
            name: "Space Bot",
            webhook: null,
            ownerEntity: {type: "Space", spaceId: space.id},
        }),
        createBotForTest(context, {
            name: "Deleted System Bot",
            webhook: null,
            ownerEntity: {type: "System"},
        }),
    ]);

    const apiKey = await createUnscopedApiKeyForTest(context, systemBot.id);

    await deleteBotIfExistsWithoutAuthorization(internalSession.action(), {
        botId: deletedSystemBot.id,
    });

    return {
        internalSession,
        session,
        apiKey,
        systemBotId: systemBot.id,
        accountBotId: accountBot.id,
        spaceBotId: spaceBot.id,
        deletedSystemBotId: deletedSystemBot.id,
    };
}

describe("getSystemBotsForAdminSettingsPage()", () => {
    test("throws for an account without internal access", async () => {
        await expect(getSystemBotsForAdminSettingsPage(scenario.session.action())).rejects.toThrow(
            "Account does not have internal access",
        );
    });

    test("includes bots owned by the system", async () => {
        const bots = await getSystemBotsForAdminSettingsPage(scenario.internalSession.action());

        expect(bots.map(bot => bot.id)).toContain(scenario.systemBotId);
    });

    test("excludes bots owned by an account", async () => {
        const bots = await getSystemBotsForAdminSettingsPage(scenario.internalSession.action());

        expect(bots.map(bot => bot.id)).not.toContain(scenario.accountBotId);
    });

    test("excludes bots owned by a space", async () => {
        const bots = await getSystemBotsForAdminSettingsPage(scenario.internalSession.action());

        expect(bots.map(bot => bot.id)).not.toContain(scenario.spaceBotId);
    });

    test("excludes deleted system bots", async () => {
        const bots = await getSystemBotsForAdminSettingsPage(scenario.internalSession.action());

        expect(bots.map(bot => bot.id)).not.toContain(scenario.deletedSystemBotId);
    });

    test("returns the secrets for a system bot", async () => {
        const bots = await getSystemBotsForAdminSettingsPage(scenario.internalSession.action());

        const bot = assertExists(bots.find(bot => bot.id === scenario.systemBotId));
        expect(bot).toMatchObject({
            name: "System Bot",
            description: "A bot Alpine manages",
            webhook: {url: "https://example.com/webhook", secret: "webhook-secret"},
            apiKeys: [{apiKey: scenario.apiKey, name: null, spaceId: null, scope: null}],
        });
    });
});
