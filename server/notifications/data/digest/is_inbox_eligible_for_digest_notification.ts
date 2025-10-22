import {ServerActionContext} from "~/server/context/server_action_context.js";
import {InboxAttributesItem} from "~/server/notifications/data/internal/inbox_table.js";
import {isAccountMemberOfSpace} from "~/server/spaces/spaces_actions.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {PartialBy} from "~/shared/helpers/types/partial_by.js";

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
    return context.tracer.withSpan(
        "Check if inbox is eligible for digest notification",
        async (context, span) => {
            if (digestNotificationsOptedOutTime) {
                span.addData({
                    notifications: {
                        emailDigest: {
                            ineligibleReason: "unsubscribed",
                        },
                    },
                });
                return false;
            }
            if (!digestNotificationsSchedule || digestNotificationsSchedule.size === 0) {
                span.addData({
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
                span.addData({
                    notifications: {
                        emailDigest: {
                            ineligibleReason: "no unarchived entries",
                        },
                    },
                });
                return false;
            }
            if (!(await isAccountMemberOfSpace(context, spaceId, accountId))) {
                span.addData({
                    notifications: {
                        emailDigest: {
                            ineligibleReason: "not a member of space",
                        },
                    },
                });
                return false;
            }
            if (!lastEntryUpdatedTime) {
                span.addData({
                    notifications: {
                        emailDigest: {
                            ineligibleReason: "lastEntryUpdatedTime is null",
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
                span.addData({
                    notifications: {
                        emailDigest: {
                            ineligibleReason: "already sent digest since last entry update",
                        },
                    },
                });
                return false;
            }
            return true;
        },
    );
}
