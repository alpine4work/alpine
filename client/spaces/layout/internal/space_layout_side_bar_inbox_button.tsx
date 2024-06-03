import {differenceInHours} from "date-fns";
import {Bell} from "phosphor-react";
import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/design/overlay_trigger_button.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {inboxEntryWidth} from "~/client/inbox/inbox_entry_view.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {
    SpaceLayoutSideBarInboxOverlay,
    spaceLayoutSideBarInboxOverlayHeight,
} from "~/client/spaces/layout/internal/space_layout_side_bar_inbox_overlay.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {InboxEntryModel, InboxModel} from "~/shared/notifications/inbox_model.js";
import {
    getInboxEntries,
    getInboxWithStrongReadConsistency,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {inboxEntryViewMinHeight} from "~/shared/styles/inbox_shared_styles.js";
import {
    backgroundColorVar,
    greyElevated1ClassName,
    overlayFadeOutAnimationDurationMs,
} from "~/shared/styles/styles.js";

export function SpaceLayoutSideBarInboxButton({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const remPx = useRemPx();
    const currentTimeRoundedToHour = useCurrentTimeRoundedToHour();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    const overlayTriggerButtonRef = useRef<OverlayTriggerButtonRef>(null);

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

    const [overlayState, setOverlayState] = useState<
        | {isVisible: false; isAnimatingOut?: undefined}
        | {
              isVisible: true;
              isPending: boolean;
              isAnimatingOut: boolean;
              filter: "New" | "Archive";
              initialEntriesResultPromise: PromiseImmediate<
                  DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>
              >;
          }
    >({isVisible: false});

    // Fetch enough items to fill the virtualization window with entries. This
    // gives the user a bit of space to scroll.
    const initialEntriesLimit = Math.ceil(
        getVirtualizationWindowHeight(
            convertRemLengthToPx(spacing[spaceLayoutSideBarInboxOverlayHeight], remPx),
        ) / convertRemLengthToPx(inboxEntryViewMinHeight, remPx),
    );

    useEffect(() => {
        if (!overlayState.isVisible || !overlayState.isPending) return;

        const overlayTriggerButton = assertExists(overlayTriggerButtonRef.current);

        let isPending = true;

        const onFinish = () => {
            if (!isPending) return;
            isPending = false;

            timeout.clear();

            setOverlayState({
                isVisible: true,
                isPending: false,
                isAnimatingOut: false,
                filter: overlayState.filter,
                initialEntriesResultPromise: overlayState.initialEntriesResultPromise,
            });

            overlayTriggerButton.open({
                // Don't call `onOpen` which will `preventDefault`. We actually want the
                // overlay to open now.
                stopPropagation: true,
            });
        };

        // Wait until either results load or the loading indicator delay passes before
        // actually opening the overlay.
        overlayState.initialEntriesResultPromise.then(onFinish, onFinish);

        const timeout = createTimeout(onFinish, delayLoadingIndicatorLimitMs);

        return () => {
            timeout.clear();
        };
    }, [overlayState]);

    useEffect(() => {
        if (!overlayState.isVisible || !overlayState.isAnimatingOut) return;

        const timeout = createTimeout(() => {
            setOverlayState({isVisible: false});
        }, overlayFadeOutAnimationDurationMs);

        return () => {
            timeout.clear();
        };
    }, [overlayState.isAnimatingOut, overlayState.isVisible]);

    return (
        <OverlayTriggerButton
            ref={overlayTriggerButtonRef}
            aria-haspopup="dialog"
            placement="right-start"
            offset={defaultTooltipOffset}
            // Center the "Inbox" expand button next to the notification bell icon.
            offsetAlong="-0.5"
            onOpen={() => {
                // Don't open the loading indicator immediately. Instead start loading inbox
                // entries. If we don't successfully load within some timeout we'll open anyway
                // and display loading indicators.
                setOverlayState({
                    isVisible: true,
                    isPending: true,
                    isAnimatingOut: false,
                    filter: "New",
                    initialEntriesResultPromise: PromiseImmediate.resolve(
                        getInboxEntries(context, {
                            spaceId: space.id,
                            filter: "New",
                            limit: initialEntriesLimit,
                            afterCursor: null,
                        }).then(({entriesResult}) => entriesResult),
                    ),
                });

                return {preventDefault: true};
            }}
            onClose={({withoutAnimation}) => {
                if (withoutAnimation) {
                    setOverlayState({isVisible: false});
                } else {
                    setOverlayState(overlayState => {
                        if (!overlayState.isVisible || overlayState.isAnimatingOut)
                            return overlayState;

                        return {...overlayState, isAnimatingOut: true};
                    });
                }
            }}
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    width={inboxEntryWidth}
                    height={spaceLayoutSideBarInboxOverlayHeight}
                    borderRadius="md"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                    overflow="hidden"
                    className={greyElevated1ClassName}
                >
                    {overlayState.isVisible && (
                        <SpaceLayoutSideBarInboxOverlay
                            // Remount when the filter changes...
                            key={overlayState.filter}
                            filter={overlayState.filter}
                            initialEntriesResultPromise={overlayState.initialEntriesResultPromise}
                            onNewPress={async () => {
                                const {entriesResult} = await getInboxEntries(context, {
                                    spaceId: space.id,
                                    filter: "New",
                                    limit: initialEntriesLimit,
                                    afterCursor: null,
                                });

                                setOverlayState(overlayState => {
                                    if (!overlayState.isVisible) return overlayState;

                                    return {
                                        ...overlayState,
                                        isVisible: true,
                                        isPending: false,
                                        filter: "New",
                                        initialEntriesResultPromise:
                                            PromiseImmediate.resolve(entriesResult),
                                    };
                                });
                            }}
                            onArchivePress={async () => {
                                const {entriesResult} = await getInboxEntries(context, {
                                    spaceId: space.id,
                                    filter: "Archive",
                                    limit: initialEntriesLimit,
                                    afterCursor: null,
                                });

                                setOverlayState(overlayState => {
                                    if (!overlayState.isVisible) return overlayState;

                                    return {
                                        ...overlayState,
                                        isVisible: true,
                                        isPending: false,
                                        filter: "Archive",
                                        initialEntriesResultPromise:
                                            PromiseImmediate.resolve(entriesResult),
                                    };
                                });
                            }}
                            onClose={onCloseWithoutAnimation}
                        />
                    )}
                </Box>
            )}
        >
            <IconButton
                isPending={overlayState.isVisible && overlayState.isPending}
                // We'll open the overlay after a delay and show a loading indicator there.
                withoutLoadingIndicator
                size="lg"
                description="Notifications"
                tooltipPlacement="right"
                pressErrorTitle="Couldn’t open notifications"
            >
                <Bell />
                {inbox.model.loudNotificationCount > 0 ? (
                    <LoudNotificationBadge
                        top="0.1875rem"
                        right="0.6875rem"
                        loudNotificationCount={inbox.model.loudNotificationCount}
                    />
                ) : // If the inbox has entries then we want to render a subtle dot on top of our
                // notification bell. However, we want folks to have a healthy relationship with
                // their notifications. You could be getting new non-loud notifications pretty
                // frequently as folks create new posts or add comments. So when you reach inbox
                // zero we give you 1-2 hours of peace before showing you have new
                // notifications. You can still reach someone immediately with a loud
                // notification.
                inbox.model.entryCount > 0 &&
                  (!inbox.model.lastZeroEntryCountTime ||
                      differenceInHours(
                          currentTimeRoundedToHour,
                          inbox.model.lastZeroEntryCountTime,
                      ) >= 1) ? (
                    <Box
                        zIndex="30"
                        position="absolute"
                        pointerEvents="none"
                        borderRadius="full"
                        width="1"
                        height="1"
                        style={{
                            top: "0.5rem",
                            right: "0.625rem",
                            backgroundColor: "currentcolor",
                            // On high pixel density displays we want 1.3px should to round up to 1.5px and
                            // on low pixel density displays we want 1.3px to round down to 1px.
                            //
                            // That extra width is helpful when rendering this on top of a solid object
                            // like an avatar. We don't want 2px since an avatar pile will use that for
                            // occluding other avatars.
                            boxShadow: `0 0 0 1.3px ${backgroundColorVar}`,
                        }}
                    />
                ) : null}
            </IconButton>
        </OverlayTriggerButton>
    );
}
