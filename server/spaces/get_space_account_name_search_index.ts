import {ServerActionContext} from "~/server/context/server_action_context.js";
import {spaceAccountsCache} from "~/server/spaces/internal/space_accounts_cache.js";
import {accountNameIndexFuseScoreMatchCutoff} from "~/server/spaces/space_accounts_cache_constants.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type SpaceAccountNameSearchIndex = {
    searchNames(queryText: string): Array<AccountModel>;
    searchShortNames(queryText: string): Array<AccountModel>;
    getByIdIfExists(accountId: AccountId): AccountModel | null;
};

/**
 * Get a server-side in-memory search index for accounts in the provided `SpaceId`.
 * The search index is powered by Fuse.js. The search index is cached in memory. So
 * if space accounts have already been loaded for this space, calling this function
 * is instant.
 */
export async function getSpaceAccountNameSearchIndex(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<SpaceAccountNameSearchIndex> {
    const {accountNameIndex, accountShortNameIndex, accountById} = await spaceAccountsCache.getData(
        context,
        spaceId,
    );

    return {
        searchNames: queryText => {
            return filterMapArray(accountNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return;
                return match.item;
            });
        },
        searchShortNames: queryText => {
            return filterMapArray(accountShortNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return;
                return match.item;
            });
        },
        getByIdIfExists: accountId => accountById.get(accountId) ?? null,
    };
}
