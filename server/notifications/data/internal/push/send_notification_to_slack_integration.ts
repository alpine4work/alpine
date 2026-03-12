import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {sendDirectMessageAsAlpineApp} from "~/server/integrations/slack/send_direct_message_as_alpine_app.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function sendNotificationToSlackIntegration(
    context: Context<ServerActionContextModules & {slack: SlackContextModuleBase}>,
    {
        spaceId,
        accountId,
        workspaceId,
        entryPath,
        notificationContent,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        workspaceId: string;
        entryPath: string;
        notificationContent: {title: string; body: string; plainText: string};
    },
) {
    return context.tracer.withSpan(
        "Send Notification to Slack Integration",
        async (context, span) => {
            await runAllPromises([
                authorizeSpaceAccess(context, spaceId),
                authorizeNotBotSpaceAccount(context, spaceId, accountId),
            ]);

            span.addData({slack: {workspaceId}});

            const entryUrl = `${context.constants.edgeServiceUrl}${entryPath}`;

            await sendDirectMessageAsAlpineApp(context, {
                spaceId,
                accountId,
                workspaceId,

                template: {
                    templateName: "SlackAlpineNotification",
                    templateArgs: {
                        title: notificationContent.title,
                        plainText: notificationContent.plainText,
                        body: notificationContent.body,
                        entryUrl,
                    },
                },
            });
        },
    );
}
