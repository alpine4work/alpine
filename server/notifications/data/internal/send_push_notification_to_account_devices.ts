import {deleteAccountAppleDeviceTokenIfExists} from "~/server/accounts/accounts_actions.js";
import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {getInboxEntryKey} from "~/server/notifications/data/internal/get_inbox_entry_key.js";
import {InboxEntryItem, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {
    getRegisteredAccountDevices,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_actions.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {AccountId, NotificationEventId, SpaceId} from "~/shared/id/types/id_types.js";
import {getInboxEntryKeyPath} from "~/shared/notifications/inbox_model.js";

export function shouldSendPushNotification() {
    // NOTE(rmtobin, 2025-08-21): All push notifications are disabled for now
    // as we don't have anything to push to and our APNs certificate is expired.
    // This will get updated when web push notifications are implemented.
    return false;
}

/**
 * Send push notifications to registered account devices. Only sends a
 * notification if the new inbox entry is not archived OR loud notification
 * counts changed. If the new inbox entry is archived and loud notification
 * counts changed then we'll send an alert with no content (so we won't call
 * `getAlertContent`). If the new inbox entry is not archived then
 * `getAlertContent` must be provided.
 *
 * This function is idempotent. If you call it multiple times with the save
 * `eventId` the user will only see one notification on their device.
 */
export async function sendPushNotificationToAccountDevices(
    context: Context<ServerActionContextModules & {apns: ApnsContextModuleBase}>,
    {
        accountId,
        eventId,
        newInboxEntryItem,
        loudNotificationCountDifference,
        getAlertContent,
    }: {
        accountId: AccountId;
        eventId: NotificationEventId;
        newInboxEntryItem: InboxEntryItem;
        loudNotificationCountDifference: number;
        getAlertContent?: () => Promise<{
            title: string;
            subtitle?: string;
            body: string;
        }>;
    },
) {
    // If we archived an entry (or updated an archived entry) that shouldn't
    // generate a push notification.
    //
    // However, if the loud notification count changed then we need to send a
    // silent push notification updating the badge number.
    if (newInboxEntryItem.isArchived && loudNotificationCountDifference === 0) {
        return;
    }

    return context.tracer.withSpan("Send push notification to devices", (context, span) => {
        // We use `withSendAlert()` as an optimization to connect to APNs in parallel with
        // loading registered account devices. This will be a little wasteful if the
        // user has no Apple devices but it should be fine since we'll have an APN
        // connection later for an account which does have Apple devices.
        return context.apns.withSendAlert(async sendAlert => {
            const getLoudNotificationCount = async () => {
                const loudNotificationCounts = await parallelMapAsyncIterableToArray(
                    InboxTable.query(context, {
                        partitionKey: {
                            partitionType: "Account",
                            accountId,
                        },
                        startSortKey: {
                            sortRangeType: "InboxAttributes",
                            spaceId: DynamoKeyAttributeSchema.id.getMinValue<SpaceId>(),
                        },
                        endSortKey: {
                            sortRangeType: "InboxAttributes",
                            spaceId: DynamoKeyAttributeSchema.id.getMaxValue<SpaceId>(),
                        },
                        limit: "All",
                        // Use strong read consistency. We don't want to update the app notification
                        // badge with a stale count.
                        consistency: "Strong",
                    }),
                    async item => {
                        // Confirm the account is still a member of this space. If an account is
                        // removed from a space we don't clean up their inbox item in case they're
                        // re-added.
                        //
                        // We run the version of this function that doesn't authorize since a system
                        // actor will only have access to one space. Not all the spaces the account
                        // has access to.
                        if (
                            !(await isAccountMemberOfSpaceWithoutAuthorization(
                                context,
                                item.spaceId,
                                item.accountId,
                            ))
                        ) {
                            return 0;
                        }

                        return item.loudNotificationCount;
                    },
                );

                return loudNotificationCounts.reduce((a, b) => a + b, 0);
            };

            const [accountDevices, alertContent, loudNotificationCount] = await runAllPromises([
                getRegisteredAccountDevices(context, accountId),

                // We optimistically build alert content even if we don't need it (e.g. since
                // there are no registered devices).
                //
                // We expect accounts will want to set up push notifications on some device and
                // we want to send them notifications quickly. So it's worth speeding up
                // notification sending even if sometimes it's a little wasteful to load alert
                // content when we don't need it.
                !newInboxEntryItem.isArchived ? assertExists(getAlertContent)() : null,

                // We optimistically get the account's total loud notification count even if we
                // don't need it (e.g. since there are no registered devices).
                //
                // We expect accounts will want to set up push notifications on some device and
                // we want to send them notifications quickly. So it's worth speeding up
                // notification sending even if sometimes it's a little wasteful to load the
                // notification count when we don't need it.
                loudNotificationCountDifference !== 0 ? getLoudNotificationCount() : null,
            ]);

            span.addData({common: {count: accountDevices.length}});

            // Interrupt the user if tge loud notification count increased.
            const isLoud = loudNotificationCountDifference > 0;

            const entryPath = getInboxEntryKeyPath(
                newInboxEntryItem.spaceId,
                getInboxEntryKey(newInboxEntryItem),
                "narrow",
            );

            await runAllPromises(
                accountDevices.map(async accountDevice => {
                    const {wasDeviceTokenUnregistered} = await sendAlert(
                        accountDevice.deviceToken,
                        {
                            entry: entryPath,

                            aps: {
                                alert: alertContent ?? undefined,
                                "thread-id": getApnsNotificationThreadId(newInboxEntryItem),

                                // Update the badge.
                                //
                                // NOTE(calebmer, 2024-06-14): There are likely all kinds of race conditions
                                // with badge updates. For example, let's say we're sending alert A and alert
                                // B. Alert A updates notification count to 3. Alert B dismisses the
                                // notification changing it to 2. If alert A runs on a server which needs to
                                // establish a new APNs connection then alert B may be delivered to the device
                                // first! When alert A is received the notification count will be 3 when in
                                // fact it's 2.
                                //
                                // I can't find a way to set an ordering for APNs notifications. So we need to
                                // find another way to fix this issue when it comes up. Maybe we schedule a
                                // reconciliation job to send an alert 5 minutes from now? Maybe we update the
                                // loud notification count when the app opens? I'm not sure.
                                //
                                // NOTE(calebmer, 2024-07-16): Another idea for a solution. Include a last
                                // modified time on `InboxAttributes` items. If we see a modified time within
                                // the last ten seconds or so schedule a job for three minutes from now to
                                // update the notification count. That way we're guaranteed to set the correct
                                // notification count after everything has settled down.
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

                            // Make sure notification sending is idempotent. If we send the same
                            // notification twice it should be collapsed into one on the user's device.
                            collapseId: eventId,
                        },
                    );

                    // If a device token is unregistered then delete it from our database so we
                    // won't try to use it again.
                    if (wasDeviceTokenUnregistered) {
                        await deleteAccountAppleDeviceTokenIfExists(
                            context,
                            accountId,
                            accountDevice.deviceToken,
                        );
                    }
                }),
            );
        });
    });
}

function getApnsNotificationThreadId(item: InboxEntryItem): string | undefined {
    switch (item.sortRangeType) {
        case "ChatEntry":
            return item.chatId;
        case "PostCommentsEntry":
            return item.postId;
        case "ChannelPostsEntry":
            return `${item.channelId}-${item.bucketGeneration}`;
        case "DocumentCommentThreadEntry":
            // `DocumentCommentThreadId` is only guaranteed to be unique within a document.
            // It may not be unique across documents. Which is why we include the
            // `DocumentId` in the thread ID.
            return `${item.documentId}-${item.commentThreadId}`;
        case "DocumentNewCommentThreadsEntry":
            return `${item.documentId}-${item.bucketGeneration}`;
        case "TaskEntry":
            return item.taskId;
        default:
            throw exhaustive(item);
    }
}
