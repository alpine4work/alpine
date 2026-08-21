import {BotApiKeysIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function getBotScopedApiKeys(
    context: ServerAuthenticatedActionContext,
    {botId, spaceId}: {botId: BotId; spaceId: SpaceId},
): Promise<
    Array<{
        readonly name: string | null;
        readonly createdTime: Date;
        readonly scope: BotTokenScope;
        readonly apiKey: ApiKey;
    }>
> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    const apiKeyKeys = BotApiKeysIndex.query(context, {
        partitionKey: {botId},
        startSortKey: {spaceId},
        endSortKey: {spaceId},
        limit: "All",
    });

    const apiKeys = await parallelMapAsyncIterableToArray(apiKeyKeys, async apiKeyKey => {
        const apiKeyItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: apiKeyKey.apiKey,
        });

        if (!apiKeyItem) return null;

        // The item decides which space a key is scoped to, not the index entry that led us
        // here. `BotApiKeysIndex` is a GSI, so its sort key can lag a re-scope.
        const {space} = apiKeyItem;
        if (space === null || apiKeyItem.spaceId !== spaceId) return null;

        return {
            name: apiKeyItem.name,
            createdTime: apiKeyItem.createdTime,
            scope: space.scope,
            apiKey: apiKeyItem.apiKey,
        };
    });

    // A key may have been revoked between reading the index and reading the item, so
    // skip keys without an item.
    return apiKeys.filter(apiKey => apiKey !== null);
}
