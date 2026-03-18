import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotApiKeysIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {BotId} from "~/shared/id/types/id_types.js";

export async function deleteBot(
    context: ServerActionContext,
    {botId}: {botId: BotId},
): Promise<void> {
    await authorizeInternalAccess(context);

    // Collect all API key items for this bot so we can delete them in the transaction.
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

    // Fetch the optional per-bot items so we only include them in the transaction if
    // they exist.
    const [avatarItem, settingsSchemaItem] = await Promise.all([
        BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId,
        }),
        BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "SettingsSchema",
            botId,
        }),
    ]);

    await DynamoTableSchema.executeTransaction(context, [
        BotsTable.transactionDeleteItemWithKey({
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId,
        }),
        ...(avatarItem ? [BotsTable.transactionDeleteItem(avatarItem)] : []),
        ...(settingsSchemaItem ? [BotsTable.transactionDeleteItem(settingsSchemaItem)] : []),
        ...apiKeyTransactionEntries,
    ]);
}
