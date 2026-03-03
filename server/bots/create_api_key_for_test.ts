import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create an unscoped API key for a bot.
 */
export async function createUnscopedApiKeyForTest(
    context: DynamoContext,
    botId: BotId,
): Promise<ApiKey> {
    assert(import.meta.jest);

    const apiKey = generateApiKey();

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
        scope: BotTokenPayloadScope;
    },
): Promise<ApiKey> {
    assert(import.meta.jest);

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

    return apiKey;
}
