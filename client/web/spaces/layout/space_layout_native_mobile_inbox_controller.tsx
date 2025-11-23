import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {useCallback, useEffect} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useDynamoGeneralRealtimeItem} from "~/client/web/dynamo/use_dynamo_general_realtime_item.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useCurrentTimeRoundedToNearestTenMinutes} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {inboxSubtleNotificationBadgePeaceMinutes} from "~/client/web/spaces/layout/internal/inbox_subtle_notification_badge_peace_minutes.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/web/spaces/space_context.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {getInboxWithStrongReadConsistency} from "~/shared/rpc/notifications_rpc_definitions.js";

export function SpaceLayoutNativeMobileInboxController({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const currentTimeRoundedToNearestTenMinutes = useCurrentTimeRoundedToNearestTenMinutes();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {isNativeMobile} = useClientInfo();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    // Should only render this component in our native mobile app.
    assert(isNativeMobile);

    const {item: inbox} = useDynamoGeneralRealtimeItem(initialInbox, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {inbox} = await getInboxWithStrongReadConsistency(context, {spaceId: space.id});
            return inbox;
        }, [context, space.id]),
    });

    useEffect(() => {
        assert(NativeMobileBridge);

        if (inbox.model.loudNotificationCount > 0) {
            NativeMobileBridge.tabBar.setInboxLoudNotificationBadge(
                inbox.model.loudNotificationCount,
            );
        }
        // If the inbox has entries then we want to render a subtle dot on top of our
        // notification bell. However, we want folks to have a healthy relationship with
        // their notifications. You could be getting new non-loud notifications pretty
        // frequently as folks create new posts or add comments. So when you reach inbox
        // zero we give you 1-2 hours of peace before showing you have new
        // notifications. You can still reach someone immediately with a loud
        // notification.
        else if (
            inbox.model.entryCount > 0 &&
            (!inbox.model.lastZeroEntryCountTime ||
                differenceInMinutes(
                    currentTimeRoundedToNearestTenMinutes,
                    inbox.model.lastZeroEntryCountTime,
                ) > inboxSubtleNotificationBadgePeaceMinutes)
        ) {
            NativeMobileBridge.tabBar.setInboxSubtleNotificationBadge();
        } else {
            NativeMobileBridge.tabBar.clearInboxNotificationBadge();
        }
    }, [
        currentTimeRoundedToNearestTenMinutes,
        inbox.model.entryCount,
        inbox.model.lastZeroEntryCountTime,
        inbox.model.loudNotificationCount,
    ]);

    return null;
}
