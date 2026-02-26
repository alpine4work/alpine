import {deleteSlackAccountIntegration} from "~/server/integrations/slack/delete_slack_account_integration.js";
import {deleteSlackWorkspaceIntegration} from "~/server/integrations/slack/delete_slack_workspace_integration.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/integrations_rpc_definitions.js";

export default implementRpcs(definitions, {
    disconnectSlackWorkspace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            // Uninstall the Alpine app from the Slack workspace before disconnecting the workspace
            // so we still have the bot token.
            await context.slack.uninstallAlpineAppFromSlackWorkspace(
                context.actor.authorizeSession(),
                {spaceId: input.spaceId},
            );
            await deleteSlackWorkspaceIntegration(context.actor.authorizeSession(), input);
            return {};
        },
    },
    disconnectSlackAccount: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const authorizedContext = context.actor.authorizeSession();
            await deleteSlackAccountIntegration(authorizedContext, {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
                accountId: authorizedContext.actor.getAccountId(),
            });
            return {};
        },
    },
});
