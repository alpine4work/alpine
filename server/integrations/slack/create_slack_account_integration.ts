import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SlackAccount} from "~/shared/integrations/slack/slack_space_integration_schema.js";

/**
 * Links a Slack account to an existing Slack workspace connection by creating a new integration
 * item in the database. If the account is already connected to the Slack workspace in this space,
 * this function does nothing.
 *
 * This function will throw an error if the actor does not have Space access or
 * if no connected Slack workspace is found for the space.
 */
export async function createSlackAccountIntegration(
    context: ServerSessionActionContext,
    {
        spaceId,
        slackUserId,
        workspaceId,
        displayName,
        realName,
        email,
        profileImageUrl,
    }: Omit<SlackAccount, "connectedTime"> & {
        spaceId: SpaceId;
        workspaceId: string;
        email?: string;
    },
): Promise<SlackAccount> {
    await authorizeSpaceAccess(context, spaceId);

    const slackWorkspace = await getConnectedSlackWorkspaceIfExists(context, {
        spaceId,
        workspaceId,
    });

    if (!slackWorkspace) {
        throw new FailedPreconditionError("No connected Slack workspace found for the space");
    }

    await IntegrationsTable.updateItem(
        context,
        {
            partitionType: "SlackSpaceIntegration",
            sortRangeType: "SlackUser",
            spaceId,
            workspaceId,
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= {
                partitionType: "SlackSpaceIntegration",
                sortRangeType: "SlackUser",
                spaceId,
                workspaceId,
                accountId: context.actor.getAccountId(),
                slackUserId,
                connectedTime: new Date(),
                displayName,
                realName,
                email,
                profileImageUrl,
            };
            return item;
        },
    );

    await context.notificationsInjection.notifyInboxOfSlackIntegrationChange({
        eventType: "connectSlackAccount",
        spaceId,
        workspaceId,
        accountId: context.actor.getAccountId(),
    });

    return {
        slackUserId,
        displayName,
        realName,
        profileImageUrl,
    };
}
