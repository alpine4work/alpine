import {ServerActionContext} from "~/server/context/server_action_context.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Disconnects a Slack account from an existing Slack workspace connection by
 * deleting the integration item in the database. The workspace remains linked to
 * the space.
 *
 * System actors can disconnect Slack accounts for any account whereas session
 * actors may only disconnect Slack accounts for their own account.
 */
export async function deleteSlackAccountIntegration(
    context: ServerActionContext,
    {
        accountId,
        spaceId,
        workspaceId,
    }: {accountId: AccountId; spaceId: SpaceId; workspaceId: string},
) {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can\u2019t disconnect Slack account for a different account",
                );
            }
            break;
        }
        case "System": {
            // System actor can disconnect Slack accounts for any account.
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        case "Bot": {
            throw permissionDeniedBotError();
        }
        default:
            throw exhaustive(context.actor);
    }

    await IntegrationsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "SlackSpaceIntegration",
        sortRangeType: "SlackUser",
        spaceId,
        workspaceId,
        accountId,
    });

    await context.notificationsInjection.notifyInboxOfSlackIntegrationChange({
        eventType: "disconnectSlackAccount",
        spaceId,
        workspaceId,
        accountId,
    });
}
