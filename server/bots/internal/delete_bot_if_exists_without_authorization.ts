import {BotApiKeysIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {BotItemAuthorizationCache} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {isBotItemDeleted} from "~/server/bots/internal/is_bot_item_deleted.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Pauses bot deletion after it has read the bot and its API keys but before it
 * commits, so tests can exercise writes racing with a deletion.
 */
export const deleteBotBeforeExecuteTransactionTestCheckpoint = new TestCheckpoint<BotId>();

/**
 * Soft-delete a bot, clear its webhook, and permanently delete its API keys and
 * settings schema. The bot's attributes and avatar are retained.
 *
 * Dangerous because it doesn't check that the actor may manage the bot. Callers
 * must authorize first (see `authorizeBotOwnerAccess()`).
 */
export async function deleteBotIfExistsWithoutAuthorization(
    context: ServerActionContext,
    {botId}: {botId: BotId},
): Promise<void> {
    const deletionTime = new Date();

    // Recorded on the bot so we know who deleted it, the same way documents record
    // their deletor. A `System` actor (e.g. a maintenance job) has no account, which
    // reads back as a null `id`.
    const deletor = {
        id: context.actor.getPossiblyBotAccountIdIfExists(),
        from:
            context.actor.type === "Bot"
                ? ({type: "Bot", accountId: context.actor.getBotAccountId()} as const)
                : null,
    };

    await context.dynamo.retryTransaction(async context => {
        const botItem = await BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId,
        });

        // Collect all API key items for this bot so we can delete them in the transaction.
        // This GSI is eventually consistent, so API authentication also checks that the
        // bot is active in case a recently created key is absent from this query.
        const apiKeyTransactionEntries: Array<DynamoTransactionEntry> = [];
        for await (const item of BotApiKeysIndex.query(context, {
            partitionKey: {botId},
            limit: "All",
        })) {
            apiKeyTransactionEntries.push(
                BotsTable.transactionDeleteItemIfExists({
                    partitionType: "ApiKey",
                    sortRangeType: "Attributes",
                    apiKey: item.apiKey,
                }),
            );
        }

        // The bot is already deleted and no keys are left, so there's nothing to do. The
        // settings schema was deleted in the same transaction that deleted the bot.
        const isAlreadyDeleted = botItem !== null && isBotItemDeleted(botItem);
        if (isAlreadyDeleted && apiKeyTransactionEntries.length === 0) return;

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        if (botItem) {
            transactionEntries.push(
                isAlreadyDeleted
                    ? // There's nothing left to write to an already deleted bot other than the key
                      // count, but writing that also bumps its lock version so deleting the keys we
                      // found is serialized with any concurrent write adding a key (see
                      // `getBotApiKeyWriteLockTransactionEntry()`).
                      BotsTable.transactionDirectlyUpdateItemAttribute(
                          {partitionType: "Bot", sortRangeType: "Attributes", botId},
                          "apiKeyCount",
                          0,
                          {updateLockVersion: botItem.updateLockVersion},
                      )
                    : BotsTable.transactionDirectlyUpdateItem({
                          ...botItem,
                          deleted: {time: deletionTime, deletor},
                          // Kept in sync with `deleted` for the `BotsByOwner` index filter.
                          isDeleted: deletionTime,
                          webhook: null,
                          // This transaction deletes every key we found, and a deleted bot can't be given
                          // new ones.
                          apiKeyCount: 0,
                      }),
            );
        }

        transactionEntries.push(
            BotsTable.transactionDeleteItemIfExists({
                partitionType: "Bot",
                sortRangeType: "SettingsSchema",
                botId,
            }),
            ...apiKeyTransactionEntries,
        );

        await deleteBotBeforeExecuteTransactionTestCheckpoint.waitForTest(botId);

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    });

    // Prevent an item loaded earlier in this action from making the deleted bot appear
    // active.
    BotItemAuthorizationCache.set(context, "Strong", botId, null);
}
