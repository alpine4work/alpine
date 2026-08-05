import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotApiKeysIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {BotId} from "~/shared/id/types/id_types.js";

/**
 * Permanently delete a bot and all its associated data (API keys, avatar, settings
 * schema) if it exists.
 */
export async function deleteBotIfExists(
    context: ServerActionContext,
    {botId}: {botId: BotId},
): Promise<void> {
    await authorizeInternalAccess(context);

    // Collect all API key items for this bot so we can delete them in the transaction.
    // Note however that this reads from a GSI which is eventually consistent, so it is
    // possible that we'd miss an API key if it was created within the eventual
    // consistency window.
    const apiKeyTransactionEntries: Array<DynamoTransactionEntry> = [];
    for await (const item of BotApiKeysIndex.query(context, {
        partitionKey: {botId},
        limit: "All",
    })) {
        apiKeyTransactionEntries.push(
            BotsTable.transactionDeleteItemWithKey({
                partitionType: "ApiKey",
                sortRangeType: "Attributes",
                apiKey: item.apiKey,
            }),
        );
    }

    await DynamoTableSchema.executeTransaction(context, [
        BotsTable.transactionDeleteItemIfExists({
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId,
        }),
        BotsTable.transactionDeleteItemIfExists({
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId,
        }),
        BotsTable.transactionDeleteItemIfExists({
            partitionType: "Bot",
            sortRangeType: "SettingsSchema",
            botId,
        }),
        ...apiKeyTransactionEntries,
    ]);
}
