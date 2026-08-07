import {getAccountSettingsItem} from "~/server/accounts/internal/get_account_settings_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the last opened `SpaceId` for the provided account without authorizing
 * whether the current context has access to see the account's last opened space or
 * not.
 */
export async function dangerouslyGetAccountLastOpenedSpaceIdWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
): Promise<SpaceId | null> {
    const settings = await getAccountSettingsItem(context, accountId);
    return settings.lastOpenedSpaceId ?? null;
}
