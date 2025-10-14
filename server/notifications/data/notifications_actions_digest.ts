import {ZonedDateTime, fromDate, minDate, parseTime} from "@internationalized/date";
import {getAccountTimeZoneIfExists} from "~/server/accounts/with_spaces/accounts_timezone_actions.js";
import {
    ServerActionContext,
    ServerActionContextModules,
    ServerSessionActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    ScheduleDateTime,
    assertScheduleDateTime,
} from "~/server/notifications/core/schedule_date_time.js";
import {
    InboxAttributesItem,
    InboxEntriesIndex,
    InboxTable,
    NotificationDigestEntriesIndex,
} from "~/server/notifications/data/internal/notifications_realtime_table.js";
import {
    getInitialInboxItem,
    getOurAccountInboxItems,
} from "~/server/notifications/data/notifications_actions.js";
import {
    authorizeNotBotSpaceAccount,
    authorizeSpaceAccess,
    getAccountWithoutAvatar,
    getLatestEmailAddress,
    getOurAccountSpaceIds,
    getSpace,
    isAccountMemberOfSpace,
} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {PartialBy} from "~/shared/helpers/types/partial_by.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getInboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {getEncodedInboxEntryPath} from "~/shared/notifications/inbox_model.js";
import {DigestNotificationsSchedule} from "~/shared/notifications/notifications_schedule_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Determines if an inbox is potentially eligible to receive a digest notification.
 */
export async function isInboxEligibleForDigestNotification(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        entryCount,
        lastEntryUpdatedTime,
        digestNotificationsOptedOutTime,
        digestNotificationsSchedule,
        digestNotificationsLastSentTime,
    }: PartialBy<
        Pick<
            InboxAttributesItem,
            | "spaceId"
            | "accountId"
            | "entryCount"
            | "lastEntryUpdatedTime"
            | "digestNotificationsOptedOutTime"
            | "digestNotificationsLastSentTime"
            | "digestNotificationsSchedule"
        >,
        "digestNotificationsSchedule"
    >,
) {
    if (digestNotificationsOptedOutTime) {
        return false;
    }
    if (!digestNotificationsSchedule || digestNotificationsSchedule.size === 0) {
        return false;
    }
    // If this inbox has no unarchived entries, it should not receive a digest
    if (entryCount === 0) {
        return false;
    }
    if (!(await isAccountMemberOfSpace(context, spaceId, accountId))) {
        return false;
    }
    // If we've already sent a digest notification since the latest entry update, they've already received
    // a digest from this inbox so we don't need to send another one. This allows us to ensure stale
    // retries don't cause us to send out of date digests. Uses a 50ms uncertainty window to account
    // for clock skew.
    if (
        digestNotificationsLastSentTime &&
        lastEntryUpdatedTime &&
        isDateDefinitelyLessThanWithUncertaintyWindow(
            lastEntryUpdatedTime,
            digestNotificationsLastSentTime,
            50,
        )
    ) {
        return false;
    }
    return true;
}

/**
 * Computes the next date and time when we should send a digest notification to an account.
 *
 * To determine when an account's next digest should be sent, we look for the closest future
 * time within their schedule from the perspective of the account's current local time.
 * Scheduled times that are earlier than the current local time are treated as tomorrow
 * (e.g. at 15:00 local, a schedule time of 08:00 is treated as 08:00 local tomorrow).
 *
 * Optionally, you can provide a `lagTimeInMinutes` which acts as if the current time is ahead by
 * that amount. This is useful if you'd like to ensure you don't receive a schedule time that is
 * too close to the current time and could cause downstream systems to receive a time that has
 * already passed.
 */
export function computeDigestNotificationsNextScheduledDateTime(
    currentTime: Date,
    timeZone: TimeZone | null,
    digestNotificationsSchedule: DigestNotificationsSchedule,
    options: {lagTimeInMinutes: number} = {lagTimeInMinutes: 0},
): ScheduleDateTime | null {
    // If we receive no time zone, use our default so the user will still get digests, even if
    // they are at the wrong time(s). The default is 'America/New_York', so digests will be at
    // least roughly correct for most US users.
    const actualTimeZone = timeZone ?? defaultTimeZone;

    const currentAccountDateTime = fromDate(currentTime, actualTimeZone);

    const adjustedCurrentTime = options.lagTimeInMinutes
        ? currentAccountDateTime.add({minutes: options.lagTimeInMinutes})
        : currentAccountDateTime;

    let closestZonedDateTime: ZonedDateTime | null = null;
    for (const scheduledHour of digestNotificationsSchedule) {
        const time = parseTime(scheduledHour);
        const scheduledDateTime = adjustedCurrentTime.set({
            hour: time.hour,
            minute: time.minute,
            second: 0,
            millisecond: 0,
        });
        if (scheduledDateTime.compare(adjustedCurrentTime) >= 0) {
            closestZonedDateTime ??= scheduledDateTime;
            closestZonedDateTime = minDate(closestZonedDateTime, scheduledDateTime);
        } else {
            const nextDayScheduledDateTime = scheduledDateTime.add({days: 1});
            closestZonedDateTime ??= nextDayScheduledDateTime;
            closestZonedDateTime = minDate(closestZonedDateTime, nextDayScheduledDateTime);
        }
    }

    return closestZonedDateTime ? assertScheduleDateTime(closestZonedDateTime.toDate()) : null;
}

/**
 * Computes the next date and time when we should send a digest notification to an account or
 * returns null if they are not eligible to receive one.
 *
 * See `computeDigestNotificationsNextScheduledDateTime` for the time computation logic and
 * `isInboxEligibleForDigestNotification` for the eligibility logic.
 */
export async function computeDigestNotificationsNextScheduledDateTimeIfEligible(
    context: ServerActionContext,
    {
        currentTime,
        timeZone,
        inboxItem,
        options = {lagTimeInMinutes: 0},
    }: {
        currentTime: Date;
        timeZone: TimeZone | null;
        inboxItem: InboxAttributesItem;
        options: {lagTimeInMinutes: number};
    },
): Promise<ScheduleDateTime | null> {
    return (await isInboxEligibleForDigestNotification(context, inboxItem))
        ? computeDigestNotificationsNextScheduledDateTime(
              currentTime,
              timeZone,
              inboxItem.digestNotificationsSchedule,
              options,
          )
        : null;
}

/**
 * Notifies the inbox if an account's time zone changes and updates the next scheduled digest time if eligible.
 */
export async function notifyInboxOfTimeZoneChange(
    context: ServerSessionActionContext,
    newTimeZone: TimeZone,
) {
    const spaceIds = await getOurAccountSpaceIds(context);
    const inboxItems = await getOurAccountInboxItems(context, spaceIds.spaceIds, {
        consistency: "Strong",
    });
    const currentTime = new Date();

    await runAllPromises(
        inboxItems.map(async inboxItem => {
            const newScheduledDigest =
                await computeDigestNotificationsNextScheduledDateTimeIfEligible(context, {
                    currentTime,
                    timeZone: newTimeZone,
                    inboxItem,
                    options: {lagTimeInMinutes: 60},
                });

            if (newScheduledDigest !== inboxItem.digestNotificationsNextScheduledDateTime) {
                await InboxTable.updateItem(
                    context,
                    {
                        partitionType: "Account",
                        sortRangeType: "InboxAttributes",
                        spaceId: inboxItem.spaceId,
                        accountId: inboxItem.accountId,
                    },
                    item => {
                        assert(item, "Can’t update time zone for inbox that no longer exists");
                        return {
                            ...item,
                            digestNotificationsNextScheduledDateTime: newScheduledDigest,
                        };
                    },
                    {initialItem: inboxItem},
                );
            }
        }),
    );
}

//NOTE (rmtobin, 10/06/25): If we end up with too many digests to be sent per partition, we can run
// more than one instance of this function and give it a sort key range on `accountId`.
/**
 * Spawns `SendNotificationDigest` jobs to send scheduled digest notifications for all accounts that
 * are scheduled to receive a digest at the given time.
 */
export async function sendScheduledDigestsForTime(
    context: Context<{jobs: JobsContextModule} & Omit<ServerActionContextModules, "actor">>,
    digestTime: Date,
) {
    // Round to the next hour to match index partition keys
    const nextHour = fromDate(digestTime, "UTC")
        .add({hours: 1})
        .set({minute: 0, second: 0})
        .toDate();
    const result = NotificationDigestEntriesIndex.query(context, {
        partitionKey: {digestNotificationsNextScheduledDateTime: assertScheduleDateTime(nextHour)},
        limit: "All",
    });
    await parallelMapAsyncIterableToArray(result, async item => {
        await context.jobs.sendAndWait({
            type: "SendNotificationDigest",
            accountId: item.accountId,
            spaceId: item.spaceId,
            sendTime: digestTime,
        });
    });
}

// Verify time is still a valid time for this inbox's schedule just in case their schedule has
// changed. Specifying a lag time of 0 ensures we'll get back the same time if it's still valid.
async function isSendTimeEqualToExpectedScheduledDigestTime(
    context: ServerActionContext,
    sendTime: Date,
    inboxItem: InboxAttributesItem,
) {
    const timeZone = await getAccountTimeZoneIfExists(context, inboxItem.accountId);
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

        if (
            (inboxItem.digestNotificationsLastSentTime?.getTime() ?? 0) < sendTime.getTime() &&
            (await isInboxEligibleForDigestNotification(context, inboxItem)) &&
            (await isSendTimeEqualToExpectedScheduledDigestTime(context, sendTime, inboxItem))
        ) {
            shouldSend = true;
        }
        if (!hasSent && shouldSend) {
            const [emailAddress, {name: spaceName}, digestContent, unsubscribeUrl, timeZone] =
                await runAllPromises([
                    getLatestEmailAddress(context, accountId),
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
                    getAccountTimeZoneIfExists(context, accountId),
                ]);

            await context.email.send({
                fromEmailAddressAlias: "Notifications",
                toEmailAddress: emailAddress,
                templateName: "NotificationDigest",
                templateProps: {
                    locale: defaultLocale,
                    localizedDigestTime: fromDate(sendTime, timeZone as TimeZone),
                    spaceName,
                    digestContent,
                    baseUrl: context.constants.edgeServiceUrl,
                    unsubscribeUrl,
                },
            });
            hasSent = true;
        }

        const newInboxItem = {
            ...inboxItem,
            digestNotificationsLastSentTime: sendTime,
            digestNotificationsNextScheduledDateTime: null,
        };

        await InboxTable.directlyUpdateItem(context, newInboxItem);
    });
}

const digestEntryDisplayLimit = 8;

/**
 * Gets the content for a digest notification email for the given inbox.
 */
export async function getNotificationDigestContent(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    await runAllPromises([
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
        authorizeSpaceAccess(context, spaceId),
    ]);

    const [currentAccount, entries] = await runAllPromises([
        getAccountWithoutAvatar(context, spaceId, accountId),
        InboxEntriesIndex.realtimeQuery(context, {
            partitionKey: {spaceId, accountId},
            endSortKey: {
                isArchived: false,
                generation: InboxEntriesIndex.sortKeyAttributes.generation.maxValue,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
            },
            // We add 51 to the limit so we can display the count of remaining entries, up to 50+
            limit: digestEntryDisplayLimit + 51,
        }),
    ]);

    const parsedEntries = entries.items.slice(0, digestEntryDisplayLimit).map(entry => {
        const entryDisplay = getInboxEntryDisplayContent({
            entry: entry.model,
            locale: defaultLocale,
            currentAccount,
        });
        const selectedSearchParam = getEncodedInboxEntryPath(entry.model, "wide");

        const summary = entryDisplay.summary.map(item => {
            if (typeof item === "string") {
                return item;
            } else {
                assert(
                    item instanceof AccountModel,
                    "Received non-account item in InboxEntryDisplayContentSummary",
                );
                return {
                    type: "Account",
                    name: getAccountShortNameWithoutFullNameTooltip(item.initialData),
                } as const;
            }
        });

        const showLatestMessage =
            entryDisplay.latestMessage && entryDisplay.latestMessage.contentTextSnippet.length > 0;
        return {
            url: new URL(
                `/s/${entry.model.spaceId}/inbox?selected=${selectedSearchParam}`,
                context.constants.edgeServiceUrl,
            ),
            summary,
            preview: showLatestMessage
                ? `${getAccountShortNameWithoutFullNameTooltip(
                      entryDisplay.latestMessage.author.initialData,
                  )}: ${entryDisplay.latestMessage.contentTextSnippet}`
                : null,
            brandIconType: entryDisplay.brandIconType,
            time: entryDisplay.time,
            loudNotificationCount: entry.model.loudNotificationCount,
            firstAccount: entryDisplay.firstAccount.initialData,
            secondAccount: entryDisplay.secondAccount?.initialData,
        };
    });

    const remainingEntryCount = Math.max(entries.items.length - digestEntryDisplayLimit, 0);
    const digestContent = {
        inboxUrl: new URL(`/s/${spaceId}/inbox`, context.constants.edgeServiceUrl),
        digestEntries: parsedEntries,
        remainingEntryCount,
    };

    return digestContent;
}

export async function unsubscribeFromDigestNotificationsEmail(
    context: ServerSessionActionContext,
    {
        accountId,
        spaceId,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
    },
) {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const currentTime = new Date();

    await InboxTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId,
        },
        item => {
            item ??= getInitialInboxItem(spaceId, accountId);
            if (item.digestNotificationsOptedOutTime !== null) return item;
            return {
                ...item,
                digestNotificationsOptedOutTime: currentTime,
            };
        },
    );
}

export async function subscribeToDigestNotificationsEmail(
    context: ServerSessionActionContext,
    {
        accountId,
        spaceId,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
    },
) {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await InboxTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId,
        },
        item => {
            item ??= getInitialInboxItem(spaceId, accountId);
            if (item.digestNotificationsOptedOutTime === null) return item;
            return {
                ...item,
                digestNotificationsOptedOutTime: null,
            };
        },
    );
}
