import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/with_spaces/create_unscoped_api_key_for_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {maxApiKeyCountPerBot} from "~/shared/bots/max_api_key_count_per_bot.js";

const context = createTestContext();

describe("createUnscopedApiKeyForBot()", () => {
    test("creates a key for the bot", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const apiKey = await createUnscopedApiKeyForBot(session.action(), {
            botId: bot.id,
            name: "Production key",
        });

        expect(apiKey).toEqual(expect.any(String));
    });

    test("counts the key on the bot", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null});
        await createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null});

        await expect(bot.getItem()).resolves.toMatchObject({apiKeyCount: 2});
    });

    test("throws once the bot is at the API key limit", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        for (let index = 0; index < maxApiKeyCountPerBot; index++) {
            await createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null});
        }

        await expect(
            createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null}),
        ).rejects.toThrow(`Bot already has ${maxApiKeyCountPerBot} API keys`);
    });

    test("enforces the limit from the bot\u2019s count instead of the API key index", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        // The bot has no key items at all, so counting `BotApiKeysIndex` would let this
        // through. The count on the bot is the source of truth because the index is
        // eventually consistent and can miss a key that was just written.
        await BotsTable.updateItem(
            context,
            {partitionType: "Bot", sortRangeType: "Attributes", botId: bot.id},
            item => (item ? {...item, apiKeyCount: maxApiKeyCountPerBot} : item),
        );

        await expect(
            createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null}),
        ).rejects.toThrow(`Bot already has ${maxApiKeyCountPerBot} API keys`);
    });
});
