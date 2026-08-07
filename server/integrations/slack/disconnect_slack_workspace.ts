import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {deleteSlackWorkspaceIntegration} from "~/server/integrations/slack/delete_slack_workspace_integration.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Disconnects a Slack workspace from a space by uninstalling the Alpine app from
 * the Slack workspace and deleting the workspace integration from our database.
 *
 * The actor must have admin access to the space to disconnect a workspace.
 */
export async function disconnectSlackWorkspace(
    context: ServerSessionActionContext & {slack: SlackContextModuleBase},
    {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId: string},
) {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    // Uninstall the Alpine app from the Slack workspace before disconnecting the
    // workspace so we still have the bot token.
    const result = await context.slack.uninstallAlpineAppFromSlackWorkspace(context, {spaceId});

    if (result.ok) {
        await deleteSlackWorkspaceIntegration(context, {
            spaceId,
            workspaceId,
        });
    }

    if (!result.ok) {
        throw result.error;
    }
}
