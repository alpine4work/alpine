import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {Context} from "~/shared/context/context.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function disableNotificationsToSlack(
    context: Context<DynamoContextModules & {actor: ActorContextModule}>,
    {
        spaceId,
        workspaceId,
        accountId,
    }: {spaceId: SpaceId; workspaceId: string; accountId: AccountId},
) {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can\u2019t disable slack integration targets for a different account",
                );
            }
            break;
        }
        case "System": {
            // System actor can delete slack integration targets for any account
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

    await NotificationsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "PushTargets",
        sortRangeType: "SlackIntegration",
        accountId,
        spaceId,
        workspaceId,
    });
}
