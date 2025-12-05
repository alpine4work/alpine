import {WebPushSubscriptionItem} from "~/server/notifications/data/internal/notifications_table.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.js";

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
