import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {removeAllSpaceAccountsForBot} from "~/server/spaces/remove_all_space_accounts_for_bot.js";
import {Context} from "~/shared/context/context.js";

export async function processRemoveAllSpaceAccountsForBotJob(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {botId}: MaintenanceJobDescription & {type: "RemoveBotAccounts"},
) {
    await removeAllSpaceAccountsForBot(context, botId);
}
