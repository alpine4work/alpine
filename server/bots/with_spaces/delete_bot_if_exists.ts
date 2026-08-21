import {deleteBotIfExistsWithoutAuthorization} from "~/server/bots/internal/delete_bot_if_exists_without_authorization.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Soft-delete a bot, remove its settings and API keys, and uninstall it from every
 * space if it exists. The bot's attributes and avatar are retained.
 */
export async function deleteBotIfExists(
    context: ServerAuthenticatedActionContext,
    {botId}: {botId: BotId},
): Promise<void> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    await deleteBotIfExistsWithoutAuthorization(context, {botId});

    // Remove the bot's instantiated space account(s) so it stops appearing in account
    // lists (e.g. new chat suggestions and the mention menu) and can no longer be
    // chatted with. We do this in a maintenance job since a bot may be instantiated in
    // more than one space.
    await context.jobs.dangerouslySendMaintenance({
        type: "RemoveBotAccounts",
        botId,
    });
}
