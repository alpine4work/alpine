import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Create an unscoped API key for a bot.
 */
export async function createUnscopedApiKeyForTest(
    context: DynamoContext,
    botId: BotId,
    apiKey: ApiKey = generateApiKey(),
): Promise<ApiKey> {
    assert(process.env.NODE_ENV === "test");

    await BotsTable.createItem(context, {
        partitionType: "ApiKey",
        sortRangeType: "Attributes",
        apiKey,
        botId,
        spaceId: null,
        space: null,
        createdTime: new Date(),
        name: null,
    });

    await incrementBotApiKeyCountForTest(context, botId);

    return apiKey;
}

/**
 * Create a scoped API key for a bot. We assume the caller has validated that the
 * space and account is an instantiation of the `BotId` and that the `scope` is a
 * valid entity in the space.
 */
export async function createScopedApiKeyForTest(
    context: DynamoContext,
    botId: BotId,
    {
        spaceId,
        accountId,
        scope,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        scope: BotTokenScope;
    },
): Promise<ApiKey> {
    assert(process.env.NODE_ENV === "test");

    const apiKey = generateApiKey();

    await BotsTable.createItem(context, {
        partitionType: "ApiKey",
        sortRangeType: "Attributes",
        apiKey,
        botId,
        spaceId,
        space: {accountId, scope},
        createdTime: new Date(),
        name: null,
    });

    await incrementBotApiKeyCountForTest(context, botId);

    return apiKey;
}

/**
 * These helpers write the key item directly instead of going through
 * `getBotApiKeyWriteLockTransactionEntry()`, which is deliberate: tests use them
 * to plant keys on bots the real creation path would refuse, like one that's
 * already deleted. Keep the bot's `apiKeyCount` in step by hand so a test that
 * mixes these helpers with the real path still sees an accurate count.
 */
async function incrementBotApiKeyCountForTest(context: DynamoContext, botId: BotId): Promise<void> {
    await BotsTable.updateItem(
        context,
        {partitionType: "Bot", sortRangeType: "Attributes", botId},
        item => (item ? {...item, apiKeyCount: item.apiKeyCount + 1} : item),
    );
}
