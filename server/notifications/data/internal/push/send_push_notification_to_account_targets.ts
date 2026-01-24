import {PushContextModules} from "~/server/context/push_context_modules.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import type {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {getInboxEntryKey} from "~/server/notifications/data/internal/get_inbox_entry_key.js";
import {InboxEntryItem, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {queuePendingSubtleNotification} from "~/server/notifications/data/internal/push/queue_pending_subtle_notification.js";
import {sendApnsPushNotification} from "~/server/notifications/data/internal/push/send_apns_push_notification.js";
import {sendWebPushNotificationToAllSubscriptions} from "~/server/notifications/data/internal/push/send_web_push_notification_to_all_subscriptions.js";
import {getPushNotificationThreadId} from "~/server/notifications/data/push/get_push_notification_thread_id.js";
import {getAccountWebPushSubscriptionsForSpace} from "~/server/notifications/data/push/get_web_push_subscriptions_for_space.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getInboxEntryKeyPath} from "~/shared/notifications/inbox_model.js";

export function shouldSendApnsPushNotification() {
    // NOTE(rmtobin, 2025-08-21): iOS push notifications are disabled for now
    // as we don't have anything to push to and our APNs certificate is expired.
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
 * This function is idempotent. If you call it multiple times with the same
 * `deduplicationTag` the user will only see one notification on their device.
 */
export async function sendPushNotificationToAccountTargets(
    context: Context<ServerActionContextModules & PushContextModules>,
    {
        accountId,
        deduplicationTag,
        newInboxEntryItem,
        loudNotificationCountDifference,
        notificationEvent,
        getAlertContent,
    }: {
        accountId: AccountId;
        deduplicationTag: string;
        newInboxEntryItem: InboxEntryItem | "Delete";
        loudNotificationCountDifference: number;
        notificationEvent: NotificationEvent;
        getAlertContent: (newInboxEntryItem: InboxEntryItem) => Promise<{
            title: string;
            subtitle?: string;
            body: string;
        }>;
    },
) {
    const isActiveEntry = newInboxEntryItem !== "Delete" && !newInboxEntryItem.isArchived;
    // If we archived an entry (or updated an archived entry) that shouldn't
    // generate a push notification as we do not currently support sending silent background
    // notifications.
    if (!isActiveEntry) {
        return;
    }

    return context.tracer.withSpan("Send push notification to devices", async context => {
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

        const [alertContent, loudNotificationCount, webPushSubscriptions] = await runAllPromises([
            // We optimistically build alert content even if we don't need it (e.g. since
            // there are no registered devices).
            //
            // We expect accounts will want to set up push notifications on some device and
            // we want to send them notifications quickly. So it's worth speeding up
            // notification sending even if sometimes it's a little wasteful to load alert
            // content when we don't need it.
            assertExists(getAlertContent)(newInboxEntryItem),

            // We optimistically get the account's total loud notification count even if we
            // don't need it (e.g. since there are no registered devices).
            //
            // We expect accounts will want to set up push notifications on some device and
            // we want to send them notifications quickly. So it's worth speeding up
            // notification sending even if sometimes it's a little wasteful to load the
            // notification count when we don't need it.
            loudNotificationCountDifference !== 0 ? getLoudNotificationCount() : null,

            getAccountWebPushSubscriptionsForSpace(context, accountId, newInboxEntryItem.spaceId),
        ]);

        // Interrupt the user if the loud notification count increased.
        const isLoud = loudNotificationCountDifference > 0;

        const entryPath = getInboxEntryKeyPath(
            newInboxEntryItem.spaceId,
            getInboxEntryKey(newInboxEntryItem),
            "narrow",
        );

        if (shouldSendApnsPushNotification()) {
            await sendApnsPushNotification(context, {
                accountId,
                deduplicationTag,
                newInboxEntryItem,
                loudNotificationCount,
                alertContent,
                isLoud,
                entryPath,
            });
        }

        // Send web push notifications to browsers.
        // Most browsers require content to be displayed, so if there's no content, there's
        // no need to send a web push notification. Loud notifications are sent immediately,
        // otherwise we queue a quiet notification to be sent at a later time.
        if (webPushSubscriptions.length > 0) {
            if (!isLoud) {
                await queuePendingSubtleNotification(context, {
                    accountId,
                    spaceId: newInboxEntryItem.spaceId,
                    notificationEvent,
                    inboxEntry: newInboxEntryItem,
                });
            } else {
                const title = alertContent.subtitle
                    ? `${alertContent.title} ${alertContent.subtitle}`
                    : alertContent.title;
                await sendWebPushNotificationToAllSubscriptions(context, {
                    spaceId: newInboxEntryItem.spaceId,
                    accountId,
                    subscriptions: webPushSubscriptions,
                    notificationContent: {
                        title,
                        body: alertContent.body,
                        // `silent` refers to whether this notification will make a noise on delivery.
                        // This is different from native 'silent' push notifications where the notification
                        // is used for updates and not displayed - `silent` web push notifications are always displayed.
                        silent: false,
                        // The tag is used to identify a specific notification. Sending the same notification
                        // with the same tag will replace the previous notification.
                        tag: deduplicationTag,
                        data: {
                            url: `${context.constants.edgeServiceUrl}${entryPath}`,
                        },
                    },
                    options: {
                        // Topic is used to group related notifications together on the user's device.
                        topic: getPushNotificationThreadId(newInboxEntryItem),
                        urgency: "high",
                    },
                });
            }
        }
    });
}
