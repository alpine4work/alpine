import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    IntegrationsTable,
    SlackUserIntegrationItem,
} from "~/server/integrations/internal/integrations_table.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function getConnectedSlackAccountIfExists(
    context: ServerActionContext,
    {
        spaceId,
        workspaceId,
        accountId,
    }: {spaceId: SpaceId; workspaceId?: string; accountId: AccountId},
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<SlackUserIntegrationItem | null> {
    await authorizeOwnSpaceAccountAccess(context, accountId);

    let actualWorkspaceId = workspaceId;

    if (!workspaceId) {
        actualWorkspaceId = (
            await getConnectedSlackWorkspaceIfExists(context, {spaceId}, {consistency})
        )?.workspaceId;
    }

    if (!actualWorkspaceId) {
        return null;
    }

    const slackAccount = await IntegrationsTable.getItemIfExists(
        context,
        {
            partitionType: "SlackSpaceIntegration",
            sortRangeType: "SlackUser",
            spaceId,
            workspaceId: actualWorkspaceId,
            accountId,
        },
        {consistency},
    );

    return slackAccount;
}
