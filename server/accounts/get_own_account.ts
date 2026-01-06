import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItemIfExists} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Get the actor's account.
 */
export async function getOwnAccount(
    context: Context<
        DynamoContextModules & {cache: CacheContextModule; actor: SessionActorContextModule}
    >,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModelWithoutSpace> {
    const accountItem = await getAccountItemIfExists(
        context,
        context.actor.getAccountId(),
        options,
    );

    // The account must exist since we have a session actor for the account.
    assert(accountItem);

    return createAccountModelWithoutSpaceFromItem(accountItem);
}
