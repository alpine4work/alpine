import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {NotFoundError} from "~/shared/error/error.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Enables notifications to a Slack workspace for an account.
 *
 * The user must have already connected their Slack workspace and account to the
 * space, otherwise this function will throw a NotFoundError.
 */
export async function enableNotificationsToSlack(
    context: ServerActionContext,
    {
        spaceId,
        workspaceId,
        accountId,
    }: {spaceId: SpaceId; workspaceId?: string; accountId: AccountId},
) {
    await authorizeOwnSpaceAccountAccess(context, accountId);

    const slackAccount = await getConnectedSlackAccountIfExists(
        context,
        {
            spaceId,
            workspaceId,
            accountId,
        },
        {consistency: "Strong"},
    );

    if (!slackAccount) {
        throw new NotFoundError("Slack account not found");
    }

    const currentTime = new Date();

    await NotificationsTable.updateItem(
        context,
        {
            partitionType: "PushTargets",
            sortRangeType: "SlackIntegration",
            accountId,
            spaceId,
            workspaceId: slackAccount.workspaceId,
        },
        item => {
            item ??= {
                partitionType: "PushTargets",
                sortRangeType: "SlackIntegration",
                accountId,
                spaceId,
                workspaceId: slackAccount.workspaceId,
                slackUserId: slackAccount.slackUserId,
                createdTime: currentTime,
                lastUpdatedTime: currentTime,
            };
            return item;
        },
    );
}
