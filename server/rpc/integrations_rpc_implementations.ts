import {deleteSlackAccountIntegration} from "~/server/integrations/slack/delete_slack_account_integration.js";
import {disconnectSlackWorkspace} from "~/server/integrations/slack/disconnect_slack_workspace.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/integrations_rpc_definitions.js";

export default implementRpcs(definitions, {
    disconnectSlackWorkspace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await disconnectSlackWorkspace(context.actor.authorizeSession(), input);
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
