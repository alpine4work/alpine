import {animate, spring} from "motion";
import {DotsThree} from "phosphor-react";
import {
    Fragment,
    Memo,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {ThumbsUpFill2Icon} from "~/client/web/icons/thumbs_up_fill2_icon.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {
    ReactionPickerRef,
    reactionPickerIconEmotions,
} from "~/client/web/reactions/internal/reaction_picker_base.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {withoutClearSelectionOnMouseDownClassName} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {Reaction, areReactionsEqual} from "~/shared/reactions/reaction.js";

const reactionBarAnimationInitialScale = 0.85;

const reactionBarOptionIconSize = "8";
const reactionBarOptionButtonIconSize = "5";
const reactionBarOptionButtonSize = "8";
const reactionBarOptionButtonSizeRem = parseRemLength(reactionBarOptionButtonSize);

// Spacing between items
const reactionBarItemGapRem = parseRemLength("1.5");

// Padding around the bar
const reactionBarPaddingRem = parseRemLength("1");

// Min/max item counts: thumbs up + N emotions + more button
const minItemCount = 4;
const maxItemCount = 8;

// Height is padding + item size + padding
const reactionBarHeightRem = reactionBarPaddingRem * 2 + reactionBarOptionButtonSizeRem;

/**
 * Calculate how many items can fit in the bar based on the available screen width.
 * Always includes thumbs up and more button and is bounded by `minItemCount` and `maxItemCount`.
 */
function calculateItemCount(screenWidthPx: number, spacingScale: SpacingScale): number {
    const remPx = remPxBySpacingScale[spacingScale];

    // Margin on each side of the bar in rem to ensure it doesn't touch screen edges
    const screenMarginRem = parseRemLength("1");

    // Available width after accounting for margin on each side
    const availableWidthPx = screenWidthPx - 2 * screenMarginRem * remPx;

    const paddingPx = reactionBarPaddingRem * remPx;
    const itemSizePx = reactionBarOptionButtonSizeRem * remPx;
    const gapPx = reactionBarItemGapRem * remPx;

    const maxFittingItems = Math.floor(
        (availableWidthPx - 2 * paddingPx + gapPx) / (itemSizePx + gapPx),
    );

    return Math.max(minItemCount, Math.min(maxItemCount, maxFittingItems));
}

/**
 * Calculate the bar width in rem based on the number of items.
 */
function calculateBarWidthRem(itemCount: number): number {
    return (
        reactionBarPaddingRem * 2 +
        itemCount * reactionBarOptionButtonSizeRem +
        (itemCount - 1) * reactionBarItemGapRem
    );
}

const ReactionBarPickerForwardRef = forwardRef(ReactionBarPicker);
export {ReactionBarPickerForwardRef as ReactionBarPicker};

/**
 * A picker for reactions that appears as a bar with a thumbs up button, emotions, and a more button.
 * The number of emotions shown adapts to fit the screen width (min 4 items, max 8 items total).
 * It is intended to be used on mobile devices and supports touch controls.
 */
function ReactionBarPicker(
    {
        isVisible,
        currentAccountReaction,
        onSetReaction: onSetReactionFromProps,
        onDeleteReaction: onDeleteReactionFromProps,
        onOpenMegaPicker: onOpenMegaPickerFromProps,
        onCloseWithAnimation,
        isPointerDownFromOverlayOpen,
    }: {
        isVisible: boolean;
        currentAccountReaction: Reaction | "GenericLike" | undefined;
        onSetReaction: (reaction: Reaction | "GenericLike") => void;
        onDeleteReaction: () => void;
        onOpenMegaPicker: () => void;
        onCloseWithAnimation: Memo<() => void>;
        isPointerDownFromOverlayOpen: boolean;
    },
    ref: Ref<ReactionPickerRef>,
) {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const currentAccountData = useAccountModel(currentAccount);

    const character = useMemo(
        () =>
            currentAccountData.reactionCharacter ??
            getLegacyFallbackReactionCharacterForId(currentAccount.id),
        [currentAccount.id, currentAccountData.reactionCharacter],
    );

    const missingCurrentAccountReaction: Reaction | null = useMemo(
        () =>
            currentAccountReaction &&
            currentAccountReaction !== "GenericLike" &&
            reactionPickerIconEmotions.every(
                emotion => !areReactionsEqual(currentAccountReaction, {character, emotion}),
            )
                ? currentAccountReaction
                : null,
        [character, currentAccountReaction],
    );

    const barContainerRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const barContentsRef = useRef<HTMLDivElement>(null);

    const hasInitiallyMountedRef = useRef(false);
    const pointerDownCleanupRef = useRef<((event: PointerEvent) => void) | null>(null);

    const [isPressed, setIsPressed] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    const {onSetReaction, onDeleteReaction, onOpenMegaPicker} = useEvents({
        onSetReaction: onSetReactionFromProps,
        onDeleteReaction: onDeleteReactionFromProps,
        onOpenMegaPicker: onOpenMegaPickerFromProps,
    });

    // Animation when the bar picker is mounted.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const barContainerElement = assertExists(barContainerRef.current);

        void animate(
            barContainerElement,
            {
                opacity: [0, 1],
                scale: [reactionBarAnimationInitialScale, 1],
            },
            {
                type: spring,
                stiffness: 350,
                damping: 22,
            },
        );
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            animateOut: () => {
                const barContainerElement = assertExists(barContainerRef.current);
                const barContentsElement = assertExists(barContentsRef.current);

                return animate([
                    [
                        barContainerElement,
                        {
                            opacity: 0,
                            scale: reactionBarAnimationInitialScale,
                        },
                        {
                            ease: "easeOut",
                            duration: 0.2,
                        },
                    ],

                    // Cross fade. The content should disappear first.
                    [
                        barContentsElement,
                        {
                            opacity: 0,
                        },
                        {
                            at: 0,
                            ease: "easeOut",
                            duration: 0.1,
                        },
                    ],
                ]);
            },
        }),
        [],
    );

    const {screenWidth} = useClientInfo();
    const spacingScale = useSpacingScale();

    // Calculate how many items can fit on screen
    const itemCount = calculateItemCount(screenWidth, spacingScale);
    const moreButtonIndex = itemCount - 1;
    // Number of emotion icons to show (itemCount minus thumbs up and more button)
    const emotionCount = itemCount - 2;
    const barWidthRem = calculateBarWidthRem(itemCount);

    const handleSelection = useCallback(
        (selectedIndex: number | null) => {
            if (selectedIndex === null) {
                onCloseWithAnimation();
            } else {
                if (selectedIndex === 0) {
                    if (currentAccountReaction === "GenericLike") {
                        onDeleteReaction();
                    } else {
                        onSetReaction("GenericLike");
                    }
                    onCloseWithAnimation();
                } else if (selectedIndex === moreButtonIndex) {
                    onOpenMegaPicker();
                } else {
                    const emotionIndex = selectedIndex - 1;
                    const emotion = reactionPickerIconEmotions[emotionIndex]!;

                    const reaction: Reaction =
                        missingCurrentAccountReaction && emotionIndex === 0
                            ? missingCurrentAccountReaction
                            : {character, emotion};

                    if (areReactionsEqual(reaction, currentAccountReaction)) {
                        onDeleteReaction();
                    } else {
                        onSetReaction(reaction);
                    }
                    onCloseWithAnimation();
                }
            }
        },
        [
            character,
            currentAccountReaction,
            missingCurrentAccountReaction,
            moreButtonIndex,
            onCloseWithAnimation,
            onDeleteReaction,
            onOpenMegaPicker,
            onSetReaction,
        ],
    );

    // Get the current active reaction index from pointer coordinates relative to the bar container.
    const calculateActiveIndex = useCallback(
        (xCoordinate: number, yCoordinate: number): number | null => {
            const barContainerElement = barContainerRef.current;
            if (!barContainerElement) return null;

            const barContainerRect = barContainerElement.getBoundingClientRect();

            const relativeX = xCoordinate - barContainerRect.left;
            const relativeY = yCoordinate - barContainerRect.top;

            const remPx = remPxBySpacingScale[spacingScale];
            const barWidthPx = barWidthRem * remPx;
            const barHeightPx = reactionBarHeightRem * remPx;
            const paddingPx = reactionBarPaddingRem * remPx;
            const itemSizePx = reactionBarOptionButtonSizeRem * remPx;
            const gapPx = reactionBarItemGapRem * remPx;

            // Check if pointer is within the bar bounds with a little tolerance to account for
            // slightly out of bounds pointer coordinates.
            const tolerance = reactionBarItemGapRem * remPx;
            const isWithinBounds =
                relativeX >= -tolerance &&
                relativeX <= barWidthPx + tolerance &&
                relativeY >= -tolerance &&
                relativeY <= barHeightPx + tolerance;

            if (isWithinBounds) {
                const contentX = relativeX - paddingPx;
                const itemWithGapWidth = itemSizePx + gapPx;
                const itemIndex = Math.floor(contentX / itemWithGapWidth);

                // Ensure we're within the valid range of items, rounding up or down to the nearest
                // valid index. This is useful in cases where our tolerance causes index values above
                // or below the valid range.
                const activeIndex = Math.max(0, Math.min(itemCount - 1, itemIndex));
                assert(
                    activeIndex >= 0 && activeIndex < itemCount,
                    "Invalid active reaction index from pointer coordinates",
                );
                return activeIndex;
            }
            return null;
        },
        [barWidthRem, itemCount, spacingScale],
    );

    useEffect(() => {
        // If we're closing the bar picker, don't update based on pointer position.
        if (!isVisible) return;

        const handlePointerMove = (event: PointerEvent) => {
            const newActiveIndex = calculateActiveIndex(event.clientX, event.clientY);
            setActiveIndex(newActiveIndex);
        };

        document.addEventListener("pointermove", handlePointerMove, {passive: true});
        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
        };
    }, [calculateActiveIndex, isVisible]);

    const shouldCloseOnPointerUpFromOverlayOpenRef = useRef(isPointerDownFromOverlayOpen);

    // Layout effect since when the pointer is released, we want the background color
    // of `<ReactionButton>` to change in the same paint as whatever this hook is
    // doing (which could be setting a reaction).
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldCloseOnPointerUpFromOverlayOpenRef.current) return;

        // Wait until pointer up.
        if (isPointerDownFromOverlayOpen) return;

        // Don't run this effect again.
        shouldCloseOnPointerUpFromOverlayOpenRef.current = false;

        if (activeIndex !== null) {
            handleSelection(activeIndex);
        }
    }, [activeIndex, handleSelection, isPointerDownFromOverlayOpen, onCloseWithAnimation]);

    // Clean up pointer event listeners on unmount to prevent memory leaks.
    useEffect(() => {
        return () => {
            if (pointerDownCleanupRef.current) {
                document.removeEventListener("pointerup", pointerDownCleanupRef.current);
                document.removeEventListener("pointercancel", pointerDownCleanupRef.current);
            }
        };
    }, []);

    // The background color for the like reaction varies based on selection and pointer interaction.
    // It is darkest when it is selected and interacted with, slightly lighter when selected and not
    // interacted with, and lightest when it is not selected but interacted with.
    const getThumbsUpBackgroundColor = useCallback(
        (isPressed: boolean, isPointerDownFromOverlayOpen: boolean) => {
            // Like is currently selected
            if (currentAccountReaction === "GenericLike") {
                // Like is currently active (the like icon is being pressed or the pointer is over it)
                if (activeIndex === 0) {
                    if (isPressed || isPointerDownFromOverlayOpen) {
                        return "grey-20";
                    } else {
                        return "grey-10";
                    }
                } else {
                    return "grey-5";
                }
                // Like is not currently selected
            } else {
                // Like is currently active (the like icon is being pressed or the pointer is over it)
                if (activeIndex === 0) {
                    if (isPressed || isPointerDownFromOverlayOpen) {
                        return "grey-10";
                    } else {
                        return "grey-5";
                    }
                    // Not selected or active
                } else {
                    return undefined;
                }
            }
        },
        [currentAccountReaction, activeIndex],
    );

    return (
        <Box
            ref={barContainerRef}
            // Don't clear the selection when clicking on the reaction bar picker. So
            // when you open the reaction bar picker from `<MessageViewPointerToolbar>`
            // then click on the empty space we don't clear the selection and close
            // the `<MessageViewPointerToolbar>`.
            className={withoutClearSelectionOnMouseDownClassName}
            pointerEvents="none"
            style={{
                width: `${barWidthRem}rem`,
                height: `${reactionBarHeightRem}rem`,
            }}
        >
            <Box
                ref={barRef}
                className={greyElevated2ClassName}
                position="relative"
                zIndex="0"
                pointerEvents="auto"
                boxShadow="elevation-30"
                overflow="hidden"
                borderRadius="full"
                display="flex"
                alignItems="center"
                backgroundColor="grey-0"
                style={{
                    width: `${barWidthRem}rem`,
                    height: `${reactionBarHeightRem}rem`,
                    padding: `${reactionBarPaddingRem}rem`,
                    gap: `${reactionBarItemGapRem}rem`,
                }}
                onPointerDown={() => {
                    setIsPressed(true);

                    const cleanup = (event: PointerEvent) => {
                        setIsPressed(false);

                        const finalActiveIndex = calculateActiveIndex(event.clientX, event.clientY);
                        handleSelection(finalActiveIndex);

                        document.removeEventListener("pointerup", cleanup);
                        document.removeEventListener("pointercancel", cleanup);
                        pointerDownCleanupRef.current = null;
                    };

                    pointerDownCleanupRef.current = cleanup;
                    document.addEventListener("pointerup", cleanup);
                    document.addEventListener("pointercancel", cleanup);
                }}
            >
                <Box
                    ref={barContentsRef}
                    display="flex"
                    alignItems="center"
                    style={{
                        gap: `${reactionBarItemGapRem}rem`,
                    }}
                >
                    <Box
                        // Remount this element when entering the pressed state so we don't animate the
                        // background color with the CSS transition.
                        key={`thumbsup-${isPressed}`}
                        width={reactionBarOptionButtonSize}
                        height={reactionBarOptionButtonSize}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={getThumbsUpBackgroundColor(
                            isPressed,
                            isPointerDownFromOverlayOpen,
                        )}
                        color={
                            activeIndex === 0 && (isPressed || isPointerDownFromOverlayOpen)
                                ? {light: "theme-60-const", dark: "theme-40-const"}
                                : "theme-50-const"
                        }
                        borderRadius="full"
                        style={{
                            transition:
                                "color 0.15s ease, background-color 0.15s ease, transform 0.15s ease",
                            transform: activeIndex === 0 ? "scale(1.15)" : undefined,
                        }}
                    >
                        <ThumbsUpFill2Icon size={spacing[reactionBarOptionButtonIconSize]} />
                    </Box>
                    {reactionPickerIconEmotions
                        .slice(0, emotionCount)
                        .map((emotion, emotionIndex) => {
                            const index = emotionIndex + 1;
                            const reaction =
                                missingCurrentAccountReaction && emotionIndex === 0
                                    ? missingCurrentAccountReaction
                                    : {character, emotion};

                            const isSelected = areReactionsEqual(currentAccountReaction, reaction);
                            const extraSelectionHighlightSize = "1";

                            return (
                                <Fragment key={index}>
                                    <Box
                                        position="relative"
                                        width={reactionBarOptionButtonSize}
                                        height={reactionBarOptionButtonSize}
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                    >
                                        {isSelected && (
                                            <Box
                                                position="absolute"
                                                borderRadius="full"
                                                backgroundColor="grey-5"
                                                style={{
                                                    width: addRemLengths(
                                                        reactionBarOptionIconSize,
                                                        extraSelectionHighlightSize,
                                                    ),
                                                    height: addRemLengths(
                                                        reactionBarOptionIconSize,
                                                        extraSelectionHighlightSize,
                                                    ),
                                                }}
                                            />
                                        )}
                                        <Box
                                            position="relative"
                                            // Push the icons up to visually center them with the thumbs up icon.
                                            marginBottom="1"
                                            style={{
                                                transition: "transform 0.15s ease",
                                                transform:
                                                    activeIndex === index
                                                        ? "scale(1.2)"
                                                        : undefined,
                                            }}
                                        >
                                            <ReactionIcon
                                                reaction={reaction}
                                                size={reactionBarOptionIconSize}
                                            />
                                        </Box>
                                    </Box>
                                </Fragment>
                            );
                        })}
                    <Box
                        // Remount this element when entering the pressed state so we don't animate the
                        // background color with the CSS transition. If the user presses and moves
                        // their mouse around, then we want to animate. We only want an immediate
                        // response to the press action.
                        key={`more-${isPressed}`}
                        width={reactionBarOptionButtonSize}
                        height={reactionBarOptionButtonSize}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={
                            activeIndex === moreButtonIndex
                                ? isPressed || isPointerDownFromOverlayOpen
                                    ? "grey-10"
                                    : "grey-5"
                                : undefined
                        }
                        color={activeIndex === moreButtonIndex ? "grey-100" : "grey-70"}
                        borderRadius="full"
                    >
                        <DotsThree size={spacing[reactionBarOptionButtonIconSize]} />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
