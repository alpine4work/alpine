import {
    ServerActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {WebPushContextModule} from "~/server/context/web_push_context_module.js";
import {SendWebPushNotificationJobDescription} from "~/server/jobs/core/job_description.js";
import {sendAllPendingSubtleNotifications} from "~/server/notifications/data/internal/push/send_all_pending_subtle_notifications.js";
import {sendPendingSubtleNotificationsForInbox} from "~/server/notifications/data/internal/push/send_pending_subtle_notifications_for_inbox.js";
import {sendWebPushNotificationToSubscription} from "~/server/notifications/data/internal/push/send_web_push_notification_to_subscription.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

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

export async function processSendAllPendingSubtleNotificationsJob(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    jobStartTime: Date,
) {
    await sendAllPendingSubtleNotifications(context, {sendTime: jobStartTime});
}

export async function processSendPendingSubtleNotificationsForInboxJob(
    context: Context<ServerSystemActionContextModules & {webPush: WebPushContextModule}>,
    {accountId, spaceId, sendTime}: {accountId: AccountId; spaceId: SpaceId; sendTime: Date},
) {
    await sendPendingSubtleNotificationsForInbox(context, {accountId, spaceId, sendTime});
}
