import {
    ServerActionContextModules,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the active `SpaceId`s our actor is a part of (excludes invite pending
 * spaces).
 *
 * Also allows you to get a condition check transaction entry that fails if our
 * actor was added to or removed from a space.
 */
export function getOurAccountSpaceIds(context: ServerSessionActionContext): Promise<{
    spaceIds: ReadonlySet<SpaceId>;
    getConditionCheckTransactionEntry: () => DynamoTransactionEntry;
}> {
    return getAccountSpaceIdsWithoutAuthorization(context, context.actor.getAccountId());
}

/**
 * Is the account active in no spaces? Performs no authorization. We allow anyone
 * to call this function, the information it reveals is trivial.
 *
 * Also allows you to get a condition check transaction entry that fails if our
 * actor was added to or removed from a space.
 */
export async function isAccountInNoSpaces(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    accountId: AccountId,
): Promise<{
    isInNoSpaces: boolean;
    getConditionCheckTransactionEntry: () => DynamoTransactionEntry;
}> {
    const {spaceIds, getConditionCheckTransactionEntry} =
        await getAccountSpaceIdsWithoutAuthorization(context, accountId);

    return {isInNoSpaces: spaceIds.size === 0, getConditionCheckTransactionEntry};
}

async function getAccountSpaceIdsWithoutAuthorization(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    accountId: AccountId,
): Promise<{
    spaceIds: ReadonlySet<SpaceId>;
    getConditionCheckTransactionEntry: () => DynamoTransactionEntry;
}> {
    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId,
    });

    const spaceIds: ReadonlySet<SpaceId> = spacesItem?.spaceIds ?? new Set();

    return {
        spaceIds,
        getConditionCheckTransactionEntry: () =>
            spacesItem
                ? SpacesTable.transactionUpdateLockVersionConditionCheck(
                      {
                          partitionType: "Account",
                          sortRangeType: "Spaces",
                          accountId,
                      },
                      spacesItem.updateLockVersion,
                  )
                : SpacesTable.transactionDoesNotExistConditionCheck(
                      {
                          partitionType: "Account",
                          sortRangeType: "Spaces",
                          accountId,
                      },
                      {isConditionCheckErrorRetriable: true},
                  ),
    };
}
