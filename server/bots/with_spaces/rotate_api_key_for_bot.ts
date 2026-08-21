import {rotateApiKeyForBotWithoutAuthorization} from "~/server/bots/internal/rotate_api_key_for_bot_without_authorization.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Atomically revoke an existing `ApiKey` and issue a replacement for the same bot
 * with the same scope and name. Returns the newly issued `ApiKey`.
 */
export async function rotateApiKeyForBot(
    context: ServerAuthenticatedActionContext,
    {botId, apiKey}: {botId: BotId; apiKey: ApiKey},
): Promise<ApiKey> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    return await rotateApiKeyForBotWithoutAuthorization(context, {botId, apiKey});
}
