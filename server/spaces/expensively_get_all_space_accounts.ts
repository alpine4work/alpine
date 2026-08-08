import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    getAllSpaceAccountsWithoutCachingAndWithoutAuthorization,
    spaceAccountsCache,
} from "~/server/spaces/internal/space_accounts_cache.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Gets all the accounts in our space.
 *
 * Expensive since there is no pagination to this method. Can get quite slow for
 * spaces with many accounts. We may cache this list to improve performance.
 * However, since right now this is used primarily to search for accounts the real
 * solution is to setup ElasticSearch and use that for searching accounts.
 *
 * Returns in `AccountId` order.
 */
// TODO(calebmer): Should eventually migrate this to the search system. Or it
// should use fuse server side? At some point downloading all accounts to the
// client won't make sense.
//
// When you initially open an account picker it should show affinitive accounts
// first (based on search entity affinity points). Then you search that list.
// Though if a space has <100 accounts we probably still want to load the entire
// list of accounts to the client instead of searching in OpenSearch.
export async function expensivelyGetAllSpaceAccounts(
    context: ServerActionContext,
    spaceId: SpaceId,
    {
        consistency = "Eventual",
        allowInvitePending = false,
    }: {
        consistency?: DynamoReadConsistency;
        allowInvitePending?: boolean;
    } = {},
): Promise<ReadonlyArray<AccountModel>> {
    // Skip the cache, load all space accounts with strong consistency.
    if (consistency === "Strong") {
        // `spaceAccountsCache.getData` already check the `authorizeSpaceAccess`
        // internally, so only check for strong consistency block.
        await authorizeSpaceAccess(context, spaceId, undefined, {allowInvitePending});

        return await getAllSpaceAccountsWithoutCachingAndWithoutAuthorization(context, spaceId, {
            isBlocking: true,
            consistency: "Strong",
        });
    }

    const {accounts} = await spaceAccountsCache.getData(context, spaceId, {allowInvitePending});
    return accounts;
}
