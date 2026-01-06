import {fromDate} from "@internationalized/date";
import {getAccountTimeZoneIfExists} from "~/server/accounts/with_spaces/get_account_time_zone_if_exists.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {assertScheduleDateTime} from "~/server/notifications/core/schedule_date_time.js";
import {computeDigestNotificationsNextScheduledDateTime} from "~/server/notifications/data/digest/compute_digest_notifications_next_scheduled_date_time.js";
import {getNotificationDigestContent} from "~/server/notifications/data/digest/get_notification_digest_content.js";
import {isInboxEligibleForDigestNotification} from "~/server/notifications/data/digest/is_inbox_eligible_for_digest_notification.js";
import {InboxAttributesItem, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getLatestEmailAddressByAccountId} from "~/server/spaces/get_latest_email_address_by_account_id.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

// Verify time is still a valid time for this inbox's schedule just in case their schedule has
// changed. Specifying a lag time of 0 ensures we'll get back the same time if it's still valid.
function isSendTimeEqualToExpectedScheduledDigestTime({
    timeZone,
    sendTime,
    inboxItem,
}: {
    timeZone: TimeZone | null;
    sendTime: Date;
    inboxItem: InboxAttributesItem;
}) {
    const expectedScheduledDigestTime = computeDigestNotificationsNextScheduledDateTime(
        sendTime,
        timeZone,
        inboxItem.digestNotificationsSchedule,
        {lagTimeInMinutes: 0},
    );
    return sendTime.getTime() === expectedScheduledDigestTime?.getTime();
}

/**
 * Sends a digest notification email for the given inbox. Checks if the given account is not a bot, has
 * space access, and is eligible to receive a digest. If not, we still update `digestNotificationsLastSentTime`
 * to ensure they are not eligible again until their inbox is updated.
 */
export async function sendNotificationDigestForInbox(
    context: Context<ServerSystemActionContextModules & {email: EmailContextModuleBase}>,
    sendTime: Date,
    {accountId, spaceId}: {accountId: AccountId; spaceId: SpaceId},
) {
    assertScheduleDateTime(sendTime, "sendTime must be a valid ScheduleDateTime");
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    // We only want to send an email once, so if we have to retry the dynamo transaction below but
    // have already sent an email, we need to make sure we don't send it again.
    let hasSent = false;

    return context.dynamo.retryTransaction(async context => {
        const inboxItem = await InboxTable.getItem(context, {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId,
        });

        let shouldSend = false;

        const timeZone =
            (await getAccountTimeZoneIfExists(context, inboxItem.accountId)) ?? defaultTimeZone;

        if (
            (inboxItem.digestNotificationsLastSentTime?.getTime() ?? 0) < sendTime.getTime() &&
            isInboxEligibleForDigestNotification(context, inboxItem) &&
            isSendTimeEqualToExpectedScheduledDigestTime({timeZone, sendTime, inboxItem})
        ) {
            shouldSend = true;
        }
        if (!hasSent && shouldSend) {
            const [emailAddress, {name: spaceName}, digestContent, unsubscribeUrl] =
                await runAllPromises([
                    getLatestEmailAddressByAccountId(context, accountId),
                    getSpace(context, inboxItem.spaceId),
                    getNotificationDigestContent(context, {
                        spaceId: inboxItem.spaceId,
                        accountId: inboxItem.accountId,
                    }),
                    context.email.getSignedUnsubscribeUrlForAppService({
                        accountId,
                        spaceId,
                        emailType: "NotificationDigest",
                        baseUrl: context.constants.edgeServiceUrl,
                    }),
                ]);

            const localizedDigestTime = fromDate(sendTime, timeZone);
            await context.email.send({
                fromEmailAddressAlias: "Inbox",
                toEmailAddress: emailAddress,
                templateName: "NotificationDigest",
                templateProps: {
                    locale: defaultLocale,
                    localizedDigestTime,
                    spaceName,
                    digestContent,
                    unsubscribeUrl,
                },
            });
            hasSent = true;
        }

        const newInboxItem = inboxItem.update({
            digestNotificationsLastSentTime: sendTime,
            digestNotificationsNextScheduledDateTime: null,
        });

        await InboxTable.directlyUpdateItem(context, newInboxItem);
    });
}
