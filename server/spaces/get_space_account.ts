import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createSpaceAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getSpaceAccountItemWithEventualThenStrongConsistency} from "~/server/spaces/internal/get_space_account_item.js";
import {spaceAccountsCache} from "~/server/spaces/internal/space_accounts_cache.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

/**
 * Get the information associated with an account's membership in a space. For
 * instance the account's role, state, and more. Doesn't load the full
 * `AccountModel` for that you should call `getAccount()`.
 */
export async function getSpaceAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<AccountModelData["space"]> {
    await authorizeSpaceAccess(context, spaceId);

    // Check if all accounts in the space are cached...
    const accountsCacheData =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context,
            spaceId,
        );

    const accountFromCache = accountsCacheData?.accountById.get(accountId);
    if (accountFromCache) return accountFromCache.initialData.space;

    // Try loading the space account with eventual consistency and if that doesn't
    // work then try loading the space account with strong consistency.
    const item = await getSpaceAccountItemWithEventualThenStrongConsistency(
        context,
        spaceId,
        accountId,
    );
    return createSpaceAccountModelFromItem(item);
}
