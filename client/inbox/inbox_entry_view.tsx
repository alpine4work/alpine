import {assignInlineVars} from "@vanilla-extract/dynamic";
import {differenceInHours} from "date-fns";
import {AnimationControls, animate} from "motion";
import {Check, DotsThree, IconContext} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {
    getInboxEntryDisplay,
    renderInboxEntryDisplaySummary,
} from "~/client/inbox/inbox_entry_display.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {inboxEntryViewMinHeight} from "~/shared/styles/inbox_shared_styles.js";
import {
    Sprinkles,
    backgroundColorVar,
    colorSchemeVars,
    overlayFadeOutAnimationDurationMs,
    searchStyles,
} from "~/shared/styles/styles.js";

export const inboxEntryWidth: Spacing = "96";

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
    paddingX?: Sprinkles["paddingX"];
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
    onArchive: () => MaybePromise<void>;
    onUnarchive: () => MaybePromise<void>;
}) {
    const currentTime = useCurrentTimeRoundedToHour();
    const {isAppleDevice, timeZone, locale} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const entryRef = useRef<HTMLDivElement>(null);
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

    const entryDisplay = useMemo(
        () => getInboxEntryDisplay({entry, locale, currentAccount}),
        [currentAccount, entry, locale],
    );

    const backgroundColor =
        isPressed && withBackgroundIfPressed ? "grey-10" : isSelected ? "grey-5" : undefined;

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
                // Ignore pointer events from portals (e.g. menu opened by the `<MenuButton>`
                // shown on hover).
                if (event.target instanceof Node && !event.currentTarget.contains(event.target))
                    return;

                setIsPressed(true);
                onPressStart?.();
            }}
            onPointerUp={event => {
                // Ignore pointer events from portals (e.g. menu opened by the `<MenuButton>`
                // shown on hover).
                if (event.target instanceof Node && !event.currentTarget.contains(event.target)) {
                    setIsPressed(false);
                    return;
                }

                const wasPressed = isPressed;
                setIsPressed(false);
                if (wasPressed) onPress?.();
            }}
            // Safari doesn't implement `pointerleave` correctly. So implement our own hit
            // testing on `pointermove`. This is the same thing `react-aria`'s `usePress()`
            // hook does.
            //
            // https://github.com/adobe/react-spectrum/blob/7da3d384aa0c6bdc14449c4f138e963a094a7a38/packages/%40react-aria/interactions/src/usePress.ts#L453-L456
            onPointerMove={event => {
                const rect = event.currentTarget.getBoundingClientRect();

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
            }}
            onPointerCancel={() => setIsPressed(false)}
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
                {((isPressed && withBackgroundIfPressed) || isSelected) && (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="-10"
                        borderRadius={marginX !== "0" ? "md" : undefined}
                        backgroundColor={backgroundColor}
                        style={{
                            // Make sure background covers border of the entry below.
                            bottom: -1,
                        }}
                    />
                )}
                <Box
                    display="flex"
                    alignItems="center"
                    gap="3"
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                        // 1px to layout. Layout needs to be precise since this is rendered in a
                        // virtualized list.
                        boxShadow:
                            !isSelected && !isPressed
                                ? [
                                      `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                                      ...(withBorderTop
                                          ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                          : []),
                                  ].join(", ")
                                : undefined,
                    }}
                >
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
                                <Box
                                    // Brand icons only render in the `grey-80` shade and above. So we can maintain
                                    // proper contrast between the icon line and color splash. However, here we
                                    // want to render a lighter line color (e.g. `grey-60`) to not distract from
                                    // the result title. We calculate the opacity to get us from `grey-80` to a
                                    // lighter line color (e.g. `grey-60`) and apply it. By applying opacity the
                                    // color splash also gets lighter to maintain proper contrast between the lines
                                    // and the color splash.
                                    className={searchStyles.brandIconOpacityClassName}
                                >
                                    <IconContext.Provider
                                        value={{
                                            color: searchStyles.brandIconColor,
                                            size: spacing["4"],
                                        }}
                                    >
                                        {entryDisplay.brandIcon}
                                    </IconContext.Provider>
                                </Box>
                            </Box>
                            {entry.loudNotificationCount > 0 && (
                                <LoudNotificationBadge
                                    top="0"
                                    right="1"
                                    loudNotificationCount={entry.loudNotificationCount}
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
                            <Box
                                overflow="hidden"
                                fontStyle="truncate"
                                style={{
                                    // Render contextual alternate glyphs. Particularly important that we render
                                    // the right "@" for mentions.
                                    fontFeatureSettings: '"calt" on',
                                }}
                            >
                                {useMemo(
                                    () =>
                                        entryDisplay.latestMessage && (
                                            <>
                                                <AccountShortName
                                                    account={entryDisplay.latestMessage.author}
                                                    isTooltipDisabled={true}
                                                />
                                                :{" "}
                                                {renderTextWithEmojiFontFamily(
                                                    entryDisplay.latestMessage.contentTextSnippet,
                                                )}
                                            </>
                                        ),
                                    [entryDisplay.latestMessage],
                                )}
                            </Box>
                            <Box flexShrink="0">
                                &nbsp;∙&nbsp;
                                {useMemo(() => {
                                    if (differenceInHours(currentTime, entryDisplay.time) < 24) {
                                        const formatter = new Intl.DateTimeFormat(locale, {
                                            timeZone,
                                            calendar: "iso8601",
                                            hour: "numeric",
                                            minute: "2-digit",
                                            hour12: true,
                                        });

                                        return formatter
                                            .format(entryDisplay.time)
                                            .replaceAll(/\s*(AM|PM)/g, string =>
                                                string.trim().toLowerCase(),
                                            );
                                    } else {
                                        const formatter = new Intl.DateTimeFormat(locale, {
                                            timeZone,
                                            calendar: "iso8601",
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
                        backgroundColor={backgroundColor ?? "grey-0"}
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
                                onPress={onArchive}
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
