import {settingsDefaultKnownBotAccountModelDataById} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {BotSettingsAccount} from "~/shared/bots/bot_settings_account_schema.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get a bot account for the bot settings page. If no bot account exists and it's a
 * known bot then we return some default account data (e.g. default name, default
 * avatar, etc.)
 */
export async function getKnownBotSettingsAccount(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<BotSettingsAccount> {
    await authorizeBotOperation(context, botId, {type: "View"}, {consistency});

    const defaultAccountData = settingsDefaultKnownBotAccountModelDataById.get().get(botId) ?? null;

    const accountId = await getBotAccountIdForSpaceIfExists(context, botId, spaceId, {
        consistency,
    });

    const account =
        accountId !== null ? await getAccount(context, spaceId, accountId, {consistency}) : null;

    if (account) {
        return {type: "Exists", account, defaultAccountData};
    }

    if (defaultAccountData) {
        return {type: "OnlyDefaultExists", defaultAccountData};
    }

    throw createBotNotFoundError(botId);
}
