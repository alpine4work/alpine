import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SlackWorkspace} from "~/shared/integrations/slack/slack_space_integration_schema.js";

/**
 * Connects a Slack workspace to a space by creating a new integration item in the
 * database. If a workspace is already connected to the space or the actor does not
 * have admin access, this function will throw an error.
 */
export async function createSlackWorkspaceIntegration(
    context: ServerSessionActionContext,
    {
        spaceId,
        workspaceId,
        workspaceName,
        workspaceImageUrl,
        botToken,
        botUserId,
        botScopes,
    }: Omit<SlackWorkspace, "connectedTime" | "connectedByAccountId"> & {
        spaceId: SpaceId;
        botToken: string;
        botUserId: string;
        botScopes: Set<string>;
    },
): Promise<SlackWorkspace> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    const currentTime = new Date();
    const connectingAccountId = context.actor.getAccountId();

    const transactionEntries = [
        IntegrationsTable.transactionCreateItem({
            partitionType: "SlackSpaceIntegration",
            sortRangeType: "SlackWorkspace",
            spaceId,
            workspaceId,
            workspaceName,
            workspaceImageUrl,
            connectedTime: currentTime,
            connectedByAccountId: connectingAccountId,
        }),
        IntegrationsTable.transactionCreateItem({
            partitionType: "SlackSpaceIntegration",
            sortRangeType: "SlackWorkspaceBot",
            spaceId,
            workspaceId,
            botToken,
            botUserId,
            botScopes,
            createdTime: currentTime,
        }),
    ];

    await DynamoTableSchema.executeTransaction(context, transactionEntries);

    return {
        workspaceId,
        workspaceName,
        workspaceImageUrl,
        connectedTime: currentTime,
        connectedByAccountId: connectingAccountId,
    };
}
