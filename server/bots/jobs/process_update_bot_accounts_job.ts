import {dangerouslyUpdateBotAccountAvatarWithoutAuthorization} from "~/server/accounts/accounts_actions.js";
import {getBotWithAvatar} from "~/server/bots/bots_table.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {dangerouslyGetAllAccountIdsForBot} from "~/server/spaces/spaces_actions.js";
import {Context} from "~/shared/context/context.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";

export async function processUpdateBotAccountsJob(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {botId, update}: MaintenanceJobDescription & {type: "UpdateBotAccounts"},
) {
    switch (update.type) {
        case "Name": {
            throw new UnimplementedError("Updating bot name is not implemented");
        }
        case "Avatar": {
            const options = {consistency: "Strong"} as const;

            const botAvatar = await getBotWithAvatar(context, botId, options);
            const avatarContent = assertExists(botAvatar.avatar?.content);
            const avatarId = assertExists(botAvatar.avatar?.avatarId);

            // We use a parallel process here because There's built-in backpressure so we don't
            // query the next page from the iterable unless we have the available concurrency
            // to process the next item.
            await parallelProcessAsyncIterable(
                dangerouslyGetAllAccountIdsForBot(context, botId, options),
                async accountId => {
                    await dangerouslyUpdateBotAccountAvatarWithoutAuthorization(
                        context,
                        accountId,
                        {
                            avatarId,
                            avatarContent,
                        },
                    );
                },
            );
        }
    }
}
