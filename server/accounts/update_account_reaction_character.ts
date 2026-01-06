import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";

/**
 * Updates the reaction character for the account.
 */
export async function updateAccountReactionCharacter(
    context: Context<
        DynamoContextModules & {cache: CacheContextModule; actor: SessionActorContextModule}
    >,
    reactionCharacter: ReactionCharacter,
): Promise<AccountModelWithoutSpace> {
    context.actor.authorizeSession();

    const accountId = context.actor.getAccountId();

    return context.dynamo.retryTransaction(async context => {
        const oldAccountItem = await getAccountItem(context, accountId);

        const newAccountItem = await AccountsTable.directlyUpdateItem(context, {
            ...omitObject(oldAccountItem, ["avatar"]),
            reactionCharacter,
        });

        return createAccountModelWithoutSpaceFromItem({
            ...newAccountItem,
            avatar: oldAccountItem.avatar,
        });
    });
}
