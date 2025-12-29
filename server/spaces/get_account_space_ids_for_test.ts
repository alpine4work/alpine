import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function getAccountSpaceIdsForTest(
    context: DynamoContext,
    accountId: AccountId,
): Promise<ReadonlySet<SpaceId>> {
    assert(import.meta.jest);

    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId,
    });

    return spacesItem?.spaceIds ?? new Set();
}
