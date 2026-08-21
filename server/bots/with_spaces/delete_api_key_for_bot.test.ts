import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/with_spaces/create_unscoped_api_key_for_bot.js";
import {deleteApiKeyForBotIfExists} from "~/server/bots/with_spaces/delete_api_key_for_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {maxApiKeyCountPerBot} from "~/shared/bots/max_api_key_count_per_bot.js";
import {ApiKey} from "~/shared/id/api_key.js";

const context = createTestContext();

describe("deleteApiKeyForBotIfExists()", () => {
    test("deletes the API key", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteApiKeyForBotIfExists(session.action(), {botId: bot.id, apiKey});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).toBeNull();
    });

    test("idempotently deletes the API key", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteApiKeyForBotIfExists(session.action(), {botId: bot.id, apiKey});

        await expect(
            deleteApiKeyForBotIfExists(session.action(), {botId: bot.id, apiKey}),
        ).resolves.toBeUndefined();
    });

    test("does not delete a key that belongs to a different bot", async () => {
        const bot = await TestBot.create(context);
        const otherBot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await expect(
            deleteApiKeyForBotIfExists(session.action(), {botId: otherBot.id, apiKey}),
        ).resolves.toBeUndefined();

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).not.toBeNull();
    });

    test("uncounts the key on the bot", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteApiKeyForBotIfExists(session.action(), {botId: bot.id, apiKey});

        await expect(bot.getItem()).resolves.toMatchObject({apiKeyCount: 0});
    });

    test("frees up a slot for a bot at the API key limit", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const apiKeys: Array<ApiKey> = [];
        for (let index = 0; index < maxApiKeyCountPerBot; index++) {
            apiKeys.push(
                await createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null}),
            );
        }

        await deleteApiKeyForBotIfExists(session.action(), {botId: bot.id, apiKey: apiKeys[0]!});

        await expect(
            createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null}),
        ).resolves.toEqual(expect.any(String));
    });

    test("does not uncount a key that belongs to a different bot", async () => {
        const bot = await TestBot.create(context);
        const otherBot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteApiKeyForBotIfExists(session.action(), {botId: otherBot.id, apiKey});

        await expect(bot.getItem()).resolves.toMatchObject({apiKeyCount: 1});
        await expect(otherBot.getItem()).resolves.toMatchObject({apiKeyCount: 0});
    });

    test("does not delete actual key when given an invalid key", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await expect(
            deleteApiKeyForBotIfExists(session.action(), {
                botId: bot.id,
                apiKey: "not-a-real-key" as ApiKey,
            }),
        ).resolves.toBeUndefined();

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).not.toBeNull();
    });
});
