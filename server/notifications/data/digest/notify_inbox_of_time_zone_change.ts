import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {computeDigestNotificationsNextScheduledDateTimeIfEligible} from "~/server/notifications/data/digest/compute_digest_notifications_next_scheduled_date_time_if_eligible.js";
import {getOurAccountInboxItems} from "~/server/notifications/data/internal/get_our_account_inbox_items.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {getOurAccountSpaceIds} from "~/server/spaces/get_our_account_space_ids.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

/**
 * Notifies the inbox if an account's time zone changes and updates the next
 * scheduled digest time if eligible.
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
            const newScheduledDigest = computeDigestNotificationsNextScheduledDateTimeIfEligible(
                context,
                {
                    currentTime,
                    timeZone: newTimeZone,
                    inboxItem,
                    options: {lagTimeInMinutes: 60},
                },
            );

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
                        assert(item, "Can\u2019t update time zone for inbox that no longer exists");

                        return item.update({
                            digestNotificationsNextScheduledDateTime: newScheduledDigest,
                        });
                    },
                    {initialItem: inboxItem},
                );
            }
        }),
    );
}
