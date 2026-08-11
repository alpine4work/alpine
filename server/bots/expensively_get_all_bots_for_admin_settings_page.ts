import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotAvatarItem, BotItem, BotsTable} from "~/server/bots/internal/bots_table.js";
import {createBotFromItem} from "~/server/bots/internal/create_bot_from_item.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {BotForAdmin} from "~/shared/bots/bot_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

// NOTE(ifitzsimmons, #bots): In order to support an internal bot management page,
// we need to load all bots (with their avatars). Eventually, we should introduce
// an ownership model for bots that enables indexing bots by owner. However, we
// don't have a really strong product use case for bot "ownership" yet. Since the
// only bots are the ones that we've created, it's okay to just get all the bots in
// the table with their avatars and API keys.
export async function expensivelyGetAllBotsForAdminSettingsPage(
    context: ServerActionContext,
): Promise<Array<BotForAdmin>> {
    // NOTE(ifitzsimmons, #bots): For now, only internal accounts (alpine engineers)
    // can update bot avatars. Eventually, we'll need to decide on some type of
    // "ownership" model when it comes to bots.
    await authorizeInternalAccess(context);

    const botIdsToBotData: Map<
        BotId,
        {
            item?: BotItem;
            avatar?: BotAvatarItem | null;
            apiKeys?: Array<{
                apiKey: ApiKey;
                name: string | null;
                spaceId: SpaceId | null;
                scope: SchemaSerializedValue | null;
            }>;
        }
    > = new Map();

    for await (const item of BotsTable.expensiveScan(context, {})) {
        const botData = botIdsToBotData.get(item.botId);

        if (item.partitionType === "Bot" && item.sortRangeType === "Attributes") {
            botIdsToBotData.set(item.botId, {
                ...botData,
                item,
            });
        }

        if (item.partitionType === "Bot" && item.sortRangeType === "Avatar") {
            botIdsToBotData.set(item.botId, {
                ...botData,
                avatar: item ?? null,
            });
        }

        if (item.partitionType === "ApiKey" && item.sortRangeType === "Attributes") {
            botIdsToBotData.set(item.botId, {
                ...botData,
                apiKeys: [
                    ...(botData?.apiKeys ?? []),
                    {
                        apiKey: item.apiKey,
                        name: item.name,
                        spaceId: item.spaceId ?? null,
                        scope: (item.space?.scope ?? null) as SchemaSerializedValue | null,
                    },
                ],
            });
        }
    }

    return Array.from(botIdsToBotData.values()).map(botData => {
        assert(botData.item, "Bot item was not found");

        const {webhook} = botData.item;
        return {
            ...createBotFromItem({
                id: botData.item.botId,
                createdTime: botData.item.createdTime,
                name: botData.item.name,
                hasWebhookUrl: !!webhook?.url,
                avatar: botData.avatar ?? null,
            }),
            webhook: {
                url: webhook?.url ?? null,
                hasSecret: (webhook?.secret ?? null) !== null,
            },
            apiKeys: botData.apiKeys ?? [],
        };
    });
}
