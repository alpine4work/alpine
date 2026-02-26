import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {generateSlackMessageBodyFromTemplate} from "~/server/integrations/slack/internal/message_templates/slack_message_templates.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Exchanges a short-lived OAuth code for an access token and connects a Slack workspace and/or
 * Slack account.
 *
 * If the Slack workspace is already connected to the space, we will connect only the Slack account,
 * otherwise both the Slack workspace and Slack account are connected.
 */
export async function exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
    context: ServerSessionActionContext & {slack: SlackContextModuleBase},
    {code, spaceId}: {code: string; spaceId: SpaceId},
) {
    await authorizeSpaceAccess(context, spaceId);

    const {workspaceId, slackUserId, botToken, botUserId, botScopes} =
        await context.slack.exchangeShortLivedOAuthCodeForAccessToken(context, {code, spaceId});

    // The bot token is now cached in context.slack for this request cycle, so the getUserProfile
    // and getWorkspaceInfo calls below share a single authenticated WebClient without hitting
    // the database again.
    const [existingSlackWorkspace, userProfile, workspaceInfo, space] = await runAllPromises([
        getConnectedSlackWorkspaceIfExists(context, {
            spaceId,
            workspaceId,
        }),
        context.slack.getUserProfile(context, {spaceId, slackUserId}),
        context.slack.getWorkspaceInfo(context, {spaceId, workspaceId}),
        getSpace(context, spaceId),
    ]);

    if (existingSlackWorkspace) {
        const slackAccount = await createSlackAccountIntegration(context, {
            spaceId,
            slackUserId,
            workspaceId,
            displayName: userProfile.displayName,
            realName: userProfile.realName,
            email: userProfile.email,
            profileImageUrl: userProfile.profileImageUrl,
        });

        return {slackWorkspace: existingSlackWorkspace, slackAccount};
    } else {
        const slackWorkspace = await createSlackWorkspaceIntegration(context, {
            spaceId,
            workspaceId,
            workspaceName: workspaceInfo.workspaceName,
            workspaceImageUrl: workspaceInfo.workspaceImageUrl,
            botToken,
            botUserId,
            botScopes,
        });

        const {text, blocks} = generateSlackMessageBodyFromTemplate(
            "SlackWorkspaceConnectedSuccess",
            {
                spaceName: space.name,
                spaceId,
                edgeServiceUrl: context.constants.edgeServiceUrl,
            },
        );

        const [slackAccount] = await runAllPromises([
            createSlackAccountIntegration(context, {
                spaceId,
                slackUserId,
                workspaceId,
                displayName: userProfile.displayName,
                profileImageUrl: userProfile.profileImageUrl,
            }),
            context.slack.sendDirectMessageAsAlpineApp(context, {
                spaceId,
                slackUserId,
                text,
                blocks,
            }),
        ]);

        return {slackWorkspace, slackAccount};
    }
}
