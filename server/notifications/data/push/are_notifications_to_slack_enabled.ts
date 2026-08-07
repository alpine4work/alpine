import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function areNotificationsToSlackEnabled(
    context: ServerSessionActionContext,
    {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId: string},
) {
    await authorizeSpaceAccess(context, spaceId);

    const item = await NotificationsTable.getItemIfExists(context, {
        partitionType: "PushTargets",
        sortRangeType: "SlackIntegration",
        accountId: context.actor.getAccountId(),
        spaceId,
        workspaceId,
    });

    return !!item;
}
