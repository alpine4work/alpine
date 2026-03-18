import {BotWithAvatarItem, BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {BotId} from "~/shared/id/types/id_types.js";

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 * Importantly, excludes protected information like the webhook URL and API keys.
 */
async function getBotWithAvatarItemIfExists(
    context: DynamoContext,
    botId: BotId,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<BotWithAvatarItem | null> {
    const items = await arrayFromAsyncIterable(
        BotsTable.query(context, {
            limit: 2,
            partitionKey: {
                partitionType: "Bot",
                botId,
            },
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "Avatar"},
            consistency,
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );
    if (!attributesItem) return null;

    const avatarItem = findMapIterable(items, item =>
        item.sortRangeType === "Avatar" ? item : undefined,
    );

    return {
        id: attributesItem.botId,
        name: attributesItem.name,
        createdTime: attributesItem.createdTime,
        hasWebhookUrl: !!attributesItem.webhookUrl,
        avatar: avatarItem ?? null,
    };
}

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 * Importantly, excludes protected information like the webhook URL and API keys.
 */
export async function getBotWithAvatarItem(
    context: DynamoContext,
    botId: BotId,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<BotWithAvatarItem> {
    const item = await getBotWithAvatarItemIfExists(context, botId, {consistency});
    if (!item) throw createBotNotFoundError(botId);
    return item;
}
