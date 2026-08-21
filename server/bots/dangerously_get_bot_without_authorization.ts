import {getBotItemForAuthorizationIfExists} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {BotOwnerEntity, parseBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

type BotWithoutAvatar = {
    readonly name: string;
    readonly hasWebhookUrl: boolean;
    readonly ownerEntity: BotOwnerEntity;
};

/**
 * Get basic information about a bot. Does not check if the actor is able to access
 * the bot within their space, so anything calling this should also call
 * `authorizeBotOperation()`, or `hasBotOperationAccess()` before using the bot.
 */
export async function dangerouslyGetBotWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotWithoutAvatar> {
    const bot = await dangerouslyGetBotIfExistsWithoutAuthorization(context, botId, {consistency});
    if (!bot) throw createBotNotFoundError(botId);
    return bot;
}

/**
 * Get basic information about a bot. Does not check if the actor is able to access
 * the bot within their space, so anything calling this should also call
 * `authorizeBotOperation()`, or `hasBotOperationAccess()` before using the bot.
 */
export async function dangerouslyGetBotIfExistsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotWithoutAvatar | null> {
    const botItem = await getBotItemForAuthorizationIfExists(context, botId, {consistency});
    if (!botItem) return null;

    return {
        name: botItem.name,
        ownerEntity: parseBotOwnerEntityId(botItem.ownerEntity),
        hasWebhookUrl: !!botItem.webhook?.url,
    };
}
