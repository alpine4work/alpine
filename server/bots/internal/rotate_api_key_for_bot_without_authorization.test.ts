import {createScopedApiKeyForTest} from "~/server/bots/create_api_key_for_test.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {rotateApiKeyForBotWithoutAuthorization} from "~/server/bots/internal/rotate_api_key_for_bot_without_authorization.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/with_spaces/create_unscoped_api_key_for_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

describe("rotateApiKeyForBotWithoutAuthorization()", () => {
    test("revokes the previous key", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await rotateApiKeyForBotWithoutAuthorization(session.action(), {botId: bot.id, apiKey});

        const oldItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(oldItem).toBeNull();
    });

    test("leaves the bot\u2019s API key count alone", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await rotateApiKeyForBotWithoutAuthorization(session.action(), {botId: bot.id, apiKey});

        await expect(bot.getItem()).resolves.toMatchObject({apiKeyCount: 1});
    });

    test("issues a replacement for the same bot with the same scope", async () => {
        const bot = await TestBot.create(context);
        const spaceId = generateId<SpaceId>();
        const accountId = generateId<AccountId>();
        const apiKey = await createScopedApiKeyForTest(context, bot.id, {
            spaceId,
            accountId,
            scope: {type: "Space"},
        });
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const newApiKey = await rotateApiKeyForBotWithoutAuthorization(session.action(), {
            botId: bot.id,
            apiKey,
        });

        const newItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: newApiKey,
        });
        expect(newItem).toMatchObject({
            botId: bot.id,
            spaceId,
            space: {accountId, scope: {type: "Space"}},
        });
    });

    test("issues a replacement that keeps the previous key\u2019s name", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});
        const apiKey = await createUnscopedApiKeyForBot(session.action(), {
            botId: bot.id,
            name: "Production key",
        });

        const newApiKey = await rotateApiKeyForBotWithoutAuthorization(session.action(), {
            botId: bot.id,
            apiKey,
        });

        const newItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: newApiKey,
        });
        expect(newItem).toMatchObject({name: "Production key"});
    });

    test("does not rotate a key that belongs to a different bot", async () => {
        const bot = await TestBot.create(context);
        const otherBot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await expect(
            rotateApiKeyForBotWithoutAuthorization(session.action(), {botId: otherBot.id, apiKey}),
        ).rejects.toThrow(new NotFoundError("API key not found"));

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).not.toBeNull();
    });

    test("does not rotate actual key if given an invalid key", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await expect(
            rotateApiKeyForBotWithoutAuthorization(session.action(), {
                botId: bot.id,
                apiKey: "not-a-valid-key" as ApiKey,
            }),
        ).rejects.toThrow(new NotFoundError("API key not found"));

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).not.toBeNull();
    });

    test("throws the same error for a non-existent key and a key that belongs to a different bot", async () => {
        const bot = await TestBot.create(context);
        const otherBot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const expectedError = new NotFoundError("API key not found");

        await expect(
            rotateApiKeyForBotWithoutAuthorization(session.action(), {
                botId: bot.id,
                apiKey: "not-a-valid-key" as ApiKey,
            }),
        ).rejects.toThrow(expectedError);

        await expect(
            rotateApiKeyForBotWithoutAuthorization(session.action(), {botId: otherBot.id, apiKey}),
        ).rejects.toThrow(expectedError);
    });
});
