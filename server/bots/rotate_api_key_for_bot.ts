import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Atomically revoke an existing `ApiKey` and issue a replacement for the same bot
 * with the same scope and name. Returns the newly issued `ApiKey`.
 */
export async function rotateApiKeyForBot(
    context: ServerAuthenticatedActionContext,
    {botId, apiKey}: {botId: BotId; apiKey: ApiKey},
): Promise<ApiKey> {
    // This uses `getItemIfExists` to ensure we return the same error if the key
    // doesn't belong to the bot so it's not possible to tell the difference between a
    // key that exists but belongs to a different bot versus one that doesn't exist at
    // all.
    const apiKeyItem = await BotsTable.getItemIfExists(
        context,
        {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        },
        {consistency: "StrongWithinCache"},
    );

    if (!apiKeyItem || apiKeyItem.botId !== botId) {
        throw new NotFoundError("API key not found");
    }

    const newApiKey = generateApiKey();

    await DynamoTableSchema.executeTransaction(context, [
        BotsTable.transactionDeleteItemWithKey(
            {partitionType: "ApiKey", sortRangeType: "Attributes", apiKey},
            {condition: {botId}},
        ),
        BotsTable.transactionCreateItem({
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: newApiKey,
            botId: apiKeyItem.botId,
            spaceId: apiKeyItem.spaceId,
            space: apiKeyItem.space,
            createdTime: new Date(),
            name: apiKeyItem.name,
        }),
    ]);

    return newApiKey;
}
