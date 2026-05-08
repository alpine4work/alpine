import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {BotId} from "~/shared/id/types/id_types.js";

type BotWithoutAvatar = {
    readonly name: string;
    readonly hasWebhookUrl: boolean;
};

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 */
export async function getBot(context: DynamoContext, botId: BotId): Promise<BotWithoutAvatar> {
    const bot = await getBotIfExists(context, botId);
    if (!bot) throw createBotNotFoundError(botId);
    return bot;
}

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 */
export async function getBotIfExists(
    context: DynamoContext,
    botId: BotId,
): Promise<BotWithoutAvatar | null> {
    const botItem = await BotsTable.getItemIfExists(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
    });

    if (!botItem) return null;

    return {
        name: botItem.name,
        hasWebhookUrl: !!botItem.webhookUrl,
    };
}
