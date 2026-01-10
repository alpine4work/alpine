import {animate, spring} from "motion";
import {CaretUp, DotsThree} from "phosphor-react";
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
import {orderedReactionEmotions} from "~/client/web/reactions/internal/ordered_reaction_characters_and_emotions.js";
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

// Expanded emotion picker constants
const expandedEmotionRowGapRem = parseRemLength("1");

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
        onCloseWithAnimation,
        isPointerDownFromOverlayOpen,
    }: {
        isVisible: boolean;
        currentAccountReaction: Reaction | "GenericLike" | undefined;
        onSetReaction: (reaction: Reaction | "GenericLike") => void;
        onDeleteReaction: () => void;
        onCloseWithAnimation: Memo<() => void>;
        isPointerDownFromOverlayOpen: boolean;
    },
    ref: Ref<ReactionPickerRef>,
) {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const {screenWidth} = useClientInfo();
    const spacingScale = useSpacingScale();

    const currentAccountData = useAccountModel(currentAccount);

    const character = useMemo(
        () =>
            currentAccountData.reactionCharacter ??
            getLegacyFallbackReactionCharacterForId(currentAccount.id),
        [currentAccount.id, currentAccountData.reactionCharacter],
    );

    const barContainerRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const barContentsRef = useRef<HTMLDivElement>(null);
    const expandedReactionsRef = useRef<HTMLDivElement>(null);

    const hasInitiallyMountedRef = useRef(false);
    const pointerDownCleanupRef = useRef<((event: PointerEvent) => void) | null>(null);

    const [isPressed, setIsPressed] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    // Store the displayed primary reactions and extra reactions so we can freeze them during
    // interaction. This prevents the UI from changing while the user is interacting with the picker.
    const [primaryReactions, setPrimaryReactions] = useState<Array<Reaction>>([]);
    const [extraReactions, setExtraReactions] = useState<Array<Reaction>>([]);

    const {onSetReaction, onDeleteReaction} = useEvents({
        onSetReaction: onSetReactionFromProps,
        onDeleteReaction: onDeleteReactionFromProps,
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

    // Calculate how many items can fit on screen
    const itemCount = calculateItemCount(screenWidth, spacingScale);
    const moreButtonIndex = itemCount - 1;
    // Number of emotion icons to show (itemCount minus thumbs up and more button)
    const emotionCount = itemCount - 2;
    const barWidthRem = calculateBarWidthRem(itemCount);

    // The primary bar shows `emotionCount` emotions from `reactionPickerIconEmotions` plus the
    // current account reaction if it's a reaction that is not normally shown in the primary bar.
    // The expanded bar shows all remaining emotions.
    const getReactions = useCallback(() => {
        const extraEmotions = orderedReactionEmotions.filter(
            emotion => !reactionPickerIconEmotions.includes(emotion),
        );
        // True if we do not need to append the current account reaction to the primary bar.
        if (
            !currentAccountReaction ||
            currentAccountReaction === "GenericLike" ||
            reactionPickerIconEmotions
                .slice(0, emotionCount)
                .some(emotion => areReactionsEqual(currentAccountReaction, {character, emotion}))
        ) {
            return {
                barReactions: [
                    ...reactionPickerIconEmotions
                        .slice(0, emotionCount)
                        .map(emotion => ({character, emotion})),
                ],
                extraReactions: [
                    ...reactionPickerIconEmotions
                        .slice(emotionCount)
                        .map(emotion => ({character, emotion})),
                    ...extraEmotions.map(emotion => ({character, emotion})),
                ],
            };
        } else {
            return {
                barReactions: [
                    currentAccountReaction,
                    ...reactionPickerIconEmotions
                        .slice(0, emotionCount - 1)
                        .map(emotion => ({character, emotion})),
                ],
                extraReactions: [
                    ...reactionPickerIconEmotions
                        .slice(emotionCount - 1)
                        .map(emotion => ({character, emotion})),
                    ...extraEmotions
                        .filter(
                            emotion =>
                                !areReactionsEqual(currentAccountReaction, {character, emotion}),
                        )
                        .map(emotion => ({character, emotion})),
                ],
            };
        }
    }, [currentAccountReaction, character, emotionCount]);

    // Calculate how many emotions fit per row based on bar width
    const extraReactionsRowCount = Math.ceil(extraReactions.length / itemCount);

    // Calculate expanded height for extra emotions
    const expandedReactionsHeightRem =
        extraReactionsRowCount * reactionBarOptionButtonSizeRem +
        (extraReactionsRowCount - 1) * expandedEmotionRowGapRem +
        reactionBarPaddingRem; // padding at top

    const expandReactionsPicker = useCallback(() => {
        setIsExpanded(true);
        setActiveIndex(null);

        const barElement = barRef.current;
        const expandedReactionsElement = expandedReactionsRef.current;
        if (!barElement || !expandedReactionsElement) return;

        const remPx = remPxBySpacingScale[spacingScale];
        const expandedHeightPx = expandedReactionsHeightRem * remPx;

        void animate(
            expandedReactionsElement,
            {
                height: `${expandedHeightPx}px`,
                paddingTop: `${reactionBarPaddingRem}rem`,
                opacity: 1,
            },
            {
                type: spring,
                stiffness: 350,
                damping: 28,
            },
        );

        // Animate negative margin-top to make the bar expand upward (bottom stays fixed)
        void animate(
            barElement,
            {
                marginTop: `${-expandedHeightPx}px`,
            },
            {
                type: spring,
                stiffness: 350,
                damping: 28,
            },
        );
    }, [expandedReactionsHeightRem, spacingScale]);

    const collapseEmotionPicker = useCallback(() => {
        setIsExpanded(false);
        setActiveIndex(null);

        const barElement = barRef.current;
        const expandedReactionsElement = expandedReactionsRef.current;
        if (!barElement || !expandedReactionsElement) return;

        void animate(
            expandedReactionsElement,
            {
                height: 0,
                opacity: 0,
                paddingTop: 0,
            },
            {
                type: spring,
                stiffness: 350,
                damping: 28,
            },
        );
        void animate(
            barElement,
            {
                marginTop: 0,
            },
            {
                type: spring,
                stiffness: 350,
                damping: 28,
            },
        );
    }, []);

    const handleSelection = useCallback(
        (selectedIndex: number | null) => {
            if (selectedIndex === null) {
                onCloseWithAnimation();
            } else if (selectedIndex >= itemCount) {
                // Selection in the expanded emotions grid
                const expandedReactionIndex = selectedIndex - itemCount;
                const reaction = extraReactions[expandedReactionIndex];
                if (reaction) {
                    if (areReactionsEqual(reaction, currentAccountReaction)) {
                        onDeleteReaction();
                    } else {
                        onSetReaction(reaction);
                    }
                    onCloseWithAnimation();
                }
            } else {
                // Selection in the main bar
                if (selectedIndex === 0) {
                    if (currentAccountReaction === "GenericLike") {
                        onDeleteReaction();
                    } else {
                        onSetReaction("GenericLike");
                    }
                    onCloseWithAnimation();
                } else if (selectedIndex === moreButtonIndex) {
                    if (isExpanded) {
                        collapseEmotionPicker();
                    } else {
                        expandReactionsPicker();
                    }
                } else {
                    const primaryReactionIndex = selectedIndex - 1;
                    const reaction = primaryReactions[primaryReactionIndex]!;

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
            collapseEmotionPicker,
            currentAccountReaction,
            expandReactionsPicker,
            extraReactions,
            isExpanded,
            itemCount,
            moreButtonIndex,
            primaryReactions,
            onCloseWithAnimation,
            onDeleteReaction,
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
            const mainBarHeightPx = reactionBarHeightRem * remPx;
            const expandedReactionsHeightPx = expandedReactionsHeightRem * remPx;
            const totalBarHeightPx = mainBarHeightPx + (isExpanded ? expandedReactionsHeightPx : 0);
            const paddingPx = reactionBarPaddingRem * remPx;
            const itemSizePx = reactionBarOptionButtonSizeRem * remPx;
            const gapPx = reactionBarItemGapRem * remPx;
            const expandedRowGapPx = expandedEmotionRowGapRem * remPx;

            // Check if pointer is within the bar bounds with a little tolerance to account for
            // slightly out of bounds pointer coordinates.
            const tolerance = reactionBarItemGapRem * remPx;
            const isWithinBounds =
                relativeX >= -tolerance &&
                relativeX <= barWidthPx + tolerance &&
                relativeY >= -tolerance &&
                relativeY <= totalBarHeightPx + tolerance;

            if (isWithinBounds) {
                const contentX = relativeX - paddingPx;
                const itemWithGapWidth = itemSizePx + gapPx;

                // When expanded, the expanded emotions are at the top (y=0 to expandedReactionsHeightPx)
                // and the main bar is at the bottom (y=expandedReactionsHeightPx to totalBarHeightPx)
                const isWithinExpandedEmotions =
                    isExpanded && relativeY < expandedReactionsHeightPx;

                if (isWithinExpandedEmotions) {
                    if (extraReactions.length === 0) return null;

                    // Calculate which row in the expanded emotions grid
                    // Account for padding at the top of the expanded section
                    const expandedContentY = relativeY - paddingPx;
                    const rowWithGapHeight = itemSizePx + expandedRowGapPx;
                    const rowIndex = Math.floor(expandedContentY / rowWithGapHeight);

                    // Clamp row to valid range
                    const clampedRowIndex = Math.max(
                        0,
                        Math.min(extraReactionsRowCount - 1, rowIndex),
                    );

                    // Calculate how many items are in this row - distribute remainder evenly
                    // with extra items pushed to bottom rows
                    const totalItems = extraReactions.length;
                    const baseItemsPerRow = Math.floor(totalItems / extraReactionsRowCount);
                    const remainder = totalItems % extraReactionsRowCount;
                    const itemsInThisRow =
                        baseItemsPerRow +
                        (clampedRowIndex >= extraReactionsRowCount - remainder ? 1 : 0);

                    // The expanded emotions are centered, so we need to
                    // calculate the centering offset to correctly determine which column was clicked
                    const availableWidth = barWidthPx - 2 * paddingPx;
                    const rowWidth = itemsInThisRow * itemSizePx + (itemsInThisRow - 1) * gapPx;
                    const centeringOffset = (availableWidth - rowWidth) / 2;

                    // Adjust contentX by the centering offset
                    const centeredContentX = contentX - centeringOffset;
                    const colIndex = Math.floor(centeredContentX / itemWithGapWidth);

                    // Clamp column to valid range for this row
                    const clampedColIndex = Math.max(0, Math.min(itemsInThisRow - 1, colIndex));

                    // Calculate start index for this row
                    let startIndex = 0;
                    for (let i = 0; i < clampedRowIndex; i++) {
                        const prevRowItems =
                            baseItemsPerRow + (i >= extraReactionsRowCount - remainder ? 1 : 0);
                        startIndex += prevRowItems;
                    }

                    // Calculate the index within the expanded emotions
                    const expandedReactionIndex = startIndex + clampedColIndex;

                    // Clamp to actual number of extra emotions
                    const clampedExpandedIndex = Math.min(
                        expandedReactionIndex,
                        extraReactions.length - 1,
                    );

                    // Return index starting from itemCount (after the main bar's indices)
                    return itemCount + clampedExpandedIndex;
                } else {
                    // In the main bar area (items fill the width, no centering offset)
                    const colIndex = Math.floor(contentX / itemWithGapWidth);
                    const clampedColIndex = Math.max(0, Math.min(itemCount - 1, colIndex));
                    return clampedColIndex;
                }
            }
            return null;
        },
        [
            barWidthRem,
            expandedReactionsHeightRem,
            extraReactionsRowCount,
            extraReactions.length,
            isExpanded,
            itemCount,
            spacingScale,
        ],
    );

    // Update the reactions once the user has finished interacting with the picker.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isPressed && !isPointerDownFromOverlayOpen && isVisible) {
            const {barReactions, extraReactions} = getReactions();
            setPrimaryReactions(barReactions);
            setExtraReactions(extraReactions);
        }
    }, [isPressed, isPointerDownFromOverlayOpen, isVisible, getReactions]);

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
                display="flex"
                flexDirection="column"
                backgroundColor="grey-0"
                style={{
                    width: `${barWidthRem}rem`,
                    borderRadius: `${reactionBarHeightRem / 2}rem`,
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
                    ref={expandedReactionsRef}
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    overflow="hidden"
                    style={{
                        height: 0,
                        opacity: 0,
                        paddingLeft: `${reactionBarPaddingRem}rem`,
                        paddingRight: `${reactionBarPaddingRem}rem`,
                        gap: `${expandedEmotionRowGapRem}rem`,
                    }}
                >
                    {Array.from({length: extraReactionsRowCount}).map((_, rowIndex) => {
                        // Calculate how many items are in this row - distribute remainder evenly
                        // with extra items pushed to bottom rows
                        const totalItems = extraReactions.length;
                        const baseItemsPerRow = Math.floor(totalItems / extraReactionsRowCount);
                        const remainder = totalItems % extraReactionsRowCount;
                        const itemsInThisRow =
                            baseItemsPerRow +
                            (rowIndex >= extraReactionsRowCount - remainder ? 1 : 0);

                        // Calculate start index for this row
                        let startIndex = 0;
                        for (let i = 0; i < rowIndex; i++) {
                            const prevRowItems =
                                baseItemsPerRow + (i >= extraReactionsRowCount - remainder ? 1 : 0);
                            startIndex += prevRowItems;
                        }
                        const rowReactions = extraReactions.slice(
                            startIndex,
                            startIndex + itemsInThisRow,
                        );

                        return (
                            <Box
                                key={rowIndex}
                                display="flex"
                                justifyContent="center"
                                style={{
                                    gap: `${reactionBarItemGapRem}rem`,
                                }}
                            >
                                {rowReactions.map((reaction, reactionIndexInRow) => {
                                    // Index starts at itemCount after the main bar indexes.
                                    const expandedIndex =
                                        itemCount + startIndex + reactionIndexInRow;
                                    const isActive = activeIndex === expandedIndex;
                                    const isSelected = areReactionsEqual(
                                        currentAccountReaction,
                                        reaction,
                                    );

                                    return (
                                        <Box
                                            key={`${reaction.character.type}-${reaction.emotion}`}
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
                                                            "1",
                                                        ),
                                                        height: addRemLengths(
                                                            reactionBarOptionIconSize,
                                                            "1",
                                                        ),
                                                    }}
                                                />
                                            )}
                                            <Box
                                                position="relative"
                                                marginBottom="1"
                                                style={{
                                                    transition: "transform 0.15s ease",
                                                    transform: isActive ? "scale(1.2)" : undefined,
                                                }}
                                            >
                                                <ReactionIcon
                                                    reaction={reaction}
                                                    size={reactionBarOptionIconSize}
                                                />
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        );
                    })}
                </Box>

                <Box
                    ref={barContentsRef}
                    display="flex"
                    alignItems="center"
                    style={{
                        padding: `${reactionBarPaddingRem}rem`,
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
                    {primaryReactions.map((reaction, reactionIndex) => {
                        const index = reactionIndex + 1;

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
                                                activeIndex === index ? "scale(1.2)" : undefined,
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
                        {isExpanded ? (
                            <CaretUp
                                size={spacing[reactionBarOptionButtonIconSize]}
                                weight="bold"
                            />
                        ) : (
                            <DotsThree size={spacing[reactionBarOptionButtonIconSize]} />
                        )}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
