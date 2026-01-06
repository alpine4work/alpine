import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the `SpaceId`s our actor has pending invites for.
 */
export async function getOurAccountInvitePendingSpaceIds(
    context: ServerSessionActionContext,
): Promise<ReadonlySet<SpaceId>> {
    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId: context.actor.getAccountId(),
    });

    const invitePendingSpaceIds: ReadonlySet<SpaceId> =
        spacesItem?.invitePendingSpaceIds ?? new Set();

    return invitePendingSpaceIds;
}
