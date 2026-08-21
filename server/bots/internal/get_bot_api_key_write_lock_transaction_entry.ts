import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {isBotItemDeleted} from "~/server/bots/internal/is_bot_item_deleted.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {maxApiKeyCountPerBot} from "~/shared/bots/max_api_key_count_per_bot.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * What a write does to the number of API keys a bot has. `Rotate` replaces one key
 * with another, so it leaves the count alone.
 */
export type BotApiKeyWriteType = "Create" | "Rotate" | "Delete";

/**
 * Transaction entry that must be included with every write that creates, rotates,
 * or deletes one of a bot's API keys. Throws a not found error if the bot doesn't
 * exist or was deleted, and a failed precondition error if a `Create` would take
 * the bot past `maxApiKeyCountPerBot`.
 *
 * The entry writes the bot's `Attributes` item to do two things:
 *
 * - Bump `updateLockVersion`, so the key write is serialized with bot deletion,
 *   which bumps the same version. Without it a key added while a bot is being
 *   deleted could outlive its bot:
 *     - T=1: Deletion reads the bot and its API keys.
 *     - T=2: A new key, `K5`, is created for the bot.
 *     - T=3: Deletion marks the bot deleted and deletes the keys it read at T=1,
 *       leaving `K5` behind.
 *
 *     With the lock version bump the write at T=3 fails its condition check,
 *     retries, and deletes `K5` too. (Or the key creation fails if it's the one
 *     that loses the race, in which case it retries and then finds the bot
 *     deleted.)
 *
 * - Store the bot's new `apiKeyCount`, which is what the limit check reads.
 *   Counting `BotApiKeysIndex` instead would be wrong, because it's a GSI and a
 *   key written a moment ago may not be in it yet. The lock version alone doesn't
 *   save us there: the loser of a race retries immediately, which is exactly when
 *   the winner's key is least likely to have reached the index, so both writers
 *   would be let through.
 *
 * Must be used inside a `context.dynamo.retryTransaction()` loop so a lost race is
 * retried against a freshly read bot item.
 */
export async function getBotApiKeyWriteLockTransactionEntry(
    context: DynamoContext,
    botId: BotId,
    writeType: BotApiKeyWriteType,
): Promise<DynamoTransactionEntry> {
    // Read strongly because we write based on this item's `updateLockVersion` and
    // `apiKeyCount`. A stale read is still safe, it just costs us a retry.
    const botItem = await BotsTable.getItemIfExists(
        context,
        {partitionType: "Bot", sortRangeType: "Attributes", botId},
        {consistency: "StrongWithinCache"},
    );

    if (!botItem || isBotItemDeleted(botItem)) throw createBotNotFoundError(botId);

    return BotsTable.transactionDirectlyUpdateItemAttribute(
        {partitionType: "Bot", sortRangeType: "Attributes", botId},
        "apiKeyCount",
        getBotApiKeyCountAfterWrite(writeType, botItem.apiKeyCount),
        {updateLockVersion: botItem.updateLockVersion},
    );
}

function getBotApiKeyCountAfterWrite(writeType: BotApiKeyWriteType, apiKeyCount: number): number {
    switch (writeType) {
        case "Create":
            if (apiKeyCount >= maxApiKeyCountPerBot) {
                throw new FailedPreconditionError(
                    `Bot already has ${maxApiKeyCountPerBot} API keys`,
                    {
                        displayMessage: errorDisplayMessage`A bot can have at most ${maxApiKeyCountPerBot} API keys. Delete one of this bot\u2019s keys before creating another.`,
                    },
                );
            }
            return apiKeyCount + 1;

        case "Rotate":
            return apiKeyCount;

        case "Delete":
            // The caller only deletes a key it read, and every key write goes through this
            // entry, so a bot with a key to delete has counted it.
            assert(apiKeyCount > 0, "Bot has no API keys to delete");
            return apiKeyCount - 1;

        default:
            throw exhaustive(writeType);
    }
}
