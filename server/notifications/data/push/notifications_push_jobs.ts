import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {WebPushContextModule} from "~/server/context/web_push_context_module.js";
import {SendWebPushNotificationJobDescription} from "~/server/jobs/core/job_description.js";
import {sendWebPushNotificationToSubscription} from "~/server/notifications/data/internal/push/send_web_push_notification_to_subscription.js";
import {Context} from "~/shared/context/context.js";

export async function processSendWebPushNotificationJob(
    context: Context<ServerSystemActionContextModules & {webPush: WebPushContextModule}>,
    {
        spaceId,
        accountId,
        browserId,
        notificationContent,
        options,
    }: SendWebPushNotificationJobDescription,
) {
    await sendWebPushNotificationToSubscription(context, {
        spaceId,
        accountId,
        browserId,
        notificationContent,
        options,
    });
}
