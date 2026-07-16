import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {BotWebhook} from "~/shared/bots/bot_schema.js";
import {generateId} from "~/shared/id/id.js";
import {BotId} from "~/shared/id/types/id_types.js";

export async function createBot(
    context: ServerActionContext,
    {name, webhook}: {name: string; webhook: BotWebhook | null},
): Promise<{botId: BotId}> {
    await authorizeInternalAccess(context);

    const botId = generateId<BotId>();

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
        createdTime: new Date(),
        name,
        webhook,
    });

    return {botId};
}
