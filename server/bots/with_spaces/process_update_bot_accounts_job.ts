import {dangerouslyUpdateBotAccountAvatarWithoutAuthorization} from "~/server/accounts/dangerously_update_bot_account_avatar_without_authorization.js";
import {dangerouslyUpdateBotAccountNameWithoutAuthorization} from "~/server/accounts/dangerously_update_bot_account_name_without_authorization.js";
import {dangerouslyUpdateBotAccountOwnerWithoutAuthorization} from "~/server/accounts/dangerously_update_bot_account_owner_without_authorization.js";
import {dangerouslyGetBotWithAvatarWithoutAuthorization} from "~/server/bots/dangerously_get_bot_with_avatar_without_authorization.js";
import {getBotItemForAuthorization} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {dangerouslyGetAllSpaceAccountsForBot} from "~/server/spaces/dangerously_get_all_space_accounts_for_bot.js";
import {Context} from "~/shared/context/context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";

export async function processUpdateBotAccountsJob(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {botId, update}: MaintenanceJobDescription & {type: "UpdateBotAccounts"},
) {
    // Read strongly so we don't miss a space account that was just instantiated, and
    // so we copy the bot's latest name/avatar rather than a stale one.
    const options = {consistency: "StrongWithinCache"} as const;

    switch (update.type) {
        case "Name": {
            const bot = await getBotItemForAuthorization(context, botId, options);

            await parallelProcessAsyncIterable(
                dangerouslyGetAllSpaceAccountsForBot(context, botId, options),
                async ({spaceId, accountId}) => {
                    await dangerouslyUpdateBotAccountNameWithoutAuthorization(context, {
                        spaceId,
                        accountId,
                        name: bot.name,
                    });
                },
            );
            return;
        }
        case "Avatar": {
            const botAvatar = await dangerouslyGetBotWithAvatarWithoutAuthorization(
                context,
                botId,
                options,
            );
            const avatarContent = assertExists(botAvatar.avatar?.content);
            const avatarId = assertExists(botAvatar.avatar?.avatarId);

            await parallelProcessAsyncIterable(
                dangerouslyGetAllSpaceAccountsForBot(context, botId, options),
                async ({accountId}) => {
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
            return;
        }
        case "Owner": {
            const bot = await getBotItemForAuthorization(context, botId, options);

            await parallelProcessAsyncIterable(
                dangerouslyGetAllSpaceAccountsForBot(context, botId, options),
                async ({accountId}) => {
                    await dangerouslyUpdateBotAccountOwnerWithoutAuthorization(context, {
                        accountId,
                        ownerEntity: bot.ownerEntity,
                    });
                },
            );
            return;
        }
        default:
            throw exhaustive(update);
    }
}
