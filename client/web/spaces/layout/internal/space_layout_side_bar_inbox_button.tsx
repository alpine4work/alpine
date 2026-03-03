import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {IconContext} from "phosphor-react";
import {useCallback, useContext, useEffect, useId, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/web/design/overlay_trigger_button.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {useDynamoGeneralRealtimeItem} from "~/client/web/dynamo/use_dynamo_general_realtime_item.js";
import {inboxEntryWidth} from "~/client/web/inbox/inbox_entry_view.js";
import {LoudNotificationBadgeSvg} from "~/client/web/inbox/loud_notification_badge.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToNearestTenMinutes} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {inboxSubtleNotificationBadgePeaceMinutes} from "~/client/web/spaces/layout/internal/inbox_subtle_notification_badge_peace_minutes.js";
import {
    SpaceLayoutSideBarInboxOverlay,
    spaceLayoutSideBarInboxOverlayHeight,
} from "~/client/web/spaces/layout/internal/space_layout_side_bar_inbox_overlay.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/web/spaces/space_context.js";
import {inboxEntryViewMinHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {overlayFadeOutAnimationDurationMs} from "~/client/web/styles/styles.js";
import {getVirtualizationWindowHeight} from "~/client/web/virtualized/virtualized_scroll_view_state.js";
import {greyElevated1ClassName} from "~/shared/design/core/constant_class_names.js";
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
    // `<SpaceLayoutNativeMobileInboxController>` should render for native mobile and
    // `<SpaceLayoutWebMobileTabBar>` for web mobile. This assert is a sanity check
    // since we don't want to maintain two separate inbox realtime items which would be
    // inefficient.
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

    // Fetch enough items to fill the virtualization window with entries. This gives
    // the user a bit of space to scroll.
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
                // Don't call `onOpen` which will `preventDefault`. We actually want the overlay to
                // open now.
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
        const icon = assertExists(
            document.querySelector("link[rel~='icon'][type='image/svg+xml']"),
        );

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
                // entries. If we don't successfully load within some timeout we'll open anyway and
                // display loading indicators.
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
                pressErrorTitle="Couldn&#x2019;t open inbox"
                // Don't focus the button on press since pressing will open the overlay and should
                // focus the overlay.
                //
                // TODO(calebmer): Find a way to automate this instead of setting this prop
                // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
                withoutFocusOnPress={true}
            >
                <Box position="relative" width="5" height="5">
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        width="10"
                        height="10"
                        top="-5"
                        right="-5"
                    >
                        <SpaceLayoutSideBarInboxButtonIcon
                            notificationType={notificationType}
                            loudNotificationCount={inbox.model.loudNotificationCount}
                        />
                    </Box>
                </Box>
            </IconButton>
        </OverlayTriggerButton>
    );
}

function SpaceLayoutSideBarInboxButtonIcon({
    notificationType,
    loudNotificationCount,
}: {
    notificationType: "loud" | "subtle" | null;
    loudNotificationCount: number;
}) {
    const {
        color: contextColor,
        size: contextSize,
        weight,
        mirrored,
        ...context
    } = useContext(IconContext);

    const idBase = useId();

    const strokeWidth = 16;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            // Extra space above and to the right in the `viewBox` to make space for the
            // notification badge.
            //
            // NOTE(calebmer): I don't really understand why -128 in `viewBox` works here. I'd
            // expect -256 to be what we need to give 512 total `viewBox` units of vertical
            // space with 256 of those units above the icon. -128 seems to put us in the exact
            // right position _shrug_.
            viewBox="0 -128 512 256"
            fill={contextColor}
            {...context}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{
                width: `calc(${contextSize} * 2)`,
                height: `calc(${contextSize} * 2)`,
                ...context.style,
            }}
        >
            <path
                d="M56.2,104a71.9,71.9,0,0,1,72.3-72c39.6.3,71.3,33.2,71.3,72.9V112c0,35.8,7.5,56.6,14.1,68a8,8,0,0,1-6.9,12H49a8,8,0,0,1-6.9-12c6.6-11.4,14.1-32.2,14.1-68Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
                clipPath={notificationType ? `url(#${idBase}-${notificationType})` : undefined}
            />
            <path
                d="M96,192v8a32,32,0,0,0,64,0v-8"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
            />
            {notificationType === "subtle" &&
                (() => {
                    const dotDiameter = 51.2;
                    const dotRadius = dotDiameter / 2;
                    const dotX = 179.2;
                    const dotY = 51.2;
                    const dotClipRadius = dotRadius + strokeWidth;
                    const dotClipDiameter = dotClipRadius * 2;

                    return (
                        <>
                            <circle cx={dotX} cy={dotY} r={dotRadius} fill="currentcolor" />
                            <clipPath id={`${idBase}-subtle`}>
                                <path
                                    fillRule="evenodd"
                                    clipRule="evenodd"
                                    d={[
                                        "M0,0h256v256h-256z",
                                        `M${dotX},${dotY}`,
                                        `m${-dotClipRadius},0`,
                                        `a${dotClipRadius},${dotClipRadius},0,1,0,${dotClipDiameter},0`,
                                        `a${dotClipRadius},${dotClipRadius},0,1,0,${-dotClipDiameter},0`,
                                    ].join(" ")}
                                />
                            </clipPath>
                        </>
                    );
                })()}
            {notificationType === "loud" && (
                <LoudNotificationBadgeSvg
                    x={192}
                    y={39}
                    count={loudNotificationCount}
                    clipPath={{id: `${idBase}-loud`, strokeWidth}}
                />
            )}
        </svg>
    );
}
