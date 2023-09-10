import classNames from "classnames";
import {differenceInHours} from "date-fns";
import {Bell} from "phosphor-react";
import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {Overlay} from "~/client/design/overlay.js";
import {defaultTooltipOffset, tooltipDelayMs} from "~/client/design/tooltip.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {inboxEntryViewMinHeight, inboxEntryWidth} from "~/client/inbox/inbox_entry_view.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    SpaceLayoutTopBarInboxOverlay,
    spaceLayoutTopBarInboxOverlayHeight,
} from "~/client/spaces/layout/internal/space_layout_top_bar_inbox_overlay.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {InboxEntryModel, InboxModel} from "~/shared/notifications/inbox_model.js";
import {
    getInboxEntries,
    getInboxWithStrongReadConsistency,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {
    backgroundColorVar,
    greyElevated1ClassName,
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
} from "~/shared/styles/styles.js";

export function SpaceLayoutTopBarInboxButton({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const currentTimeRoundedToHour = useCurrentTimeRoundedToHour();
    const context = useAppContext();
    const {space} = useSpaceContext();
    const remPx = useRemPx();
    const navigate = useNavigate();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    const inbox = useDynamoGeneralRealtimeItem(initialInbox, {
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

    const [shouldDisableOverlay, setShouldDisableOverlay] = useState(false);
    const [isButtonHovered, setIsButtonHovered] = useState(false);
    const [isOverlayHovered, setIsOverlayHovered] = useState(false);

    // There is a gap between the notification button and the notification overlay.
    // So when the mouse leaves the button and before it enters the overlay we
    // don't want to immediately close the overlay. One solution for this is to
    // create a "trajectory triangle" between the mouse and the edges of the
    // overlay where if the mouse stays in that space we don't close the overlay.
    //
    // Learn more about the problem and solution here:
    // https://www.smashingmagazine.com/2021/05/frustrating-design-patterns-mega-dropdown-hover-menus/
    const [pointerTrajectoryState, setPointerTrajectoryState] = useState<
        | {isPointerWithinTrajectoryTriangle: false}
        | {isPointerWithinTrajectoryTriangle: true; startX: number; startY: number}
    >({isPointerWithinTrajectoryTriangle: false});

    const shouldOverlayBeVisible =
        !shouldDisableOverlay &&
        (isButtonHovered ||
            pointerTrajectoryState.isPointerWithinTrajectoryTriangle ||
            isOverlayHovered);

    const [overlayState, setOverlayState] = useState<
        | {
              isVisible: false;
              animationState?: undefined;
          }
        | {
              isVisible: true;
              animationState: "FadingIn" | "FadingOut" | "WaitingForTooltipDelay" | null;
              filter: "New" | "Archive";
              initialEntriesResultPromise: Lazy<
                  PromiseImmediate<DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>>
              >;
          }
    >({isVisible: false});

    const isOverlayVisible =
        overlayState.isVisible && overlayState.animationState !== "WaitingForTooltipDelay";

    // When we unmount the overlay the browser does not call `pointerleave` so we
    // reset the state here.
    if (!isOverlayVisible && isOverlayHovered) {
        setIsOverlayHovered(false);
    }

    // Fetch enough items to fill the virtualization window with entries. This
    // gives the user a bit of space to scroll.
    const initialEntriesLimit = Math.ceil(
        getVirtualizationWindowHeight(
            convertRemLengthToPx(spacing[spaceLayoutTopBarInboxOverlayHeight], remPx),
        ) / convertRemLengthToPx(inboxEntryViewMinHeight, remPx),
    );

    if (shouldOverlayBeVisible && !overlayState.isVisible) {
        setOverlayState({
            isVisible: true,
            animationState: "WaitingForTooltipDelay",
            filter: "New",
            initialEntriesResultPromise: new Lazy(() =>
                PromiseImmediate.resolve(
                    getInboxEntries(context, {
                        spaceId: space.id,
                        filter: "New",
                        limit: initialEntriesLimit,
                        afterCursor: null,
                    }).then(({entriesResult}) => entriesResult),
                ),
            ),
        });
    }

    if (
        !shouldOverlayBeVisible &&
        overlayState.isVisible &&
        overlayState.animationState !== "FadingIn" &&
        overlayState.animationState !== "FadingOut"
    ) {
        switch (overlayState.animationState) {
            case "WaitingForTooltipDelay": {
                setOverlayState({isVisible: false});
                break;
            }
            case null: {
                if (shouldDisableOverlay) {
                    setOverlayState({isVisible: false});
                } else {
                    setOverlayState({
                        ...overlayState,
                        animationState: "FadingOut",
                    });
                }
                break;
            }
            default:
                throw exhaustive(overlayState.animationState);
        }
    }

    // Kickoff the inbox entry's network request in an effect instead of in the
    // render method. Immediately instead of after the tooltip delay.
    useEffect(() => {
        if (overlayState.isVisible) {
            void overlayState.initialEntriesResultPromise.get();
        }
    }, [overlayState]);

    useEffect(() => {
        if (!overlayState.isVisible || overlayState.animationState === null) return;

        switch (overlayState.animationState) {
            case "FadingIn": {
                const timeout = createTimeout(() => {
                    setOverlayState(overlayState => {
                        if (!overlayState.isVisible || overlayState.animationState !== "FadingIn") {
                            return overlayState;
                        }
                        return {...overlayState, animationState: null};
                    });
                }, overlayFadeInAnimationDurationMs);

                return () => timeout.clear();
            }
            case "FadingOut": {
                const timeout = createTimeout(() => {
                    setOverlayState(overlayState => {
                        if (
                            !overlayState.isVisible ||
                            overlayState.animationState !== "FadingOut"
                        ) {
                            return overlayState;
                        }
                        return {isVisible: false};
                    });
                }, overlayFadeOutAnimationDurationMs);

                return () => timeout.clear();
            }
            case "WaitingForTooltipDelay": {
                const timeout = createTimeout(() => {
                    setOverlayState(overlayState => {
                        if (
                            !overlayState.isVisible ||
                            overlayState.animationState !== "WaitingForTooltipDelay"
                        ) {
                            return overlayState;
                        }
                        return {...overlayState, animationState: "FadingIn"};
                    });
                }, tooltipDelayMs);

                return () => timeout.clear();
            }
            default:
                throw exhaustive(overlayState.animationState);
        }
    }, [overlayState.animationState, overlayState.isVisible]);

    // Register an event listener for all pointer move events to check whether the
    // pointer is still in the trajectory triangle. If the pointer leaves that
    // triangle we should close the overlay.
    useEffect(() => {
        if (!pointerTrajectoryState.isPointerWithinTrajectoryTriangle) return;

        const sign = (
            point1: {x: number; y: number},
            point2: {x: number; y: number},
            point3: {x: number; y: number},
        ) => {
            return (
                (point1.x - point3.x) * (point2.y - point3.y) -
                (point2.x - point3.x) * (point1.y - point3.y)
            );
        };

        // Triangle intersection function taken from:
        // https://stackoverflow.com/questions/2049582/how-to-determine-if-a-point-is-in-a-2d-triangle
        const isPointInTriangle = (
            point: {x: number; y: number},
            vertex1: {x: number; y: number},
            vertex2: {x: number; y: number},
            vertex3: {x: number; y: number},
        ) => {
            const d1 = sign(point, vertex1, vertex2);
            const d2 = sign(point, vertex2, vertex3);
            const d3 = sign(point, vertex3, vertex1);

            const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
            const hasPos = d1 > 0 || d2 > 0 || d3 > 0;

            return !(hasNeg && hasPos);
        };

        const listener = (event: PointerEvent) => {
            const overlayElement = overlayRef.current;
            if (!overlayElement) {
                setPointerTrajectoryState({isPointerWithinTrajectoryTriangle: false});
                return;
            }

            const rect = overlayElement.getBoundingClientRect();

            if (
                !isPointInTriangle(
                    {x: event.clientX, y: event.clientY},
                    {x: pointerTrajectoryState.startX, y: pointerTrajectoryState.startY},
                    {x: rect.left, y: rect.top},
                    {x: rect.right, y: rect.top},
                )
            ) {
                setPointerTrajectoryState({isPointerWithinTrajectoryTriangle: false});
            }
        };

        document.addEventListener("pointermove", listener);
        return () => document.removeEventListener("pointermove", listener);
    }, [pointerTrajectoryState]);

    const handleOverlayClose = useCallback(() => {
        // Force the overlay to close outside of hover states.
        setOverlayState(overlayState => {
            if (!overlayState.isVisible) return overlayState;
            return {isVisible: false};
        });
    }, []);

    const isButtonHoveredRef = useRef(isButtonHovered);
    useLayoutEffectWithoutServerSideWarning(() => {
        isButtonHoveredRef.current = isButtonHovered;
    }, [isButtonHovered]);

    return (
        <Box position="relative" zIndex="0">
            <Overlay
                isVisible={isOverlayVisible}
                placement="bottom-end"
                offset={defaultTooltipOffset}
                offsetAlong="8"
                overlay={
                    <Box className={overlayAnimateContainerClassName}>
                        <Box
                            ref={overlayRef}
                            width={inboxEntryWidth}
                            height={spaceLayoutTopBarInboxOverlayHeight}
                            borderRadius="md"
                            backgroundColor="grey-0"
                            boxShadow="elevation-20"
                            display="flex"
                            flexDirection="column"
                            overflow="hidden"
                            className={classNames(
                                greyElevated1ClassName,
                                overlayState.animationState === "FadingIn" &&
                                    overlayAnimateFadeInClassName,
                                overlayState.animationState === "FadingOut" &&
                                    overlayAnimateFadeOutClassName,
                            )}
                            onPointerEnter={() => setIsOverlayHovered(true)}
                            onPointerLeave={() => setIsOverlayHovered(false)}
                        >
                            {overlayState.isVisible && (
                                <SpaceLayoutTopBarInboxOverlay
                                    // Remount when the filter changes...
                                    key={overlayState.filter}
                                    filter={overlayState.filter}
                                    initialEntriesResultPromise={overlayState.initialEntriesResultPromise.get()}
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
                                                isVisible: true,
                                                animationState: overlayState.animationState,
                                                filter: "New",
                                                initialEntriesResultPromise: new Lazy(() =>
                                                    PromiseImmediate.resolve(entriesResult),
                                                ),
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
                                                isVisible: true,
                                                animationState: overlayState.animationState,
                                                filter: "Archive",
                                                initialEntriesResultPromise: new Lazy(() =>
                                                    PromiseImmediate.resolve(entriesResult),
                                                ),
                                            };
                                        });
                                    }}
                                    onClose={handleOverlayClose}
                                />
                            )}
                        </Box>
                    </Box>
                }
            >
                <IconButton
                    ref={buttonRef}
                    size="md"
                    description="Notifications"
                    // When you hover over the notification bell we open a notification preview.
                    withoutTooltip={true}
                    // The notification count renders outside the bounds of the icon button. Don't
                    // clip it!
                    disableOverflowHidden={true}
                    pressErrorTitle="Couldn’t open notifications"
                    onPress={async () => {
                        try {
                            // Do not let the overlay open up if it is already closed.
                            // This will happen if we are in a `WaitingForTooltipDelay`
                            // animation state.
                            //
                            // We want the overlay to stay open while we wait to
                            // navigate, though.
                            if (!isOverlayVisible) setShouldDisableOverlay(true);

                            await navigate(`/s/${space.id}/inbox`);

                            // If the overlay is open, then disable it after we successfully navigate to
                            // the inbox. The user will need to move their mouse off the notification
                            // button and back on to see it again.
                            //
                            // We need to use a ref of this state since our async function will have
                            // captured a stale value.
                            if (isButtonHoveredRef.current) setShouldDisableOverlay(true);
                        } catch (error) {
                            setShouldDisableOverlay(false);
                            throw error;
                        }
                    }}
                    onHoverStart={() => setIsButtonHovered(true)}
                    onHoverEnd={() => setIsButtonHovered(false)}
                    onPointerLeave={event => {
                        setShouldDisableOverlay(false);

                        setPointerTrajectoryState({
                            isPointerWithinTrajectoryTriangle: true,
                            startX: event.pageX,
                            startY: event.pageY,
                        });
                    }}
                >
                    <Bell />
                    {inbox.model.loudNotificationCount > 0 ? (
                        <LoudNotificationBadge
                            top="-0.0625rem"
                            right="0.5rem"
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
                                top: "0.3125rem",
                                right: "0.4375rem",
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
            </Overlay>
        </Box>
    );
}
