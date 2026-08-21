import {BotApiKeysIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

export async function getBotUnscopedApiKeys(
    context: ServerAuthenticatedActionContext,
    {botId}: {botId: BotId},
): Promise<
    Array<{
        readonly name: string | null;
        readonly createdTime: Date;
        readonly apiKey: ApiKey;
    }>
> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    const apiKeyKeys = BotApiKeysIndex.query(context, {
        partitionKey: {botId},
        startSortKey: {spaceId: null},
        endSortKey: {spaceId: null},
        limit: "All",
    });

    const apiKeys = await parallelMapAsyncIterableToArray(apiKeyKeys, async apiKeyKey => {
        const apiKeyItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: apiKeyKey.apiKey,
        });

        if (!apiKeyItem) return null;

        // Unscoped keys should not have a space
        assert(apiKeyItem.space === null);

        return {
            name: apiKeyItem.name,
            createdTime: apiKeyItem.createdTime,
            apiKey: apiKeyItem.apiKey,
        };
    });

    // A key may have been revoked between reading the index and reading the item, so
    // skip keys without an item.
    return apiKeys.filter(apiKey => apiKey !== null);
}
