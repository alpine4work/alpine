import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {ApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";

export async function createScopedApiKeyForBot(
    context: ServerActionContext,
    {
        botId,
        spaceId,
        accountId,
        name,
        scope,
    }: {
        botId: BotId;
        spaceId: SpaceId;
        accountId: AccountId;
        name: string | null;
        scope: BotTokenPayloadScope;
    },
): Promise<ApiKey> {
    await authorizeInternalAccess(context);

    const apiKey = generateApiKey();

    await BotsTable.createItem(context, {
        partitionType: "ApiKey",
        sortRangeType: "Attributes",
        apiKey,
        botId,
        spaceId,
        space: {
            accountId,
            scope,
        },
        createdTime: new Date(),
        name,
    });

    return apiKey;
}
