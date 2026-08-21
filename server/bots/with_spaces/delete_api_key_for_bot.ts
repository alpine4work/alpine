import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {getBotApiKeyWriteLockTransactionEntry} from "~/server/bots/internal/get_bot_api_key_write_lock_transaction_entry.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

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
    await authorizeBotOperation(context, botId, {type: "Manage"});

    await context.dynamo.retryTransaction(async context => {
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

        await DynamoTableSchema.executeTransaction(context, [
            // Frees up the bot's slot under `maxApiKeyCountPerBot`. Written in the same
            // transaction as the deletion so the count can't drift from the keys that exist.
            await getBotApiKeyWriteLockTransactionEntry(context, botId, "Delete"),
            // Delete conditional on the key still belonging to the bot so we fail closed if it
            // was concurrently rotated or deleted between our read and this write.
            BotsTable.transactionDeleteItemWithKey(
                {partitionType: "ApiKey", sortRangeType: "Attributes", apiKey},
                {condition: {botId}},
            ),
        ]);
    });
}
