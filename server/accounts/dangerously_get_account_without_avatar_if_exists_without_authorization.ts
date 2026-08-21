import {getAccountItemWithoutAvatarIfExists} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {parseBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get an account without authorizing whether the current context has access or
 * not.
 *
 * You should not call this function! It does not authorize that you are allowed to
 * access the account and does not cache accounts. Instead use
 * `getAccountIfExists()` in `server/spaces/spaces_table.ts`.
 */
export async function dangerouslyGetAccountWithoutAvatarIfExistsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Omit<AccountModelWithoutSpaceData, "avatar"> | null> {
    const accountItem = await getAccountItemWithoutAvatarIfExists(context, accountId, options);
    if (!accountItem) return null;

    return {
        id: accountItem.accountId,
        version: accountItem.updateLockVersion ?? 0,
        name: accountItem.name,
        nameVersion: accountItem.nameVersion ?? 0,
        bot: accountItem.bot && {
            id: accountItem.bot.botId,
            owner: parseBotOwnerEntityId(accountItem.bot.ownerEntity),
        },
        reactionCharacter: accountItem.reactionCharacter,
    };
}
