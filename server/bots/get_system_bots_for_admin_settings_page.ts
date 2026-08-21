import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotApiKeysIndex, BotsByOwnerIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {createBotFromItem} from "~/server/bots/internal/create_bot_from_item.js";
import {getBotWithAvatarItemIfExists} from "~/server/bots/internal/get_bot_with_avatar_item.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {BotSecrets} from "~/shared/bots/bot_schema.js";
import {botOwnerEntityIdForSystem} from "~/shared/bots/owners/bot_owner_entity.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Get every global/system bot, along with its secrets, for the internal bot admin
 * settings page. Uses a GSI so it is always eventually consistent.
 *
 * Bots owned by an account or a space are excluded. Internal access on its own
 * doesn't grant permission to manage them, and they're managed from the space bot
 * settings page instead (see `getBotsByOwner()`).
 */
export async function getSystemBotsForAdminSettingsPage(
    context: ServerActionContext,
): Promise<Array<BotSecrets>> {
    // Modifying a system bot requires nothing more than internal access (see
    // `authorizeBotOperation()`), so this one check authorizes every bot we return
    // below. If you widen this query past the `System` owner then you must authorize
    // each bot individually with `hasBotOperationAccess()`.
    await authorizeInternalAccess(context);

    // The index only projects keys, and already filters out soft-deleted bots.
    const botKeys = BotsByOwnerIndex.query(context, {
        partitionKey: {ownerEntity: botOwnerEntityIdForSystem()},
        limit: "All",
    });

    const bots = await parallelMapAsyncIterableToArray(botKeys, async ({botId}) => {
        const [botWithAvatarItem, apiKeys] = await runAllPromises([
            getBotWithAvatarItemIfExists(context, botId),
            getApiKeysForBot(context, botId),
        ]);

        // A bot may have been deleted between reading the index and reading its items.
        if (!botWithAvatarItem) return null;

        const {webhook} = botWithAvatarItem;

        return {
            ...createBotFromItem(botWithAvatarItem),
            webhook: webhook ? {url: webhook.url, secret: webhook.secret} : null,
            apiKeys,
        } satisfies BotSecrets;
    });

    return bots.filter(bot => bot !== null);
}

async function getApiKeysForBot(context: ServerActionContext, botId: BotId) {
    const apiKeyKeys = BotApiKeysIndex.query(context, {
        partitionKey: {botId},
        limit: "All",
    });

    const apiKeys = await parallelMapAsyncIterableToArray(apiKeyKeys, async ({apiKey}) => {
        const apiKeyItem = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });

        if (!apiKeyItem) return null;

        return {
            apiKey: apiKeyItem.apiKey,
            name: apiKeyItem.name,
            spaceId: apiKeyItem.spaceId ?? null,
            scope: (apiKeyItem.space?.scope ?? null) as SchemaSerializedValue | null,
        };
    });

    // A key may have been revoked between reading the index and reading the item, so
    // skip keys without an item.
    return apiKeys.filter(apiKey => apiKey !== null);
}
