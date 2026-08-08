import {WebPushSubscriptionItem} from "~/server/notifications/data/internal/notifications_table.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.open_source.js";

export function getInitialWebPushSubscriptionItem(
    browserId: BrowserId,
    accountId: AccountId,
    currentTime: Date,
): WebPushSubscriptionItem {
    return {
        partitionType: "PushTargets",
        sortRangeType: "WebPushSubscription",
        accountId,
        browserId,
        subscription: null,
        createdTime: currentTime,
        lastUpdatedTime: currentTime,
        optedOutSpaceIds: emptySet,
    };
}
