import {getAccountTimeZoneIfExists} from "~/server/accounts/with_spaces/accounts_actions_settings.js";
import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {computeDigestNotificationsNextScheduledDateTimeIfEligible} from "~/server/notifications/data/digest/compute_digest_notifications_next_scheduled_date_time_if_eligible.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {
    InboxAttributesItem,
    InboxEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {
    sendPushNotificationToAccountDevices,
    shouldSendPushNotification,
} from "~/server/notifications/data/internal/send_push_notification_to_account_devices.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {Context} from "~/shared/context/context.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryKey} from "~/shared/notifications/inbox_model.js";

/**
 * Archives an inbox entry, moving it out of the account's primary inbox and
 * into an archive. The user can still manually revive archived inbox entries
 * if desired.
 *
 * If the user sends a message to a chat and that implicitly archives the inbox
 * entry, that doesn't happen through this function. Instead it happens through
 * `processNotificationEvent()`.
 */
export async function archiveInboxEntry(
    context: Context<ServerSessionActionContextModules & {apns: ApnsContextModuleBase}>,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<{archiveTime: Date}> {
    return archiveInboxEntryItemKey(
        context,
        getInboxEntryItemKey({
            spaceId,
            accountId: context.actor.getAccountId(),
            key,
        }),
    );
}

// TODO(#NOTIFICATIONS): Test archiving an inbox entry updates the digest notifications next
// scheduled time
async function archiveInboxEntryItemKey(
    context: Context<ServerSessionActionContextModules & {apns: ApnsContextModuleBase}>,
    itemKey: InboxEntryItemKey,
): Promise<{archiveTime: Date}> {
    await runAllPromises([
        authorizeSpaceAccess(context, itemKey.spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, itemKey.spaceId, itemKey.accountId),
    ]);

    const {archiveTime, newInboxEntryItem, loudNotificationCountDifference} =
        await context.dynamo.retryTransaction(async context => {
            const currentTime = new Date();

            const [inboxItem, inboxEntryItem, accountTimeZone] = await runAllPromises([
                InboxTable.getItemIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId: itemKey.spaceId,
                    accountId: itemKey.accountId,
                }),
                InboxTable.getItemIfExists(context, itemKey),
                getAccountTimeZoneIfExists(context, itemKey.accountId),
            ]);

            if (!inboxEntryItem) throw new NotFoundError("Inbox entry not found");

            assert(
                inboxItem,
                "Can’t have inbox entry item without corresponding inbox attributes item",
            );

            // If the inbox entry item is already archived, do nothing.
            if (inboxEntryItem.isArchived) {
                return {
                    archiveTime: inboxEntryItem.enteredTime,
                    newInboxItem: inboxItem,
                    newInboxEntryItem: inboxEntryItem,
                    loudNotificationCountDifference: 0,
                };
            }

            let newInboxEntryItem = {
                ...inboxEntryItem,
                isArchived: true,
                // Archiving an entry clears all of its loud notifications.
                loudNotificationCount: 0,
                // When we archive an item it goes back to our inbox generation. That way if
                // it's unarchived it doesn't go back into the loud notification generation.
                generation: inboxItem.generation,
                // When we archive an item, it goes to the top of the archive.
                enteredTime: currentTime,
            };

            // Clear out the `isStickyMention` property for messaging entries.
            if (
                "latestMessage" in newInboxEntryItem &&
                newInboxEntryItem.latestMessage.isStickyMention
            ) {
                newInboxEntryItem = {
                    ...newInboxEntryItem,
                    latestMessage: {
                        ...newInboxEntryItem.latestMessage,
                        isStickyMention: false,
                    },
                };
            }

            // Clear out the `isStickyMention` property for messaging entries.
            if (
                "latestComment" in newInboxEntryItem &&
                newInboxEntryItem.latestComment?.isStickyMention
            ) {
                newInboxEntryItem = {
                    ...newInboxEntryItem,
                    latestComment: {
                        ...newInboxEntryItem.latestComment,
                        isStickyMention: false,
                    },
                };
            }

            // When archiving a channel posts entry, all `PostId`s in the entry are now
            // considered archived.
            if (newInboxEntryItem.sortRangeType === "ChannelPostsEntry") {
                newInboxEntryItem = {
                    ...newInboxEntryItem,
                    archivedPostIds: newInboxEntryItem.postIds,
                };
            }

            // `Math.max` to protect against in case we under-counted the number of inbox
            // entries at some point.
            const newEntryCount = Math.max(0, inboxItem.entryCount - 1);

            let newInboxItem: InboxAttributesItem = {
                ...inboxItem,
                loudNotificationCount:
                    inboxItem.loudNotificationCount - inboxEntryItem.loudNotificationCount,
                entryCount: newEntryCount,
                lastZeroEntryCountTime:
                    newEntryCount === 0 && inboxItem.entryCount !== 0
                        ? currentTime
                        : inboxItem.lastZeroEntryCountTime,
                lastEntryUpdatedTime: currentTime,
            };

            newInboxItem = {
                ...newInboxItem,
                digestNotificationsNextScheduledDateTime:
                    computeDigestNotificationsNextScheduledDateTimeIfEligible(context, {
                        currentTime,
                        timeZone: accountTimeZone,
                        inboxItem: newInboxItem,
                        options: {lagTimeInMinutes: 60},
                    }),
            };

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                InboxTable.transactionDirectlyUpdateItem(newInboxItem),
                InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
            ]);

            return {
                archiveTime: currentTime,
                newInboxItem,
                newInboxEntryItem,
                loudNotificationCountDifference: -inboxEntryItem.loudNotificationCount,
            };
        });

    // If we're archiving an entry with loud notifications, we need to send an
    // alert to Apple devices to update the badge count.
    if (loudNotificationCountDifference !== 0) {
        assert(newInboxEntryItem.isArchived);

        if (shouldSendPushNotification()) {
            // NOTE(calebmer): Consider turning this into a job on the job queue to
            // guarantee notification delivery.
            context.process.waitUntil(
                sendPushNotificationToAccountDevices(context, {
                    accountId: context.actor.getAccountId(),
                    eventId: generateChronologicalId(),
                    newInboxEntryItem,
                    loudNotificationCountDifference,
                }),
            );
        }
    }

    return {archiveTime};
}
