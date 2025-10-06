import {Heart} from "phosphor-react";
import {useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
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
import {getDefaultReactionCreatureForId} from "~/shared/reactions/get_default_reaction_creature_for_id.js";

export function ReactionButton() {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const radialPickerRef = useRef<ReactionRadialPickerRef>(null);

    const [translate, setTranslate] = useState<{xRem: number; yRem: number} | null>(null);
    const [isMouseDownFromOverlayOpen, setIsMouseDownFromOverlayOpen] = useState(false);

    const currentAccountCreature = useMemo(
        () => getDefaultReactionCreatureForId(currentAccount.id),
        [currentAccount.id],
    );

    return (
        <OverlayTriggerButton
            aria-haspopup="true"
            placement="bottom-start"
            offset="0"
            // Don't move the overlay if it's near the container bounds. We position the
            // overlay relative to the button using the cursor position.
            fallbackPlacements={emptyArray}
            overlay={({isVisible, onCloseWithAnimation}) => (
                <Box>
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
                            onCloseWithAnimation={onCloseWithAnimation}
                            creature={currentAccountCreature}
                            isMouseDownFromOverlayOpen={isMouseDownFromOverlayOpen}
                        />
                    </Box>
                </Box>
            )}
            animateOverlayOut={() => {
                const radialPicker = assertExists(radialPickerRef.current);
                return radialPicker.animateOut();
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
                icon={<Heart size={spacing[postContentViewFooterButtonIconSize]} />}
            >
                <PrettyNumber number={0} label="like" />
            </Button>
        </OverlayTriggerButton>
    );
}
