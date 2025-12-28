import {SearchInjectionContextModule} from "~/server/context/injection_context_module.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Adds an account to a space without authorizing the actor has permission to
 * add accounts to the space.
 *
 * The added space account will have a "Member" role by default. But we use
 * this function in the test environment to add the accounts with "Admin" role
 * as well.
 *
 * If role is "Owner" we check that there are no other owners in the space,
 * otherwise we throw an error.
 *
 * This is a very very dangerous function! If arbitrary users got the ability
 * to add any user to any space they could easily compromise the data privacy
 * of spaces. You must authorize the actor is allowed to add accounts when
 * calling this function from an exported function.
 */
export async function addSpaceAccountWithoutAuthorization(
    context: Context<
        DynamoContextModules & {
            cache: CacheContextModule;
            jobs: JobsContextModule;
            searchInjection: SearchInjectionContextModule;
        }
    >,
    {
        spaceId,
        accountId,
        role = "Member",
        withoutInviteForTest = false,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
        withoutInviteForTest?: boolean;
    },
): Promise<AccountModel> {
    const createdAccount: AccountModel = await context.dynamo.retryTransaction(async context => {
        const currentTime = new Date();

        const {account, newAccountItem, transactionEntries} =
            await getAddSpaceAccountTransactionEntries(context, {
                currentTime,
                space: {type: "Existing", id: spaceId},
                account: {type: "Existing", id: accountId, withoutInviteForTest},
                role,
            });

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        return createAccountModelFromItem(
            newAccountItem,
            newAccountItem.state.type === "Active" ? account : null,
        );
    });

    return createdAccount;
}
