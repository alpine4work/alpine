import {ServerActionContext} from "~/server/context/server_action_context.js";
import {disableNotificationsToSlack} from "~/server/notifications/data/push/disable_notifications_to_slack.js";
import {enableNotificationsToSlack} from "~/server/notifications/data/push/enable_notifications_to_slack.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function notifyInboxOfSlackIntegrationChange(
    context: ServerActionContext,
    {
        eventType,
        spaceId,
        workspaceId,
        accountId,
    }: {
        eventType: "connectSlackAccount" | "disconnectSlackAccount";
        spaceId: SpaceId;
        workspaceId: string;
        accountId: AccountId;
    },
) {
    switch (eventType) {
        case "connectSlackAccount":
            await enableNotificationsToSlack(context, {spaceId, workspaceId, accountId});
            break;
        case "disconnectSlackAccount":
            await disableNotificationsToSlack(context, {spaceId, workspaceId, accountId});
            break;
        default:
            throw exhaustive(eventType);
    }
}
