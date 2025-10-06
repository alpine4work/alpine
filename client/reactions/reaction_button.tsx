import {ThumbsUp} from "phosphor-react";
import {useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {ThumbsUpFill2Icon} from "~/client/icons/thumbs_up_fill2_icon.js";
import {ReactionIcon} from "~/client/reactions/internal/reaction_icon.js";
import {ReactionMegaPicker} from "~/client/reactions/internal/reaction_mega_picker.js";
import {
    ReactionRadialPicker,
    ReactionRadialPickerRef,
} from "~/client/reactions/internal/reaction_radial_picker.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {
    postContentViewFooterButtonHeight,
    postContentViewFooterButtonHeightRem,
    postContentViewFooterButtonIconSize,
} from "~/client/styles/forum_shared_styles.js";
import {reactionRadialPickerSizeRem} from "~/client/styles/reaction_shared_styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

export function ReactionButton({
    reactions,
    onSetReaction,
    onDeleteReaction,
}: {
    reactions: ReactionSet;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: () => void;
}) {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const radialPickerRef = useRef<ReactionRadialPickerRef>(null);

    const [translate, setTranslate] = useState<{xRem: number; yRem: number} | null>(null);
    const [isMouseDownFromOverlayOpen, setIsMouseDownFromOverlayOpen] = useState(false);

    const [isMegaPickerOpen, setIsMegaPickerOpen] = useState(false);

    const currentAccountReaction = reactions.get().get(currentAccount.id);

    return (
        <OverlayTriggerButton
            // If the current account has reacted then disable the button. Clicking the
            // button will remove the reaction instead of opening the radial picker.
            isDisabled={!!currentAccountReaction}
            aria-haspopup="true"
            placement="bottom-start"
            offset={!isMegaPickerOpen ? "0" : undefined}
            // Don't move the overlay if it's near the container bounds. We position the
            // overlay relative to the button using the cursor position.
            fallbackPlacements={!isMegaPickerOpen ? emptyArray : undefined}
            overlay={({isVisible, onCloseWithAnimation, onCloseWithoutAnimation}) => (
                <Box>
                    {isMegaPickerOpen ? (
                        <ReactionMegaPicker
                            onSetReaction={onSetReaction}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                        />
                    ) : (
                        <Box
                            style={{
                                transform: `translate(${
                                    (translate?.xRem ?? 0) - reactionRadialPickerSizeRem / 2
                                }rem, ${
                                    (translate?.yRem ?? 0) -
                                    reactionRadialPickerSizeRem / 2 -
                                    postContentViewFooterButtonHeightRem
                                }rem)`,
                            }}
                        >
                            <ReactionRadialPicker
                                ref={radialPickerRef}
                                isVisible={isVisible}
                                onSetReaction={onSetReaction}
                                onOpenMegaPicker={() => setIsMegaPickerOpen(true)}
                                onCloseWithAnimation={onCloseWithAnimation}
                                isMouseDownFromOverlayOpen={isMouseDownFromOverlayOpen}
                            />
                        </Box>
                    )}
                </Box>
            )}
            animateOverlayOut={
                !isMegaPickerOpen
                    ? () => {
                          const radialPicker = assertExists(radialPickerRef.current);
                          return radialPicker.animateOut();
                      }
                    : undefined
            }
            onActuallyVisibleChange={isActuallyVisible => {
                if (!isActuallyVisible) {
                    setIsMegaPickerOpen(false);
                }
            }}
            onPointerDown={event => {
                const spacingScale = getSpacingScaleWithoutListening();

                assert(event.currentTarget instanceof HTMLButtonElement);
                const buttonElement = event.currentTarget;
                const buttonRect = buttonElement.getBoundingClientRect();

                setTranslate({
                    xRem: (event.clientX - buttonRect.left) / remPxBySpacingScale[spacingScale],
                    yRem: (event.clientY - buttonRect.top) / remPxBySpacingScale[spacingScale],
                });

                if (event.pointerType === "mouse") {
                    setIsMouseDownFromOverlayOpen(true);

                    const cleanup = () => {
                        setIsMouseDownFromOverlayOpen(false);

                        document.removeEventListener("pointerup", cleanup);
                        document.removeEventListener("pointercancel", cleanup);
                        document.removeEventListener("dragstart", cleanup);
                    };

                    document.addEventListener("pointerup", cleanup);
                    document.addEventListener("pointercancel", cleanup);
                    document.addEventListener("dragstart", cleanup);
                }
            }}
        >
            <Button
                variant="quietest"
                isPressed={isMouseDownFromOverlayOpen}
                height={postContentViewFooterButtonHeight}
                paddingX="1.5"
                icon={({isPressed}) =>
                    currentAccountReaction === "GenericLike" ? (
                        <Box
                            color={
                                isPressed
                                    ? {light: "theme-60-const", dark: "theme-40-const"}
                                    : "theme-50-const"
                            }
                        >
                            <ThumbsUpFill2Icon
                                size={spacing[postContentViewFooterButtonIconSize]}
                            />
                        </Box>
                    ) : currentAccountReaction !== undefined ? (
                        <Box
                            width={postContentViewFooterButtonIconSize}
                            height={postContentViewFooterButtonIconSize}
                        >
                            <Box position="absolute" inset="-1">
                                <ReactionIcon reaction={currentAccountReaction} size="full" />
                            </Box>
                        </Box>
                    ) : (
                        <ThumbsUp size={spacing[postContentViewFooterButtonIconSize]} />
                    )
                }
                onPress={() => {
                    // If we have a reaction then the overlay will be disabled. Delete the reaction
                    // so next click the user can set a new reaction.
                    if (currentAccountReaction) {
                        onDeleteReaction();
                    }
                }}
            >
                <span style={{fontVariantNumeric: "tabular-nums"}}>
                    <PrettyNumber number={reactions.get().size} label="like" />
                </span>
            </Button>
        </OverlayTriggerButton>
    );
}
