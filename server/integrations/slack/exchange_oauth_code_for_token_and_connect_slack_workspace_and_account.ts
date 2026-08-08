import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {generateSlackMessageBodyFromTemplate} from "~/server/integrations/slack/internal/message_templates/slack_message_templates.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Exchanges a short-lived OAuth code for an access token and connects a Slack
 * workspace and/or Slack account.
 *
 * If the Slack workspace is already connected to the space, we will connect only
 * the Slack account, otherwise both the Slack workspace and Slack account are
 * connected.
 */
export async function exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
    context: ServerSessionActionContext & {slack: SlackContextModuleBase},
    {code, spaceId}: {code: string; spaceId: SpaceId},
) {
    await authorizeSpaceAccess(context, spaceId);

    const [{workspaceId, slackUserId, botToken, botUserId, botScopes}, existingSlackWorkspace] =
        await runAllPromises([
            context.slack.exchangeShortLivedOAuthCodeForAccessToken(context, {code, spaceId}),
            getConnectedSlackWorkspaceIfExists(
                context,
                {
                    spaceId,
                },
                {consistency: "Strong"},
            ),
        ]);

    // We only allow connecting one workspace per space, but the user could have chosen
    // a different workspace in the Slack OAuth interface. We hint to Slack that they
    // should use a specific workspace, but we can't limit which workspace the user
    // ultimately chooses. So we check if the workspace they gave us permissions for is
    // the same one that's already connected, and if not, we throw an error.
    if (existingSlackWorkspace && existingSlackWorkspace.workspaceId !== workspaceId) {
        throw new FailedPreconditionError(
            "The workspace ID in the OAuth response does not match the existing workspace ID",
            {
                displayMessage: errorDisplayMessage`The Slack workspace you\u2019ve selected does not match the one connected to this space.`,
            },
        );
    }

    // The bot token is now cached in context.slack for this request cycle, so the
    // getUserProfile and getWorkspaceInfo calls below share a single authenticated
    // WebClient without hitting the database again.
    const [userProfile, workspaceInfo, space] = await runAllPromises([
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

        const {text, blocks} = generateSlackMessageBodyFromTemplate(
            "SlackAccountConnectedSuccess",
            {spaceName: space.name, spaceId, edgeServiceUrl: context.constants.edgeServiceUrl},
        );
        await context.slack.sendDirectMessageAsAlpineApp(context, {
            spaceId,
            slackUserId,
            text,
            blocks,
        });

        return {slackWorkspace: existingSlackWorkspace, slackAccount};
    } else {
        const slackWorkspace = await createSlackWorkspaceIntegration(context, {
            spaceId,
            workspaceId,
            workspaceName: workspaceInfo.workspaceName,
            workspaceImageUrl: workspaceInfo.workspaceImageUrl,
            workspaceUrl: workspaceInfo.workspaceUrl,
            botToken,
            botUserId,
            botScopes,
        });

        const {text, blocks} = generateSlackMessageBodyFromTemplate(
            "SlackWorkspaceConnectedSuccess",
            {spaceName: space.name, spaceId, edgeServiceUrl: context.constants.edgeServiceUrl},
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
