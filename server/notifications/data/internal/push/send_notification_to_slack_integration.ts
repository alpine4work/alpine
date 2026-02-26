import {ServerActionContext} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {sendDirectMessageAsAlpineApp} from "~/server/integrations/slack/send_direct_message_as_alpine_app.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function sendNotificationToSlackIntegration(
    context: ServerActionContext & {slack: SlackContextModuleBase},
    {
        spaceId,
        accountId,
        workspaceId,
        alertContent,
        entryPath,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        workspaceId: string;
        alertContent: {title: string; subtitle?: string; body: string};
        entryPath: string;
    },
) {
    await authorizeSpaceAccess(context, spaceId);

    const entryUrl = `${context.constants.edgeServiceUrl}${entryPath}`;

    await sendDirectMessageAsAlpineApp(context, {
        spaceId,
        accountId,
        workspaceId,

        template: {
            templateName: "SlackAlpineNotification",
            templateArgs: {
                title: alertContent.title,
                subtitle: alertContent.subtitle,
                body: alertContent.body,
                entryUrl,
            },
        },
    });
}
