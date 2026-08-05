import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.js";

/**
 * Permanently delete an `ApiKey` belonging to a bot. After this any integration
 * using the `ApiKey` immediately loses access.
 *
 * The caller must provide the `BotId` the key belongs to and we only delete the
 * key if it actually belongs to that bot.
 */
export async function deleteApiKeyForBotIfExists(
    context: ServerAuthenticatedActionContext,
    {botId, apiKey}: {botId: BotId; apiKey: ApiKey},
): Promise<void> {
    const apiKeyItem = await BotsTable.getItemIfExists(
        context,
        {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        },
        {consistency: "StrongWithinCache"},
    );

    // If the key doesn't exist or doesn't belong to the bot, we just return to ensure
    // idempotency and to prevent the caller from knowing whether the key exists but
    // belongs to a different bot or if it doesn't exist at all.
    if (!apiKeyItem || apiKeyItem.botId !== botId) return;

    // Delete conditional on the key still belonging to the bot so we fail closed if it
    // was concurrently rotated or deleted between our read and this write.
    await BotsTable.deleteItemWithKey(
        context,
        {partitionType: "ApiKey", sortRangeType: "Attributes", apiKey},
        {condition: {botId}},
    );
}
