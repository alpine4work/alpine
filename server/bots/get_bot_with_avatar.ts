import {createBotFromItem} from "~/server/bots/internal/create_bot_from_item.js";
import {getBotWithAvatarItem} from "~/server/bots/internal/get_bot_with_avatar_item.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {BotId} from "~/shared/id/types/id_types.js";

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 * Importantly, excludes protected information like the webhook URL and API keys.
 */
export async function getBotWithAvatar(
    context: DynamoContext,
    botId: BotId,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<Bot> {
    const item = await getBotWithAvatarItem(context, botId, {consistency});
    return createBotFromItem(item);
}
