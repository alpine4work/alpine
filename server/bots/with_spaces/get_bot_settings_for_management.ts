import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {createBotFromItem} from "~/server/bots/internal/create_bot_from_item.js";
import {isBotItemDeleted} from "~/server/bots/internal/is_bot_item_deleted.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {BotOwnerEntity, parseBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

export type CustomBotSettings = {
    readonly bot: Bot;
    readonly ownerEntity: BotOwnerEntity;
    readonly webhookUrl: string | null;
    readonly webhookSecret: string | null;
};

/**
 * Get everything the custom bot settings page needs to manage a bot: its
 * attributes, avatar, and API keys. Only the bot's owner may load this (see
 * `authorizeBotOperation()`), unlike the public info from a bot account.
 */
export async function getBotSettingsForManagement(
    context: ServerAuthenticatedActionContext,
    botId: BotId,
): Promise<CustomBotSettings> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    const items = await arrayFromAsyncIterable(
        BotsTable.query(context, {
            limit: 3,
            partitionKey: {partitionType: "Bot", botId},
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "SettingsSchema"},
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );
    if (!attributesItem || isBotItemDeleted(attributesItem)) throw createBotNotFoundError(botId);

    const avatarItem = findMapIterable(items, item =>
        item.sortRangeType === "Avatar" ? item : undefined,
    );

    const settingsSchemaItem = findMapIterable(items, item =>
        item.sortRangeType === "SettingsSchema" ? item : undefined,
    );

    return {
        bot: createBotFromItem({
            id: attributesItem.botId,
            ownerEntity: attributesItem.ownerEntity,
            name: attributesItem.name,
            createdTime: attributesItem.createdTime,
            description: settingsSchemaItem
                ? settingsSchemaItem.description.textContent || null
                : null,
            webhook: attributesItem.webhook,
            avatar: avatarItem ?? null,
        }),
        ownerEntity: parseBotOwnerEntityId(attributesItem.ownerEntity),
        webhookUrl: attributesItem.webhook?.url ?? null,
        webhookSecret: attributesItem.webhook?.secret ?? null,
    };
}
