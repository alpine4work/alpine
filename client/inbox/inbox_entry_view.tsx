import {assignInlineVars} from "@vanilla-extract/dynamic";
import {differenceInHours} from "date-fns/differenceInHours";
import {AnimationControls, animate, timeline} from "motion";
import {Check, DotsThree, IconContext} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {
    getInboxEntryDisplay,
    renderInboxEntryDisplaySummary,
} from "~/client/inbox/internal/inbox_entry_display.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useCanPrimaryInputHover} from "~/client/remix/platform_context.js";
import {getRemPxWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {inboxEntryViewMinHeight} from "~/client/styles/inbox_shared_styles.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    overlayFadeOutAnimationDurationMs,
} from "~/client/styles/styles.js";
import {easeOutExpo, parseCubicBezier} from "~/shared/design/core/easing.js";
import {Spacing, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {getIntlDateTimeFormat} from "~/shared/helpers/intl/get_intl_date_time_format.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export const inboxEntryWidth = "96";

const inboxEntryViewTouchSwipeIconWidth = "16";
const inboxEntryViewTouchSwipeIconWidthRem = parseRemLength(inboxEntryViewTouchSwipeIconWidth);

const inboxEntryDeleteAnimationFadeDurationMs = 150;
const inboxEntryDeleteAnimationSlideDurationMs = 230;
const inboxEntryDeleteAnimationSlideDelayDurationMs = 70;
export const inboxEntryDeleteAnimationDurationMs =
    inboxEntryDeleteAnimationSlideDelayDurationMs + inboxEntryDeleteAnimationSlideDurationMs;

export function InboxEntryView({
    filter,
    entry,
    isSelected = false,
    onPressStart,
    onPress,
    marginX = "1",
    paddingX = "4",
    withMarginTop,
    withMarginBottom,
    withBorderTop,
    withBackgroundIfPressed = false,
    "aria-setsize": ariaSetsize,
    "aria-posinset": ariaPosinset,
    deletedItemAnimation = null,
    onArchive,
    onUnarchive,
}: {
    filter: "New" | "Archive";
    entry: InboxEntryModel;
    isSelected?: boolean;
    onPressStart?: () => void;
    onPress?: () => void;
    marginX?: Spacing;
    paddingX?: Spacing | {mobile?: Spacing; desktop?: Spacing};
    withMarginTop?: boolean;
    withMarginBottom?: boolean;
    withBorderTop?: boolean;
    withBackgroundIfPressed?: boolean;
    // Because entries are virtualized, we need to set these properties so screen
    // readers can correctly announce what position the user is in no matter
    // what's in the DOM.
    // https://w3c.github.io/aria/#aria-setsize
    "aria-setsize"?: number;
    "aria-posinset"?: number;
    deletedItemAnimation?: {
        offset: number;
        deletedItem: {item: DynamoGeneralRealtimeItem<InboxEntryModel>};
    } | null;
    onArchive: (options: {withAnimation: boolean}) => MaybePromise<void>;
    onUnarchive: () => MaybePromise<void>;
}) {
    const currentTime = useCurrentTimeRoundedToHour();
    const {isAppleDevice, timeZone, locale} = useClientInfo();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const {currentAccount} = useSpaceContext();

    const entryRef = useRef<HTMLDivElement>(null);
    const entryContentRef = useRef<HTMLDivElement>(null);
    const [isPressed, setIsPressed] = useState(false);

    const [isHovered, hoverRef] = useHoverWithOverlaySupport();

    const [archiveFilterMoreMenuButtonState, setArchiveFilterMoreMenuButtonState] = useState<
        {isExpanded: false} | {isExpanded: true; isAnimatingOut: boolean}
    >({isExpanded: false});
    if (filter !== "Archive" && archiveFilterMoreMenuButtonState.isExpanded)
        setArchiveFilterMoreMenuButtonState({isExpanded: false});

    useEffect(() => {
        if (
            !archiveFilterMoreMenuButtonState.isExpanded ||
            !archiveFilterMoreMenuButtonState.isAnimatingOut
        ) {
            return;
        }

        const timeout = createTimeout(
            () => {
                setArchiveFilterMoreMenuButtonState({isExpanded: false});
            },
            overlayFadeOutAnimationDurationMs +
                // Wait a bit before setting `isExpanded` to false so `isHovered` state can
                // become true and actions don't temporarily blink out of existence.
                perceivedAsInstantLimitMs,
        );

        return () => timeout.clear();
    }, [archiveFilterMoreMenuButtonState]);

    const lastDeletedItemAnimationRef = useRef(deletedItemAnimation);
    const lastAnimationRef = useRef<AnimationControls | null>(null);
    useEffect(() => {
        if (lastDeletedItemAnimationRef.current === deletedItemAnimation) return;
        lastDeletedItemAnimationRef.current = deletedItemAnimation;

        const entryElement = assertExists(entryRef.current);
        lastAnimationRef.current?.cancel();
        lastAnimationRef.current = null;

        // Reset any animated values.
        animate(entryElement, {opacity: 1, y: 0}, {duration: 0});

        if (!deletedItemAnimation) return;

        if (deletedItemAnimation.deletedItem.item.model === entry) {
            lastAnimationRef.current = animate(
                entryElement,
                {opacity: 0},
                {
                    easing: "linear",
                    duration: inboxEntryDeleteAnimationFadeDurationMs / 1000,
                },
            );
        } else {
            lastAnimationRef.current = animate(
                entryElement,
                {y: -deletedItemAnimation.offset},
                {
                    easing: "ease",
                    duration: inboxEntryDeleteAnimationSlideDurationMs / 1000,
                    delay: inboxEntryDeleteAnimationSlideDelayDurationMs / 1000,
                },
            );
        }
    }, [deletedItemAnimation, entry]);

    // Watch all parent elements of our content editor for scroll events. When a
    // scroll event occurs we call `setIsPressed(false)`.
    //
    // This replicates the behavior in `@react-aria/interactions` where a press is
    // cancelled when a parent element scrolls. This behavior is important for
    // mobile since the user must press somewhere on the screen to scroll. Normally
    // `pointercancel` should be dispatched when the user scrolls while pressing on
    // some element but when the CSS `touch-action: manipulation` is set the press
    // is not cancelled.
    useEffect(() => {
        if (!isPressed) return;

        const handleScroll = () => {
            setIsPressed(false);
        };

        const scrollEventTargets: Array<EventTarget> = [window];

        {
            let parentElement = assertExists(entryRef.current).parentElement;
            while (parentElement) {
                const {overflowX, overflowY} = getComputedStyle(parentElement);

                if (
                    overflowX === "auto" ||
                    overflowX === "scroll" ||
                    overflowY === "auto" ||
                    overflowY === "scroll"
                ) {
                    scrollEventTargets.push(parentElement);
                }

                parentElement =
                    parentElement.parentElement !== document.body
                        ? parentElement.parentElement
                        : null;
            }
        }

        for (const scrollEventTarget of scrollEventTargets) {
            scrollEventTarget.addEventListener("scroll", handleScroll, true);
        }

        return () => {
            for (const scrollEventTarget of scrollEventTargets) {
                scrollEventTarget.removeEventListener("scroll", handleScroll, true);
            }
        };
    }, [isPressed]);

    const [touchSwipeState, setTouchSwipeState] = useState<"Indeterminate" | "Activated" | null>(
        null,
    );
    const touchSwipeStateRef = useRef(touchSwipeState);

    const touchSwipeIconRef = useRef<HTMLDivElement>(null);

    const events = useEvents({onArchive, onPress: onPress ?? noop});

    useEffect(() => {
        if (filter !== "New") return;

        // If the user can hover then we'll show a "Done" button when the user hovers
        // over the entry.
        if (canPrimaryInputHover) return;

        const entryElement = assertExists(entryRef.current);
        const entryContentElement = assertExists(entryContentRef.current);

        let touchState: {
            gesture: "Swipe" | "Scroll" | null;
            hasSwipeGestureActivated: boolean;
            initialClientX: number;
            initialClientY: number;
            finishGesture: (() => void) | null;
        } | null = null;

        const handleTouchStart = (event: TouchEvent) => {
            // Can't start a new swipe gesture while another's animation is finishing.
            if (touchSwipeStateRef.current !== null) return;

            setTouchSwipeState(null);
            touchSwipeStateRef.current = null;

            void touchState?.finishGesture?.();
            touchState = null;

            if (event.touches.length > 1) {
                return;
            }

            const touch = event.touches[0]!;

            touchState = {
                gesture: null,
                hasSwipeGestureActivated: false,
                initialClientX: touch.clientX,
                initialClientY: touch.clientY,
                finishGesture: null,
            };
        };

        const handleTouchEnd = () => {
            touchState?.finishGesture?.();
            touchState = null;
        };

        const handleTouchMove = (event: TouchEvent) => {
            if (!touchState) return;
            if (event.touches.length !== 1) return;

            const touch = event.touches[0]!;

            const verticalActivationDistance = 8;
            const horizontalActivationDistance = 4;

            if (
                touchState.gesture === null &&
                Math.abs(touch.clientY - touchState.initialClientY) >= verticalActivationDistance
            ) {
                touchState.gesture = "Scroll";
            }

            if (
                touchState.gesture === null &&
                Math.abs(touch.clientX - touchState.initialClientX) >= horizontalActivationDistance
            ) {
                touchState.gesture = "Swipe";
                setIsPressed(false);
                setTouchSwipeState("Indeterminate");
                touchSwipeStateRef.current = "Indeterminate";

                touchState.finishGesture = () => {
                    const touchSwipeIconElement = touchSwipeIconRef.current;

                    if (!touchState?.hasSwipeGestureActivated) {
                        const animation = timeline(
                            [
                                [
                                    entryContentElement,
                                    {x: 0},
                                    {
                                        easing: parseCubicBezier(easeOutExpo.cubicBezier),
                                        // Make sure we use hardware acceleration for this animation in WebKit. By
                                        // default `motion` turns it off.
                                        // https://motion.dev/guides/performance#webkits-exceptions
                                        allowWebkitAcceleration: true,
                                    },
                                ],
                                [
                                    touchSwipeIconElement ?? [],
                                    {x: 0, opacity: 0},
                                    {
                                        at: 0,
                                        easing: parseCubicBezier(easeOutExpo.cubicBezier),
                                        // Make sure we use hardware acceleration for this animation in WebKit. By
                                        // default `motion` turns it off.
                                        // https://motion.dev/guides/performance#webkits-exceptions
                                        allowWebkitAcceleration: true,
                                    },
                                ],
                            ],
                            {
                                duration: 0.5,
                            },
                        );

                        void animation.finished.finally(() => {
                            setTouchSwipeState(null);
                            touchSwipeStateRef.current = null;
                        });
                    }
                    // The user swiped enough to archive the inbox entry. Animate the entry
                    // offscreen and perform archival with an animation.
                    else {
                        const animation = animate(
                            entryContentElement,
                            {x: -entryElement.clientWidth},
                            {
                                duration: 0.5,
                                easing: parseCubicBezier(easeOutExpo.cubicBezier),
                                // Make sure we use hardware acceleration for this animation in WebKit. By
                                // default `motion` turns it off.
                                // https://motion.dev/guides/performance#webkits-exceptions
                                allowWebkitAcceleration: true,
                            },
                        );

                        void animation.finished.finally(() => {
                            void events.onArchive({withAnimation: true});
                        });
                    }
                };
            }

            if (touchState.gesture === "Swipe") {
                event.preventDefault();

                const translateX =
                    (touch.clientX - touchState.initialClientX - horizontalActivationDistance) *
                    // We slow the drag animation down to make it feel like the user is dragging
                    // something heavy. But also this ends up smoothing out the animation! We only
                    // get `touchmove` events every whole pixel. But on devices like iPhone every
                    // virtual pixel is actually rendered by 2 to 3 hardware pixels. So animating
                    // 1:1 with `touchmove` events can looking subtly coarse since we're jumping
                    // across multiple hardware pixels per move.
                    (1 / 2);

                const touchSwipeIconElement = touchSwipeIconRef.current;

                const remPx = getRemPxWithoutListening();

                const minTouchSwipeIconElementTranslateX =
                    -inboxEntryViewTouchSwipeIconWidthRem * remPx;

                const touchSwipeIconElementTranslateX = Math.max(
                    translateX,
                    // The touch swipe icon finishes its animation once its left edge is where the
                    // message bubble left edge started.
                    minTouchSwipeIconElementTranslateX,
                );

                if (touchSwipeIconElementTranslateX === minTouchSwipeIconElementTranslateX) {
                    if (!touchState.hasSwipeGestureActivated) {
                        setTouchSwipeState("Activated");
                        touchSwipeStateRef.current = "Activated";

                        NativeMobileBridge?.haptic.playHeavyImpact();
                    }
                    touchState.hasSwipeGestureActivated = true;
                } else {
                    if (touchState.hasSwipeGestureActivated) {
                        setTouchSwipeState("Indeterminate");
                        touchSwipeStateRef.current = "Indeterminate";
                    }
                    touchState.hasSwipeGestureActivated = false;
                }

                timeline(
                    [
                        [entryContentElement, {x: translateX}],
                        [
                            touchSwipeIconElement ?? [],
                            {
                                x: touchSwipeIconElementTranslateX,
                                opacity:
                                    touchSwipeIconElementTranslateX /
                                    minTouchSwipeIconElementTranslateX,
                            },
                            {at: 0},
                        ],
                    ],
                    {duration: 0},
                );
            }
        };

        const handleTouchCancel = () => {
            touchState?.finishGesture?.();
            touchState = null;
        };

        entryElement.addEventListener("touchstart", handleTouchStart);
        entryElement.addEventListener("touchend", handleTouchEnd);
        entryElement.addEventListener("touchmove", handleTouchMove, {passive: false});
        entryElement.addEventListener("touchcancel", handleTouchCancel);

        return () => {
            setTouchSwipeState(null);
            touchSwipeStateRef.current = null;

            entryElement.removeEventListener("touchstart", handleTouchStart);
            entryElement.removeEventListener("touchend", handleTouchEnd);
            entryElement.removeEventListener("touchmove", handleTouchMove);
            entryElement.removeEventListener("touchcancel", handleTouchCancel);
        };
    }, [canPrimaryInputHover, events, filter]);

    const entryDisplay = useMemo(
        () => getInboxEntryDisplay({entry, locale, currentAccount}),
        [currentAccount, entry, locale],
    );

    const backgroundColor =
        isPressed && withBackgroundIfPressed ? "grey-10" : isSelected ? "grey-5" : undefined;

    useEffect(() => {
        if (!isPressed) return;

        const entryElement = assertExists(entryRef.current);

        const handlePointerUp = (event: PointerEvent) => {
            if (touchSwipeState !== null) {
                setIsPressed(false);
                return;
            }

            // Ignore pointer events from portals (e.g. menu opened by the `<MenuButton>`
            // shown on hover).
            if (event.target instanceof Node && !entryElement.contains(event.target)) {
                setIsPressed(false);
                return;
            }

            const wasPressed = isPressed;
            setIsPressed(false);
            if (wasPressed) events.onPress();
        };

        // Safari doesn't implement `pointerleave` correctly. So implement our own hit
        // testing on `pointermove`. This is the same thing `react-aria`'s `usePress()`
        // hook does.
        //
        // https://github.com/adobe/react-spectrum/blob/7da3d384aa0c6bdc14449c4f138e963a094a7a38/packages/%40react-aria/interactions/src/usePress.ts#L453-L456
        const handlePointerMove = (event: PointerEvent) => {
            const rect = entryElement.getBoundingClientRect();

            if (
                rect.left <= event.clientX &&
                event.clientX <= rect.right &&
                rect.top <= event.clientY &&
                event.clientY <= rect.bottom
            ) {
                // Pointer is still in element bounds...
            } else {
                setIsPressed(false);
            }
        };

        const handlePointerCancel = () => {
            setIsPressed(false);
        };

        document.addEventListener("pointerup", handlePointerUp);
        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointercancel", handlePointerCancel);

        return () => {
            document.removeEventListener("pointerup", handlePointerUp);
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointercancel", handlePointerCancel);
        };
    }, [events, isPressed, touchSwipeState]);

    const showLatestMessage =
        entryDisplay.latestMessage && entryDisplay.latestMessage.contentTextSnippet.length > 0;

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(hoverRef, entryRef)}
            // Our inbox implements the ARIA `listbox` role.
            // https://www.w3.org/WAI/ARIA/apg/patterns/listbox
            role="option"
            aria-selected={isSelected}
            aria-setsize={ariaSetsize}
            aria-posinset={ariaPosinset}
            paddingX={marginX}
            paddingTop={withMarginTop ? "1" : undefined}
            paddingBottom={withMarginBottom ? "1" : undefined}
            style={{minHeight: inboxEntryViewMinHeight}}
            // NOTE(calebmer): Not using `usePress()` here because that hook does something
            // weird with `event.preventDefault()` that causes the listbox in `<InboxView>`
            // to not be focused after a click.
            onPointerDown={event => {
                if (touchSwipeState !== null) return;

                // Ignore pointer events from portals (e.g. menu opened by the `<MenuButton>`
                // shown on hover).
                if (event.target instanceof Node && !event.currentTarget.contains(event.target))
                    return;

                setIsPressed(true);
                onPressStart?.();
            }}
            onDragStart={() => setIsPressed(false)}
        >
            <Box
                paddingX={paddingX}
                position="relative"
                zIndex="0"
                style={
                    // We use `backgroundColorVar` to draw an outline around avatars. Even though we
                    // use an absolutely positioned element to set the background color we still
                    // want `backgroundColorVar` to reflect the right value.
                    backgroundColor
                        ? assignInlineVars({[backgroundColorVar]: colorSchemeVars[backgroundColor]})
                        : undefined
                }
            >
                {!canPrimaryInputHover && (
                    // Render this background on touch devices when the swipe to archive gesture is
                    // enabled. When we archive an entry, the entries below it animate up to cover
                    // the deleted entry. Those entries need a background color to actually obscure
                    // the deleted entry.
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="-20"
                        backgroundColor="grey-0"
                        style={{top: 1}}
                    />
                )}
                {(isPressed && withBackgroundIfPressed) || isSelected ? (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="-10"
                        borderRadius={marginX !== "0" ? "1.5" : undefined}
                        backgroundColor={backgroundColor}
                        style={{
                            // Make sure background covers border of the entry below.
                            bottom: -1,
                        }}
                    />
                ) : (
                    <Box
                        position="absolute"
                        top="0"
                        bottom="0"
                        left="2.5"
                        right="2.5"
                        zIndex="-10"
                        style={{
                            // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                            // 1px to layout. Layout needs to be precise since this is rendered in a
                            // virtualized list.
                            boxShadow: [
                                `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                                ...(withBorderTop
                                    ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                    : []),
                            ].join(", "),
                        }}
                    />
                )}
                {touchSwipeState && (
                    <Box
                        position="absolute"
                        zIndex="-10"
                        bottom="0"
                        left="0"
                        right="0"
                        display="flex"
                        style={{
                            // Don't render on top of previous entry's border.
                            top: 1,
                        }}
                    >
                        {touchSwipeState === "Indeterminate" && <Box flexGrow="1" height="full" />}
                        <Box flexGrow="1" height="full" backgroundColor="green-40">
                            <Box
                                ref={touchSwipeIconRef}
                                position="absolute"
                                top="0"
                                bottom="0"
                                right={`-${inboxEntryViewTouchSwipeIconWidth}`}
                                width={inboxEntryViewTouchSwipeIconWidth}
                                display="flex"
                                flexDirection="column"
                                justifyContent="center"
                                alignItems="center"
                                color="green-80"
                                // Start at opacity 0. Opacity will be update during the swipe gesture.
                                opacity="0"
                            >
                                <Spacer space="0.5" />
                                <Check size={spacing["5"]} />
                                <Box fontSize="50" fontStyle="semi-bold">
                                    Done
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                )}
                <Box
                    ref={entryContentRef}
                    position="relative"
                    zIndex="0"
                    display="flex"
                    alignItems="center"
                    gap="3"
                >
                    {touchSwipeState && (
                        <Box
                            position="absolute"
                            zIndex="-10"
                            bottom="0"
                            left={
                                typeof paddingX === "string"
                                    ? `-${paddingX}`
                                    : {
                                          mobile: paddingX.mobile
                                              ? `-${paddingX.mobile}`
                                              : undefined,
                                          desktop: paddingX.desktop
                                              ? `-${paddingX.desktop}`
                                              : undefined,
                                      }
                            }
                            right={
                                typeof paddingX === "string"
                                    ? `-${paddingX}`
                                    : {
                                          mobile: paddingX.mobile
                                              ? `-${paddingX.mobile}`
                                              : undefined,
                                          desktop: paddingX.desktop
                                              ? `-${paddingX.desktop}`
                                              : undefined,
                                      }
                            }
                            backgroundColor="grey-0"
                            style={{
                                // Don't render on top of previous entry's border.
                                top: 1,
                            }}
                        />
                    )}
                    <Box flexShrink="0" width="10" paddingY="4">
                        <Box
                            position="relative"
                            width="10"
                            height="10"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                        >
                            {!entryDisplay.secondAccount ? (
                                <AccountAvatar account={entryDisplay.firstAccount} size="9" />
                            ) : (
                                <>
                                    <Box position="absolute" top="0" left="0">
                                        <AccountAvatar
                                            account={entryDisplay.firstAccount}
                                            size="7"
                                        />
                                    </Box>
                                    <Box
                                        position="absolute"
                                        bottom="0"
                                        right="0"
                                        borderRadius="full"
                                        style={{boxShadow: `0 0 0 2px ${backgroundColorVar}`}}
                                    >
                                        <AccountAvatar
                                            account={entryDisplay.secondAccount}
                                            size="7"
                                        />
                                    </Box>
                                </>
                            )}
                            <Box
                                position="absolute"
                                left="-2.5"
                                bottom="-2.5"
                                width="6"
                                height="6"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                borderRadius="full"
                                style={{
                                    backgroundColor: backgroundColorVar,
                                }}
                            >
                                <IconContext.Provider
                                    value={{
                                        color: colorSchemeVars[contentStyles.brandIconDefaultColor],
                                        size: spacing["4"],
                                    }}
                                >
                                    {entryDisplay.brandIcon}
                                </IconContext.Provider>
                            </Box>
                            {entry.loudNotificationCount > 0 && (
                                <LoudNotificationBadge
                                    top="0"
                                    right="1"
                                    count={entry.loudNotificationCount}
                                />
                            )}
                        </Box>
                    </Box>
                    <Box paddingY="4" flexGrow="1" fontSize="75" overflow="hidden">
                        <Box>
                            {useMemo(
                                () => renderInboxEntryDisplaySummary(entryDisplay.summary),
                                [entryDisplay.summary],
                            )}
                        </Box>
                        <Box
                            // Do not read the message preview for screen reader users. It will likely be
                            // confusing as the text cuts off eventually.
                            aria-hidden={true}
                            paddingTop="0.5"
                            width="full"
                            pointerEvents="none"
                            color="grey-50"
                            fontSize="50"
                            display="flex"
                            gap="0"
                        >
                            {useMemo(
                                () =>
                                    showLatestMessage && (
                                        <Box
                                            overflow="hidden"
                                            fontStyle="truncate"
                                            style={{
                                                // Render contextual alternate glyphs. Particularly important that we render
                                                // the right "@" for mentions.
                                                // eslint-disable-next-line string-quotes
                                                fontFeatureSettings: '"calt" on',
                                            }}
                                        >
                                            <AccountShortName
                                                account={entryDisplay.latestMessage.author}
                                                isTooltipDisabled={true}
                                            />
                                            :{" "}
                                            {renderTextWithEmojiFontFamily(
                                                entryDisplay.latestMessage.contentTextSnippet,
                                            )}
                                        </Box>
                                    ),
                                [entryDisplay.latestMessage, showLatestMessage],
                            )}
                            <Box flexShrink="0">
                                {showLatestMessage && <>&nbsp;∙&nbsp;</>}
                                {useMemo(() => {
                                    if (differenceInHours(currentTime, entryDisplay.time) < 24) {
                                        const formatter = getIntlDateTimeFormat({
                                            locale,
                                            timeZone,
                                            hour: "numeric",
                                            minute: "2-digit",
                                        });

                                        return formatter
                                            .format(entryDisplay.time)
                                            .replaceAll(/\s*(AM|PM)/g, string =>
                                                string.trim().toLowerCase(),
                                            );
                                    } else {
                                        const formatter = getIntlDateTimeFormat({
                                            locale,
                                            timeZone,
                                            month: "short",
                                            day: "numeric",
                                        });

                                        return formatter
                                            .format(entryDisplay.time)
                                            .replaceAll(/\s*(AM|PM)/g, string =>
                                                string.trim().toLowerCase(),
                                            );
                                    }
                                }, [currentTime, entryDisplay.time, locale, timeZone])}
                            </Box>
                        </Box>
                    </Box>
                </Box>
                {(isHovered || archiveFilterMoreMenuButtonState.isExpanded) && (
                    <Box
                        position="absolute"
                        bottom="0"
                        right="0"
                        paddingX="2"
                        paddingRight="4"
                        zIndex="10"
                        display="flex"
                        alignItems="center"
                        style={{
                            // Don't render over bottom border.
                            top: 1,
                        }}
                    >
                        <Box
                            position="absolute"
                            top="0"
                            bottom="0"
                            left="0"
                            width="10"
                            backgroundColor={backgroundColor ?? "grey-0"}
                        />
                        <Box
                            position="absolute"
                            top="0"
                            bottom="0"
                            left="-3"
                            width="3"
                            style={{
                                background: `linear-gradient(to left, ${
                                    colorSchemeVars[backgroundColor ?? "grey-0"]
                                }, transparent)`,
                            }}
                        />
                        {filter === "New" ? (
                            <IconButton
                                variant={
                                    backgroundColor ? "quiet-above-grey-5-background" : "quiet"
                                }
                                description="Done"
                                tooltipPlacement="bottom"
                                keyboardShortcutHint={
                                    isSelected ? (isAppleDevice ? "⌘+D" : "Ctrl+D") : undefined
                                }
                                pressErrorTitle="Couldn’t mark as done"
                                onPress={() => onArchive({withAnimation: false})}
                            >
                                <Check />
                            </IconButton>
                        ) : (
                            <MenuButton
                                placement="bottom-end"
                                actions={[
                                    {
                                        label: "Move to new",
                                        pressErrorTitle: "Couldn’t move to new",
                                        onPress: onUnarchive,
                                    },
                                ]}
                                onStateChange={state => {
                                    if (state.isExpanded) {
                                        setArchiveFilterMoreMenuButtonState({
                                            isExpanded: true,
                                            isAnimatingOut: false,
                                        });
                                    } else if (!state.disableAnimationOut) {
                                        setArchiveFilterMoreMenuButtonState(state => {
                                            if (!state.isExpanded) return state;

                                            return {
                                                isExpanded: true,
                                                isAnimatingOut: true,
                                            };
                                        });
                                    } else {
                                        setArchiveFilterMoreMenuButtonState({
                                            isExpanded: false,
                                        });
                                    }
                                }}
                            >
                                <IconButton
                                    variant={
                                        backgroundColor ? "quiet-above-grey-5-background" : "quiet"
                                    }
                                    description="More"
                                    tooltipPlacement="bottom"
                                >
                                    <DotsThree />
                                </IconButton>
                            </MenuButton>
                        )}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
