import {ServerActionContext} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {getConnectedSlackWorkspaceBotCredentialsIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_bot_credentials_if_exists.js";
import {
    SlackMessageTemplateArgs,
    SlackMessageTemplates,
    generateSlackMessageBodyFromTemplate,
} from "~/server/integrations/slack/internal/message_templates/slack_message_templates.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {NotFoundError} from "~/shared/error/error.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Sends a direct message to a Slack user as the Alpine app.
 *
 * You must always provide at least a plain `text` value, even if you're sending a
 * Block Kit message. This is used as a fallback for Slack clients that don't
 * render Block Kit (e.g. push notifications, older desktop clients).
 */
export async function sendDirectMessageAsAlpineApp(
    context: ServerActionContext & {slack: SlackContextModuleBase},
    {
        spaceId,
        accountId,
        workspaceId,
        template,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        workspaceId?: string;
        template: {
            templateName: SlackMessageTemplates;
            templateArgs: SlackMessageTemplateArgs<SlackMessageTemplates>;
        };
    },
) {
    await authorizeSpaceAccess(context, spaceId);

    const slackWorkspaceBotCredentials = await getConnectedSlackWorkspaceBotCredentialsIfExists(
        context,
        {spaceId, workspaceId},
    );

    if (!slackWorkspaceBotCredentials) {
        throw new NotFoundError(`Slack workspace integration not found`);
    }

    const slackUserIntegrationItem = await IntegrationsTable.getItemIfExists(context, {
        partitionType: "SlackSpaceIntegration",
        sortRangeType: "SlackUser",
        spaceId,
        workspaceId: slackWorkspaceBotCredentials.workspaceId,
        accountId,
    });

    if (!slackUserIntegrationItem) {
        throw new NotFoundError("Slack user integration not found");
    }

    const {text, blocks} = generateSlackMessageBodyFromTemplate(
        template.templateName,
        template.templateArgs,
    );

    await context.slack.sendDirectMessageAsAlpineApp(context, {
        spaceId,
        slackUserId: slackUserIntegrationItem.slackUserId,
        text,
        blocks,
    });
}
