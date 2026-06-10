import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.js";

export async function createUnscopedApiKeyForBot(
    context: ServerActionContext,
    {botId, name}: {botId: BotId; name: string | null},
): Promise<ApiKey> {
    await authorizeInternalAccess(context);

    const apiKey = generateApiKey();

    await BotsTable.createItem(context, {
        partitionType: "ApiKey",
        sortRangeType: "Attributes",
        apiKey,
        botId,
        spaceId: null,
        space: null,
        createdTime: new Date(),
        name,
    });

    return apiKey;
}
