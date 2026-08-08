import {createScopedApiKeyForTest} from "~/server/bots/create_api_key_for_test.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/create_unscoped_api_key_for_bot.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {rotateApiKeyForBot} from "~/server/bots/rotate_api_key_for_bot.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

describe("rotateApiKeyForBot()", () => {
    test("revokes the previous key", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await rotateApiKeyForBot(session.action(), {botId: bot.id, apiKey});

        const oldItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(oldItem).toBeNull();
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

        const newApiKey = await rotateApiKeyForBot(session.action(), {botId: bot.id, apiKey});

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

        const newApiKey = await rotateApiKeyForBot(session.action(), {botId: bot.id, apiKey});

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
            rotateApiKeyForBot(session.action(), {botId: otherBot.id, apiKey}),
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
            rotateApiKeyForBot(session.action(), {
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
            rotateApiKeyForBot(session.action(), {
                botId: bot.id,
                apiKey: "not-a-valid-key" as ApiKey,
            }),
        ).rejects.toThrow(expectedError);

        await expect(
            rotateApiKeyForBot(session.action(), {botId: otherBot.id, apiKey}),
        ).rejects.toThrow(expectedError);
    });
});
