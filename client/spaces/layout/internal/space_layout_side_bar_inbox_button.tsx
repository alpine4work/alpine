import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {Bell} from "phosphor-react";
import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/design/overlay_trigger_button.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {inboxEntryWidth} from "~/client/inbox/inbox_entry_view.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToNearestTenMinutes} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {inboxSubtleNotificationBadgePeaceMinutes} from "~/client/spaces/layout/internal/inbox_subtle_notification_badge_peace_minutes.js";
import {
    SpaceLayoutSideBarInboxOverlay,
    spaceLayoutSideBarInboxOverlayHeight,
} from "~/client/spaces/layout/internal/space_layout_side_bar_inbox_overlay.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {inboxEntryViewMinHeight} from "~/client/styles/inbox_shared_styles.js";
import {
    backgroundColorVar,
    greyElevated1ClassName,
    overlayFadeOutAnimationDurationMs,
} from "~/client/styles/styles.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {InboxEntryModel, InboxModel} from "~/shared/notifications/inbox_model.js";
import {
    getInboxEntries,
    getInboxWithStrongReadConsistency,
} from "~/shared/rpc/notifications_rpc_definitions.js";

export function SpaceLayoutSideBarInboxButton({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const spacingScale = useSpacingScale();
    const currentTimeRoundedToNearestTenMinutes = useCurrentTimeRoundedToNearestTenMinutes();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const platform = usePlatform();
    const {isNativeMobile} = useClientInfo();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    const overlayTriggerButtonRef = useRef<OverlayTriggerButtonRef>(null);

    // On mobile platforms, we expect that this component shouldn't render. Instead
    // `<SpaceLayoutNativeMobileInboxController>` should render for native mobile
    // and `<SpaceLayoutWebMobileTabBar>` for web mobile. This assert is a
    // sanity check since we don't want to maintain two separate inbox realtime
    // items which would be inefficient.
    assert(platform !== "mobile" && !isNativeMobile);

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
            convertRemLengthToPx(spacing[spaceLayoutSideBarInboxOverlayHeight], spacingScale),
        ) / convertRemLengthToPx(inboxEntryViewMinHeight, spacingScale),
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

    let notificationType: "loud" | "subtle" | null = null;
    if (inbox) {
        if (inbox.model.loudNotificationCount > 0) {
            notificationType = "loud";
        } else if (
            inbox.model.entryCount > 0 &&
            (!inbox.model.lastZeroEntryCountTime ||
                differenceInMinutes(
                    currentTimeRoundedToNearestTenMinutes,
                    inbox.model.lastZeroEntryCountTime,
                ) > inboxSubtleNotificationBadgePeaceMinutes)
        ) {
            notificationType = "subtle";
        }
    }

    // Update the favicon when the notification type changes.
    useEffect(() => {
        // eslint-disable-next-line string-quotes
        const icon = assertExists(document.querySelector("link[rel~='icon']"));

        const currentHref = icon.getAttribute("href");
        const newHref = {
            loud: "/favicon-loud.svg",
            subtle: "/favicon-subtle.svg",
            default: "/favicon.svg",
        }[notificationType ?? "default"];

        if (currentHref !== newHref) {
            icon.setAttribute("href", newHref);
        }

        return () => {
            icon.setAttribute("href", "/favicon.svg");
        };
    }, [notificationType]);

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
                    borderRadius="1.5"
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
                description="Inbox"
                tooltipPlacement="right"
                pressErrorTitle="Couldn’t open inbox"
                // Don't focus the button on press since pressing will open the overlay and
                // should focus the overlay.
                //
                // TODO(calebmer): Find a way to automate this instead of setting this prop
                // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
                withoutFocusOnPress={true}
            >
                <Bell />
                {notificationType === "loud" ? (
                    <LoudNotificationBadge
                        top="0.1875rem"
                        right="0.6875rem"
                        loudNotificationCount={inbox.model.loudNotificationCount}
                    />
                ) : notificationType === "subtle" ? (
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
