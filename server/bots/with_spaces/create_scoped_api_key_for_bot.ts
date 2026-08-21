import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {getBotApiKeyWriteLockTransactionEntry} from "~/server/bots/internal/get_bot_api_key_write_lock_transaction_entry.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function createScopedApiKeyForBot(
    context: ServerAuthenticatedActionContext,
    {
        botId,
        spaceId,
        name,
        scope,
    }: {
        botId: BotId;
        spaceId: SpaceId;
        name: string | null;
        scope: BotTokenScope;
    },
): Promise<{apiKey: ApiKey; scope: BotTokenScope}> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    const botAccountId = await getBotAccountIdForSpaceIfExists(context, botId, spaceId);
    if (botAccountId === null) {
        throw new InvalidArgumentError("Bot has not been installed in the space");
    }

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
                spaceId,
                space: {
                    accountId: botAccountId,
                    scope,
                },
                createdTime: new Date(),
                name,
            }),
        ]);
    });

    return {apiKey, scope};
}
