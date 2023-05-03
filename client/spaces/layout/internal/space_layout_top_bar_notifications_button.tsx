import classNames from "classnames";
import {Bell, SpinnerGap} from "phosphor-react";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {IconButton} from "~/client/design/icon_button";
import {Overlay} from "~/client/design/overlay";
import {useShowToast} from "~/client/design/toast";
import {tooltipDelayMs} from "~/client/design/tooltip";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {usePromise} from "~/client/helpers/use_promise";
import {
    InboxEntryView,
    inboxEntryViewMinHeight,
    inboxEntryWidth,
} from "~/client/inbox/inbox_entry_view";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge";
import {useInboxState} from "~/client/inbox/use_inbox_state";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useNavigate} from "~/client/remix/use_navigate";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {UnimplementedError} from "~/shared/error/error";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {InboxEntryModel, InboxModel} from "~/shared/models/inbox_model";
import {getInboxWithStrongReadConsistency} from "~/shared/rpc/accounts_rpc_definitions";
import {getInboxEntries} from "~/shared/rpc/notifications_rpc_definitions";
import {
    colorSchemeVars,
    greyElevatedClassName,
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    spinAnimationClassName,
} from "~/shared/styles/styles";

const notificationOverlayHeight: Spacing = "128";

export function SpaceLayoutTopBarNotificationsButton({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const remPx = useRemPx();
    const navigate = useNavigate();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    // NOCOMMIT: Test that we can go offline then back online and the inbox count
    // updates.
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

    if (shouldOverlayBeVisible && !overlayState.isVisible) {
        setOverlayState({
            isVisible: true,
            animationState: "WaitingForTooltipDelay",
            initialEntriesResultPromise: new Lazy(() => {
                // Fetch enough items to fill the virtualization window with entries. This
                // gives the user a bit of space to scroll.
                const limit = Math.ceil(
                    getVirtualizationWindowHeight(
                        convertRemLengthToPx(spacing[notificationOverlayHeight], remPx),
                    ) / convertRemLengthToPx(inboxEntryViewMinHeight, remPx),
                );

                return PromiseImmediate.resolve(
                    getInboxEntries(context, {
                        spaceId: space.id,
                        limit,
                        afterCursor: null,
                    }).then(({entriesResult}) => entriesResult),
                );
            }),
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
                }, 200); // NOCOMMIT: Real delay

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
                }, 200); // NOCOMMIT: Real delay

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
                            height={notificationOverlayHeight}
                            borderRadius="md"
                            backgroundColor="grey-0"
                            boxShadow="elevation-20"
                            display="flex"
                            flexDirection="column"
                            overflow="hidden"
                            className={classNames(
                                greyElevatedClassName,
                                overlayState.animationState === "FadingIn" &&
                                    overlayAnimateFadeInClassName,
                                overlayState.animationState === "FadingOut" &&
                                    overlayAnimateFadeOutClassName,
                            )}
                            onPointerEnter={() => setIsOverlayHovered(true)}
                            onPointerLeave={() => setIsOverlayHovered(false)}
                        >
                            {overlayState.isVisible && (
                                <SpaceLayoutTopBarNotificationOverlay
                                    initialEntriesResultPromise={overlayState.initialEntriesResultPromise.get()}
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
                    {inbox.model.loudNotificationCount > 0 && (
                        <LoudNotificationBadge
                            top="-0.0625rem"
                            right="0.5rem"
                            loudNotificationCount={inbox.model.loudNotificationCount}
                        />
                    )}
                </IconButton>
            </Overlay>
        </Box>
    );
}

function SpaceLayoutTopBarNotificationOverlay({
    initialEntriesResultPromise,
    onClose,
}: {
    initialEntriesResultPromise: PromiseImmediate<
        DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>
    >;
    onClose: Memo<() => void>;
}) {
    const initialEntriesResult = usePromise(initialEntriesResultPromise);

    return (
        <>
            {initialEntriesResult.isPending ? (
                <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                    <SpinnerGap
                        className={spinAnimationClassName}
                        color={colorSchemeVars["grey-70"]}
                        size={spacing["6"]}
                    />
                </Box>
            ) : (
                <SpaceLayoutTopBarNotificationOverlayInbox
                    initialEntriesResult={initialEntriesResult.value}
                    onClose={onClose}
                />
            )}
        </>
    );
}

function SpaceLayoutTopBarNotificationOverlayInbox({
    initialEntriesResult,
    onClose,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    onClose: Memo<() => void>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {query, tryLoadingMore} = useInboxState({
        initialEntriesResult,
        shouldAnimateDeletion: false,
    });

    // Whenever our query data changes, try loading more entries. In case our
    // rendered range stayed the same but we now see the loading indicator.
    //
    // This effect should also fire when `tryLoadingMore()` completes in case it
    // didn't fully load the query.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        query;

        const view = assertExists(viewRef.current);
        tryLoadingMore(view.getHeight(), view.getRenderedRange());
    }, [query, tryLoadingMore]);

    const itemCount = query.getItemCount();

    return (
        <VirtualizedScrollView
            ref={viewRef}
            bufferedItemHeight={inboxEntryViewMinHeight}
            initialViewHeight={spacing[notificationOverlayHeight]}
            onRenderedRangeChange={renderedRange => {
                const view = assertExists(viewRef.current);
                tryLoadingMore(view.getHeight(), renderedRange);
            }}
            itemCount={itemCount}
            renderItem={useCallback(
                index => {
                    const item = query.getItem(index);
                    switch (item.type) {
                        case "Loaded": {
                            return {
                                key: `Loaded:${item.item.key}`,
                                minHeight: inboxEntryViewMinHeight,
                                node: (
                                    <SpaceLayoutTopBarNotificationOverlayInboxEntry
                                        entry={item.item.model}
                                        isFirstEntry={index === 0}
                                        isLastEntry={index === itemCount - 1}
                                        onClose={onClose}
                                    />
                                ),
                            };
                        }
                        case "AnimatingDeletion": {
                            // NOCOMMIT
                            throw new UnimplementedError("TODO");
                        }
                        case "LoadingIndicator": {
                            return {
                                key: "LoadingIndicator",
                                minHeight: inboxEntryViewMinHeight,
                                node: (
                                    <Box
                                        display="flex"
                                        justifyContent="center"
                                        alignItems="center"
                                        style={{height: inboxEntryViewMinHeight}}
                                    >
                                        <SpinnerGap
                                            className={spinAnimationClassName}
                                            color={colorSchemeVars["grey-60"]}
                                            size={spacing["4"]}
                                        />
                                    </Box>
                                ),
                            };
                        }
                        default:
                            throw exhaustive(item);
                    }
                },
                [itemCount, onClose, query],
            )}
        />
    );
}

function SpaceLayoutTopBarNotificationOverlayInboxEntry({
    entry,
    isFirstEntry,
    isLastEntry,
    onClose,
}: {
    entry: InboxEntryModel;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    onClose: () => void;
}) {
    const showToast = useShowToast();
    const peekStackContext = usePeekStackContext();

    const [isPending, setIsPending] = useState(false);

    return (
        <InboxEntryView
            entry={entry}
            withinOverlay={true}
            isFirstEntry={isFirstEntry}
            isLastEntry={isLastEntry}
            onPress={() => {
                if (isPending) return;

                // TODO(calebmer): Some kind of global loading indicator?
                peekStackContext.push(entry.getPath()).then(
                    () => {
                        setIsPending(false);
                        onClose();
                    },
                    error => {
                        setIsPending(false);
                        showToast({
                            type: "Error",
                            title: "Couldn’t open notification",
                            error,
                        });
                    },
                );
            }}
        />
    );
}
