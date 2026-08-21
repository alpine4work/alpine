import {BotItem, BotsTable} from "~/server/bots/internal/bots_table.js";
import {isBotItemDeleted} from "~/server/bots/internal/is_bot_item_deleted.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

export const BotItemAuthorizationCache = new DynamoContextCache<BotId, BotItem | null>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Get the `BotItem` for a bot, including all its attributes, if it exists. A
 * soft-deleted bot reads back as null.
 *
 * This doesn't authorize that the actor may view the bot. It returns the item the
 * caller needs to resolve that themselves (see `hasBotOperationAccess()`).
 */
export async function getBotItemForAuthorizationIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotItem | null> {
    return await BotItemAuthorizationCache.get(context, consistency, botId, async consistency => {
        const item = await BotsTable.getItemIfExists(
            context,
            {partitionType: "Bot", sortRangeType: "Attributes", botId},
            {consistency},
        );
        return item && !isBotItemDeleted(item) ? item : null;
    });
}

/**
 * Get the `BotItem` for a bot, including all its attributes, throwing if the bot
 * doesn't exist or was soft-deleted.
 *
 * Like `getBotItemIfExistsForAuthorization()` this doesn't authorize the actor.
 */
export async function getBotItemForAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotItem> {
    const item = await getBotItemForAuthorizationIfExists(context, botId, {consistency});
    if (!item) throw createBotNotFoundError(botId);
    return item;
}
