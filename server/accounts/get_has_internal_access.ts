import {getAccountItemWithoutAvatar} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";

/**
 * Does the account for this request have internal access? Returns `false` for
 * actors that do not represent an account instead of throwing. Impersonated
 * accounts have the same internal-access value as the account they represent.
 *
 * Prefer `authorizeInternalAccess()` when internal access is required. Use this
 * when internal access is one of multiple ways an actor may be authorized.
 */
export async function getHasInternalAccess(
    context: Context<DynamoContextModules & {cache: CacheContextModule; actor: ActorContextModule}>,
): Promise<boolean> {
    if (context.actor.type !== "Session" && context.actor.type !== "ImpersonatedAccount") {
        return false;
    }

    const accountItem = await getAccountItemWithoutAvatar(context, context.actor.getAccountId());
    return accountItem.hasInternalAccess ?? false;
}
