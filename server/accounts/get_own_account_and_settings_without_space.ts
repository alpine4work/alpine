import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItemAndSettingsItemIfExists} from "~/server/accounts/internal/get_account_item_and_settings_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {AccountSettings} from "~/shared/accounts/accounts_settings.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Get the actor's account.
 */
export async function getOwnAccountAndSettingsWithoutSpace(
    context: Context<
        DynamoContextModules & {cache: CacheContextModule; actor: SessionActorContextModule}
    >,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    account: AccountModelWithoutSpace;
    settings: AccountSettings;
}> {
    const items = await getAccountItemAndSettingsItemIfExists(
        context,
        context.actor.getAccountId(),
        options,
    );

    // The account must exist since we have a session actor for the account.
    assert(items);

    // Sanity check: session actors can't be bots. This should be enforced throughout
    // the system but we have a sanity check here just in case we slipped up somewhere.
    //
    // This isn't important for correctness! You could remove this check and there
    // would be no new bugs. This is purely a backup validation check given when
    // creating the session actor we only check whether a session item exists in
    // DynamoDB (we don't load the account and check that it's non-bot at that point).
    if (context.actor.type === "Session" && items.accountItem.bot) {
        throw new InternalError("Session actors can\u2019t be bot accounts");
    }

    return {
        account: createAccountModelWithoutSpaceFromItem(items.accountItem),
        settings: items.settingsItem,
    };
}
