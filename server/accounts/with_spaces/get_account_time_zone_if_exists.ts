import {getAccountSettingsItem} from "~/server/accounts/internal/get_account_settings_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get the observed time zone for the provided account. System actors are allowed
 * to get the time zone for any account in their space, but session actors and bots
 * are only allowed to get the time zone for their own account.
 */
export async function getAccountTimeZoneIfExists(
    context: Context<
        DynamoContextModules & {
            process: ProcessContextModule;
            cache: CacheContextModule;
            actor: ActorContextModule;
        }
    >,
    accountId: AccountId,
): Promise<TimeZone | null> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    const accountSettingsItem = await getAccountSettingsItem(context, accountId);
    return accountSettingsItem.observedTimeZone;
}
