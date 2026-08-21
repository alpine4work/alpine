import {BotWithAvatarItem, BotsTable} from "~/server/bots/internal/bots_table.js";
import {BotItemAuthorizationCache} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {isBotItemDeleted} from "~/server/bots/internal/is_bot_item_deleted.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 * Importantly, excludes protected information like the webhook URL and API keys.
 */
export async function getBotWithAvatarItemIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotWithAvatarItem | null> {
    const items = await arrayFromAsyncIterable(
        BotsTable.query(context, {
            limit: 3,
            partitionKey: {
                partitionType: "Bot",
                botId,
            },
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "SettingsSchema"},
            consistency,
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );

    // Callers usually follow this read with a permission check which needs the very
    // same attributes item (`hasBotOperationAccess()`), so seed the authorization
    // cache to save that dependent round trip. Only seed when nothing is cached yet so
    // never replace a fresher entry with the one we just read.
    if (BotItemAuthorizationCache.getIfExists(context, "Eventual", botId) === null) {
        BotItemAuthorizationCache.set(
            context,
            consistency,
            botId,
            attributesItem && !isBotItemDeleted(attributesItem) ? attributesItem : null,
        );
    }

    if (!attributesItem || isBotItemDeleted(attributesItem)) return null;

    const avatarItem = findMapIterable(items, item =>
        item.sortRangeType === "Avatar" ? item : undefined,
    );

    const settingsItem = findMapIterable(items, item =>
        item.sortRangeType === "SettingsSchema" ? item : undefined,
    );

    return {
        id: attributesItem.botId,
        ownerEntity: attributesItem.ownerEntity,
        name: attributesItem.name,
        createdTime: attributesItem.createdTime,
        description: settingsItem?.description.textContent || null,
        webhook: attributesItem.webhook,
        avatar: avatarItem ?? null,
    };
}

/**
 * Get the information associated with a bot. Currently, basic information about a
 * bot is public globally (e.g. its name, presence of a webhook URL, and avatar)!
 * Importantly, excludes protected information like the webhook URL and API keys.
 */
export async function getBotWithAvatarItem(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    botId: BotId,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotWithAvatarItem> {
    const item = await getBotWithAvatarItemIfExists(context, botId, {consistency});
    if (!item) throw createBotNotFoundError(botId);
    return item;
}
