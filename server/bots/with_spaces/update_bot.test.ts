import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {getBotItemForTest} from "~/server/bots/test_helpers/get_bot_item_for_test.js";
import {updateBot} from "~/server/bots/with_spaces/update_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

const botName = "Test Bot";
const webhookUrl = "https://bot.test.cyberworlds.dev/webhook";

async function createBotWithSecret(session: TestSession, secret: string | null): Promise<BotId> {
    const {id} = await createBotForTest(context, {
        name: botName,
        webhook: {url: webhookUrl, secret},
        ownerEntity: {type: "Account", accountId: session.account.id},
    });
    return id;
}

describe("updateBot() signing secret", () => {
    test("leaves the secret untouched when it is omitted", async () => {
        const session = await (await TestSpace.create(context)).createSession();
        const botId = await createBotWithSecret(session, "original-secret");

        // Update an unrelated field without passing `webhook.secret`.
        await updateBot(session.action(), {
            botId,
            name: botName,
            description: "Updated description",
            webhook: {url: webhookUrl},
        });

        const item = await getBotItemForTest(session.action(), botId);
        expect(item.webhook?.secret).toBe("original-secret");
    });

    test("clears the secret when it is set to null", async () => {
        const session = await (await TestSpace.create(context)).createSession();
        const botId = await createBotWithSecret(session, "original-secret");

        await updateBot(session.action(), {
            botId,
            name: botName,
            description: null,
            webhook: {url: webhookUrl, secret: null},
        });

        const item = await getBotItemForTest(session.action(), botId);
        expect(item.webhook?.secret).toBeNull();
    });

    test("replaces the secret when given a new value", async () => {
        const session = await (await TestSpace.create(context)).createSession();
        const botId = await createBotWithSecret(session, "original-secret");

        await updateBot(session.action(), {
            botId,
            name: botName,
            description: null,
            webhook: {url: webhookUrl, secret: "replacement-secret"},
        });

        const item = await getBotItemForTest(session.action(), botId);
        expect(item.webhook?.secret).toBe("replacement-secret");
    });
});
