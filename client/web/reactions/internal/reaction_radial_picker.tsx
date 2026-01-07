import {AnimationPlaybackControls, animate, spring} from "motion";
import {DotsThree} from "phosphor-react";
import {
    Fragment,
    Memo,
    Ref,
    forwardRef,
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
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {reactionRadialPickerSizeRem} from "~/client/web/styles/reaction_shared_styles.js";
import {
    colorSchemeVars,
    withoutClearSelectionOnMouseDownClassName,
} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {Reaction, ReactionEmotion, areReactionsEqual} from "~/shared/reactions/reaction.js";

const reactionRadialPickerAnimationInitialScale = 0.25;

const reactionRadialPickerOptionOffsetRem = parseRemLength("10") + parseRemLength("2");

const reactionRadialPickerOptionIconSize = "8";
const reactionRadialPickerOptionIconActiveExtraOffsetRem = parseRemLength("1");

const reactionRadialPickerOptionIconPositionCenterRem =
    reactionRadialPickerSizeRem / 2 - parseRemLength(reactionRadialPickerOptionIconSize) / 2;

const reactionRadialPickerOptionButtonIconSize = "5";
const reactionRadialPickerOptionButtonSize = "8";
const reactionRadialPickerOptionButtonSizeRem = parseRemLength(
    reactionRadialPickerOptionButtonSize,
);

const reactionRadialPickerOptionButtonPositionCenterRem =
    reactionRadialPickerSizeRem / 2 - reactionRadialPickerOptionButtonSizeRem / 2;

const reactionRadialPickerDonutWidthRem =
    (reactionRadialPickerSizeRem / 2 -
        (reactionRadialPickerOptionOffsetRem + reactionRadialPickerOptionButtonSizeRem / 2)) *
        2 +
    reactionRadialPickerOptionButtonSizeRem;

export type ReactionRadialPickerRef = {
    animateOut(): AnimationPlaybackControls;
};

const ReactionRadialPickerForwardRef = forwardRef(ReactionRadialPicker);
export {ReactionRadialPickerForwardRef as ReactionRadialPicker};

const reactionRadialPickerIconEmotions: ReadonlyArray<ReactionEmotion> = [
    "Laugh",
    "Celebrate",
    "Yes",
    "DeadInside",
    "Shock",
    "Lolsob",
];

function ReactionRadialPicker(
    {
        isVisible,
        currentAccountReaction,
        onSetReaction: onSetReactionFromProps,
        onDeleteReaction: onDeleteReactionFromProps,
        onOpenMegaPicker: onOpenMegaPickerFromProps,
        onCloseWithAnimation,
        isMouseDownFromOverlayOpen,
    }: {
        isVisible: boolean;
        currentAccountReaction: Reaction | "GenericLike" | undefined;
        onSetReaction: (reaction: Reaction | "GenericLike") => void;
        onDeleteReaction: () => void;
        onOpenMegaPicker: () => void;
        onCloseWithAnimation: Memo<() => void>;
        isMouseDownFromOverlayOpen: boolean;
    },
    ref: Ref<ReactionRadialPickerRef>,
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
            reactionRadialPickerIconEmotions.every(
                emotion => !areReactionsEqual(currentAccountReaction, {character, emotion}),
            )
                ? currentAccountReaction
                : null,
        [character, currentAccountReaction],
    );

    const circleContainerRef = useRef<HTMLDivElement>(null);
    const circleRef = useRef<HTMLDivElement>(null);
    const circleContentsRef = useRef<HTMLDivElement>(null);

    const hasInitiallyMountedRef = useRef(false);

    const [isPressed, setIsPressed] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    const {onSetReaction, onDeleteReaction, onOpenMegaPicker} = useEvents({
        onSetReaction: onSetReactionFromProps,
        onDeleteReaction: onDeleteReactionFromProps,
        onOpenMegaPicker: onOpenMegaPickerFromProps,
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const circleContainerElement = assertExists(circleContainerRef.current);

        void animate(
            circleContainerElement,
            {
                opacity: [0, 1],
                scale: [reactionRadialPickerAnimationInitialScale, 1],
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
                const circleContainerElement = assertExists(circleContainerRef.current);
                const circleContentsElement = assertExists(circleContentsRef.current);

                return animate([
                    [
                        circleContainerElement,
                        {
                            opacity: 0,
                            scale: reactionRadialPickerAnimationInitialScale,
                        },
                        {
                            ease: "easeOut",
                            duration: 0.2,
                        },
                    ],

                    // Cross fade. The content should disappear first.
                    [
                        circleContentsElement,
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

    useEffect(() => {
        // If we're closing the radial picker, don't update the transform based on the
        // pointer position.
        if (!isVisible) return;

        const circleElement = assertExists(circleRef.current);
        const circleContainerElement = assertExists(circleContainerRef.current);

        const handlePointerMove = (event: PointerEvent) => {
            const spacingScale = getSpacingScaleWithoutListening();

            const circleContainerRect = circleContainerElement.getBoundingClientRect();
            const circleContainerCenterX = circleContainerRect.left + circleContainerRect.width / 2;
            const circleContainerCenterY = circleContainerRect.top + circleContainerRect.height / 2;

            const pointerVector = new Vector2(
                event.clientX - circleContainerCenterX,
                event.clientY - circleContainerCenterY,
            );

            // Move the circle so it follows the pointer.
            {
                const maxTransformMagnitude = convertRemLengthToPx("12", spacingScale);
                const inflectionPointerMagnitude = convertRemLengthToPx("64", spacingScale);

                const transformMagnitude =
                    maxTransformMagnitude *
                    (pointerVector.magnitude /
                        (pointerVector.magnitude + inflectionPointerMagnitude));

                const transformVector = Vector2.fromPolar(pointerVector.angle, transformMagnitude);

                circleElement.style.transform = `translate(${transformVector.x}px, ${transformVector.y}px)`;
            }

            // Detect which icon is active. (So if there's a click, we'll select
            // this icon.)
            {
                const minActiveMagnitude =
                    ((reactionRadialPickerSizeRem - reactionRadialPickerDonutWidthRem * 2) / 2) *
                    remPxBySpacingScale[spacingScale];

                const activeIndex =
                    (Math.round((pointerVector.angle / (2 * Math.PI) + 0.25) * 8) + 8) % 8;

                setActiveIndex(pointerVector.magnitude > minActiveMagnitude ? activeIndex : null);
            }
        };

        // Called when the pointer leaves the document.
        const handlePointerLeave = () => {
            onCloseWithAnimation();
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointerleave", handlePointerLeave);
        };
    }, [isVisible, onCloseWithAnimation]);

    const shouldCloseOnMouseUpFromOverlayOpenRef = useRef(isMouseDownFromOverlayOpen);

    // Layout effect since when the mouse is released, we want the background color
    // of `<ReactionButton>` to change in the same paint as whatever this hook is
    // doing (which could be setting a like or opening the mega picker).
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldCloseOnMouseUpFromOverlayOpenRef.current) return;

        // Wait until mouse up.
        if (isMouseDownFromOverlayOpen) return;

        // Don't run this effect again.
        shouldCloseOnMouseUpFromOverlayOpenRef.current = false;

        // Don't select if the mouse is over the center heart button.
        if (activeIndex !== null) {
            if (activeIndex === 0) {
                if (currentAccountReaction === "GenericLike") {
                    onDeleteReaction();
                } else {
                    onSetReaction("GenericLike");
                }
                onCloseWithAnimation();
            } else if (activeIndex === 4) {
                onOpenMegaPicker();
            } else {
                const emotionIndex = activeIndex > 4 ? activeIndex - 2 : activeIndex - 1;
                const emotion = reactionRadialPickerIconEmotions[emotionIndex]!;

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
    }, [
        activeIndex,
        character,
        currentAccountReaction,
        isMouseDownFromOverlayOpen,
        missingCurrentAccountReaction,
        onCloseWithAnimation,
        onDeleteReaction,
        onOpenMegaPicker,
        onSetReaction,
    ]);

    return (
        <Box
            ref={circleContainerRef}
            // Don't clear the selection when clicking on the reaction radial picker. So
            // when you open the reaction radial picker from `<MessageViewPointerToolbar>`
            // then click on the empty space in the middle of the radial picker we don't
            // clear the selection and close the `<MessageViewPointerToolbar>`.
            className={withoutClearSelectionOnMouseDownClassName}
            pointerEvents="none"
            style={{
                width: `${reactionRadialPickerSizeRem}rem`,
                height: `${reactionRadialPickerSizeRem}rem`,
            }}
        >
            <Box
                ref={circleRef}
                className={greyElevated2ClassName}
                position="relative"
                zIndex="0"
                pointerEvents="auto"
                boxShadow="elevation-30"
                overflow="hidden"
                borderRadius="full"
                style={{
                    width: `${reactionRadialPickerSizeRem}rem`,
                    height: `${reactionRadialPickerSizeRem}rem`,
                }}
                onPointerDown={event => {
                    const circleElement = event.currentTarget;
                    const circleRect = circleElement.getBoundingClientRect();

                    const circleCenterX = circleRect.left + circleRect.width / 2;
                    const circleCenterY = circleRect.top + circleRect.height / 2;
                    const circleRadius = circleRect.width / 2;

                    const pointerVector = new Vector2(
                        event.clientX - circleCenterX,
                        event.clientY - circleCenterY,
                    );

                    // Clicks within the `<Box>`'s rectangle (before applying `borderRadius`) are
                    // sent to this element's `onPointerDown` handler. Make sure the click is within
                    // the radial picker circle, not in empty space just outside the circle.
                    if (pointerVector.magnitude > circleRadius) {
                        onCloseWithAnimation();
                        return;
                    }

                    setIsPressed(true);

                    const cleanup = () => {
                        setIsPressed(false);

                        document.removeEventListener("pointerup", cleanup);
                        document.removeEventListener("pointercancel", cleanup);
                        document.removeEventListener("dragstart", cleanup);

                        if (activeIndex === null) {
                            onCloseWithAnimation();
                        } else {
                            if (activeIndex === 0) {
                                if (currentAccountReaction === "GenericLike") {
                                    onDeleteReaction();
                                } else {
                                    onSetReaction("GenericLike");
                                }
                                onCloseWithAnimation();
                            } else if (activeIndex === 4) {
                                onOpenMegaPicker();
                            } else {
                                const emotionIndex =
                                    activeIndex > 4 ? activeIndex - 2 : activeIndex - 1;
                                const emotion = reactionRadialPickerIconEmotions[emotionIndex]!;

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
                    };

                    document.addEventListener("pointerup", cleanup);
                    document.addEventListener("pointercancel", cleanup);
                    document.addEventListener("dragstart", cleanup);
                }}
            >
                <Box
                    position="absolute"
                    inset="0"
                    zIndex="-20"
                    borderRadius="full"
                    boxShadow="elevation-30-inset"
                    style={{
                        border: `${reactionRadialPickerDonutWidthRem}rem solid ${colorSchemeVars["grey-0"]}`,
                    }}
                />
                <Box
                    ref={circleContentsRef}
                    position="relative"
                    style={{
                        width: `${reactionRadialPickerSizeRem}rem`,
                        height: `${reactionRadialPickerSizeRem}rem`,
                    }}
                >
                    {createArrayWithLength(8, index => {
                        const vector = Vector2.fromPolar(
                            index * ((2 * Math.PI) / 8) - Math.PI / 2,
                            reactionRadialPickerOptionOffsetRem,
                        );

                        if (index === 0) {
                            return (
                                <Box
                                    // Remount this element when entering the pressed state so we don't animate the
                                    // background color with the CSS transition. If the user presses and moves
                                    // their mouse around, then we want to animate. We only want an immediate
                                    // response to the press action.
                                    key={`${index}-${isPressed}`}
                                    position="absolute"
                                    width={reactionRadialPickerOptionButtonSize}
                                    height={reactionRadialPickerOptionButtonSize}
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    backgroundColor={
                                        currentAccountReaction === "GenericLike"
                                            ? activeIndex === index
                                                ? isPressed || isMouseDownFromOverlayOpen
                                                    ? "grey-20"
                                                    : "grey-10"
                                                : "grey-5"
                                            : activeIndex === index
                                              ? isPressed || isMouseDownFromOverlayOpen
                                                  ? "grey-10"
                                                  : "grey-5"
                                              : undefined
                                    }
                                    color={
                                        activeIndex === index &&
                                        (isPressed || isMouseDownFromOverlayOpen)
                                            ? {light: "theme-60-const", dark: "theme-40-const"}
                                            : "theme-50-const"
                                    }
                                    borderRadius="full"
                                    style={{
                                        left: `${
                                            reactionRadialPickerOptionButtonPositionCenterRem +
                                            vector.x
                                        }rem`,
                                        top: `${
                                            reactionRadialPickerOptionButtonPositionCenterRem +
                                            vector.y
                                        }rem`,
                                        transition: "color 0.15s ease, background-color 0.15s ease",
                                    }}
                                >
                                    <ThumbsUpFill2Icon
                                        size={spacing[reactionRadialPickerOptionButtonIconSize]}
                                    />
                                </Box>
                            );
                        } else if (index === 4) {
                            return (
                                <Box
                                    // Remount this element when entering the pressed state so we don't animate the
                                    // background color with the CSS transition. If the user presses and moves
                                    // their mouse around, then we want to animate. We only want an immediate
                                    // response to the press action.
                                    key={`${index}-${isPressed}`}
                                    position="absolute"
                                    width={reactionRadialPickerOptionButtonSize}
                                    height={reactionRadialPickerOptionButtonSize}
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    backgroundColor={
                                        activeIndex === index
                                            ? isPressed || isMouseDownFromOverlayOpen
                                                ? "grey-10"
                                                : "grey-5"
                                            : undefined
                                    }
                                    color={activeIndex === index ? "grey-100" : "grey-70"}
                                    borderRadius="full"
                                    style={{
                                        left: `${
                                            reactionRadialPickerOptionButtonPositionCenterRem +
                                            vector.x
                                        }rem`,
                                        top: `${
                                            reactionRadialPickerOptionButtonPositionCenterRem +
                                            vector.y
                                        }rem`,
                                        transition: "color 0.15s ease, background-color 0.15s ease",
                                    }}
                                >
                                    <DotsThree
                                        size={spacing[reactionRadialPickerOptionButtonIconSize]}
                                    />
                                </Box>
                            );
                        } else {
                            // The "more" button is placed in the middle of our reactions at index 4 and
                            // the generic like button is placed at the beginning of our reactions at index
                            // 0. So to get the correct emotion index we need to "skip" index 0 and index
                            // 4. This code does that.
                            const emotionIndex = index > 4 ? index - 2 : index - 1;
                            const emotion = reactionRadialPickerIconEmotions[emotionIndex]!;

                            const reaction =
                                missingCurrentAccountReaction && emotionIndex === 0
                                    ? missingCurrentAccountReaction
                                    : {character, emotion};

                            const extraSelectionHighlightSize = "1.5";

                            return (
                                <Fragment key={index}>
                                    {areReactionsEqual(currentAccountReaction, reaction) && (
                                        <Box
                                            position="absolute"
                                            zIndex="10"
                                            borderRadius="full"
                                            backgroundColor="grey-5"
                                            style={{
                                                width: addRemLengths(
                                                    reactionRadialPickerOptionIconSize,
                                                    extraSelectionHighlightSize,
                                                ),
                                                height: addRemLengths(
                                                    reactionRadialPickerOptionIconSize,
                                                    extraSelectionHighlightSize,
                                                ),
                                                left: `${
                                                    reactionRadialPickerOptionIconPositionCenterRem -
                                                    parseRemLength(extraSelectionHighlightSize) /
                                                        2 +
                                                    vector.x
                                                }rem`,
                                                top: `${
                                                    reactionRadialPickerOptionIconPositionCenterRem -
                                                    parseRemLength(extraSelectionHighlightSize) /
                                                        2 +
                                                    vector.y
                                                }rem`,
                                            }}
                                        />
                                    )}
                                    <Box
                                        position="absolute"
                                        zIndex="20"
                                        style={{
                                            left: `${
                                                reactionRadialPickerOptionIconPositionCenterRem +
                                                vector.x
                                            }rem`,
                                            top: `${
                                                reactionRadialPickerOptionIconPositionCenterRem +
                                                vector.y
                                            }rem`,
                                            transition: "transform 0.15s ease",
                                            transformOrigin: "center",
                                            transform:
                                                activeIndex === index
                                                    ? (() => {
                                                          const activeVector = vector.withMagnitude(
                                                              reactionRadialPickerOptionIconActiveExtraOffsetRem,
                                                          );

                                                          return `translate(${activeVector.x}rem, ${activeVector.y}rem) scale(1.2)`;
                                                      })()
                                                    : undefined,
                                        }}
                                    >
                                        <ReactionIcon
                                            reaction={reaction}
                                            size={reactionRadialPickerOptionIconSize}
                                        />
                                    </Box>
                                </Fragment>
                            );
                        }
                    })}
                </Box>
            </Box>
        </Box>
    );
}
