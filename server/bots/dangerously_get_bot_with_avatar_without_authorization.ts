import {createBotFromItem} from "~/server/bots/internal/create_bot_from_item.js";
import {
    getBotWithAvatarItem,
    getBotWithAvatarItemIfExists,
} from "~/server/bots/internal/get_bot_with_avatar_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get basic information about a bot with its avatar. Does not check if the actor
 * is able to access the bot within their space, so anything calling this should
 * also call `authorizeBotOperation()`, or `hasBotOperationAccess()` before using
 * the bot.
 */
export async function dangerouslyGetBotWithAvatarWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Bot> {
    const item = await getBotWithAvatarItem(context, botId, {consistency});
    return createBotFromItem(item);
}

/**
 * Get basic information about a bot with its avatar. Does not check if the actor
 * is able to access the bot within their space, so anything calling this should
 * also call `authorizeBotOperation()`, or `hasBotOperationAccess()` before using
 * the bot.
 */
export async function dangerouslyGetBotWithAvatarWithoutAuthorizationIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Bot | null> {
    const item = await getBotWithAvatarItemIfExists(context, botId, {consistency});
    if (!item) return null;
    return createBotFromItem(item);
}
