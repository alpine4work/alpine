import {InboxAttributesItem} from "~/server/notifications/data/internal/inbox_table.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {PartialBy} from "~/shared/helpers/types/partial_by.js";

const ineligibleTracerMessage = "Inbox is ineligible for digest notification";

/**
 * Determines if an inbox is potentially eligible to receive a digest notification.
 *
 * Assumes the account is a current member of the space. You need to check that
 * first with `isAccountMemberOfSpace()` outside of this function.
 */
export function isInboxEligibleForDigestNotification(
    context: Context<{tracer: TracerContextModule}>,
    {
        entryCount,
        lastEntryUpdatedTime,
        digestNotificationsOptedOutTime,
        digestNotificationsSchedule,
        digestNotificationsLastSentTime,
    }: PartialBy<
        Pick<
            InboxAttributesItem,
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
        context.tracer.log(ineligibleTracerMessage, {
            notifications: {
                emailDigest: {
                    ineligibleReason: "unsubscribed",
                },
            },
        });
        return false;
    }

    if (!digestNotificationsSchedule || digestNotificationsSchedule.size === 0) {
        context.tracer.log(ineligibleTracerMessage, {
            notifications: {
                emailDigest: {
                    ineligibleReason: "no schedule",
                },
            },
        });
        return false;
    }

    // If this inbox has no unarchived entries, it should not receive a digest
    if (entryCount === 0) {
        context.tracer.log(ineligibleTracerMessage, {
            notifications: {
                emailDigest: {
                    ineligibleReason: "no unarchived entries",
                },
            },
        });
        return false;
    }

    if (!lastEntryUpdatedTime) {
        context.tracer.log(ineligibleTracerMessage, {
            notifications: {
                emailDigest: {
                    ineligibleReason: "`lastEntryUpdatedTime` is null",
                },
            },
        });
        return false;
    }

    // If we've already sent a digest notification since the latest entry update, they've already received
    // a digest from this inbox so we don't need to send another one. This allows us to ensure stale
    // retries don't cause us to send out of date digests. Uses a 50ms uncertainty window to account
    // for clock skew.
    if (
        digestNotificationsLastSentTime &&
        isDateDefinitelyLessThanWithUncertaintyWindow(
            lastEntryUpdatedTime,
            digestNotificationsLastSentTime,
            50,
        )
    ) {
        context.tracer.log(ineligibleTracerMessage, {
            notifications: {
                emailDigest: {
                    ineligibleReason: "already sent digest since last entry update",
                },
            },
        });
        return false;
    }

    return true;
}
