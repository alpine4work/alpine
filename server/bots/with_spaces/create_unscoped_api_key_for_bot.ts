import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {getBotApiKeyWriteLockTransactionEntry} from "~/server/bots/internal/get_bot_api_key_write_lock_transaction_entry.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

export async function createUnscopedApiKeyForBot(
    context: ServerAuthenticatedActionContext,
    {botId, name}: {botId: BotId; name: string | null},
): Promise<ApiKey> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    const apiKey = generateApiKey();

    await context.dynamo.retryTransaction(async context => {
        await DynamoTableSchema.executeTransaction(context, [
            // Enforces `maxApiKeyCountPerBot`, records the bot's new key count, and bumps the
            // Bot `Attributes` item's lock version so creating a key is correctly serialized
            // with bot deletion.
            await getBotApiKeyWriteLockTransactionEntry(context, botId, "Create"),
            BotsTable.transactionCreateItem({
                partitionType: "ApiKey",
                sortRangeType: "Attributes",
                apiKey,
                botId,
                spaceId: null,
                space: null,
                createdTime: new Date(),
                name,
            }),
        ]);
    });

    return apiKey;
}
