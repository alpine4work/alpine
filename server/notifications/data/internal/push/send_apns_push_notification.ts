import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {InboxEntryItem} from "~/server/notifications/data/internal/inbox_table.js";
import {deleteAccountAppleDeviceTokenIfExists} from "~/server/notifications/data/push/delete_account_apple_device_token_if_exists.js";
import {getPushNotificationThreadId} from "~/server/notifications/data/push/get_push_notification_thread_id.js";
import {getRegisteredAppleDevicesForAccount} from "~/server/notifications/data/push/get_registered_apple_devices_for_account.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export async function sendApnsPushNotification(
    context: Context<ServerActionContextModules & {apns: ApnsContextModuleBase}>,
    {
        accountId,
        deduplicationTag,
        newInboxEntryItem,
        loudNotificationCount,
        alertContent,
        isLoud,
        entryPath,
    }: {
        accountId: AccountId;
        deduplicationTag: string;
        newInboxEntryItem: InboxEntryItem | "Delete";
        loudNotificationCount: number | null;
        alertContent: {
            title: string;
            subtitle?: string;
            body: string;
        } | null;
        isLoud: boolean;
        entryPath?: string;
    },
) {
    return await context.tracer.withSpan("Send APNs push notification", async (context, span) => {
        const accountDevices = await getRegisteredAppleDevicesForAccount(context, accountId);
        span.addData({common: {count: accountDevices.length}});
        await runAllPromises(
            accountDevices.map(async accountDevice => {
                const {wasDeviceTokenUnregistered} = await context.apns.sendAlert(
                    accountDevice.deviceToken,
                    {
                        entry: entryPath,

                        aps: {
                            alert: alertContent
                                ? {
                                      title: alertContent.title,
                                      subtitle: alertContent.subtitle,
                                      body: alertContent.body,
                                  }
                                : undefined,
                            "thread-id":
                                newInboxEntryItem !== "Delete" && !newInboxEntryItem.isArchived
                                    ? getPushNotificationThreadId(newInboxEntryItem)
                                    : undefined,

                            // Update the badge.
                            //
                            // NOTE(calebmer, 2024-06-14): There are likely all kinds of race conditions with
                            // badge updates. For example, let's say we're sending alert A and alert B. Alert A
                            // updates notification count to 3. Alert B dismisses the notification changing it
                            // to 2. If alert A runs on a server which needs to establish a new APNs connection
                            // then alert B may be delivered to the device first! When alert A is received the
                            // notification count will be 3 when in fact it's 2.
                            //
                            // I can't find a way to set an ordering for APNs notifications. So we need to find
                            // another way to fix this issue when it comes up. Maybe we schedule a
                            // reconciliation job to send an alert 5 minutes from now? Maybe we update the loud
                            // notification count when the app opens? I'm not sure.
                            //
                            // NOTE(calebmer, 2024-07-16): Another idea for a solution. Include a last modified
                            // time on `InboxAttributes` items. If we see a modified time within the last ten
                            // seconds or so schedule a job for three minutes from now to update the
                            // notification count. That way we're guaranteed to set the correct notification
                            // count after everything has settled down.
                            badge: loudNotificationCount ?? undefined,

                            // Only make a sound for loud notifications.
                            sound: isLoud ? "default" : undefined,
                            "interruption-level": isLoud ? "active" : "passive",
                        },
                    },
                    {
                        // If this is a loud notification then send the notification immediately.
                        // Otherwise, we can respect the device's power needs.
                        priority: isLoud ? 10 : 5,

                        // Make sure notification sending is idempotent. If we send the same notification
                        // twice it should be collapsed into one on the user's device.
                        collapseId: deduplicationTag,
                    },
                );

                // If a device token is unregistered then delete it from our database so we won't
                // try to use it again.
                if (wasDeviceTokenUnregistered) {
                    await deleteAccountAppleDeviceTokenIfExists(context, {
                        accountId,
                        deviceToken: accountDevice.deviceToken,
                    });
                }
            }),
        );
    });
}
