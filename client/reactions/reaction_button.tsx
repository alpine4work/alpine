import {ThumbsUp} from "phosphor-react";
import {ReactElement, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {ThumbsUpFill2Icon} from "~/client/icons/thumbs_up_fill2_icon.js";
import {ReactionIcon} from "~/client/reactions/icons/reaction_icon.js";
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

export const reactionButtonContextMenuActionKey = "reaction-button";

export function ReactionButton({
    reactions,
    onSetReaction,
    onDeleteReaction,
    onPressSeeReactions,
}: {
    reactions: ReactionSet;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: () => void;
    onPressSeeReactions: () => Promise<void>;
}) {
    return (
        <ReactionButtonBase
            reactions={reactions}
            onSetReaction={onSetReaction}
            onDeleteReaction={onDeleteReaction}
        >
            {({currentAccountReaction, isMouseDownFromOverlayOpen}) => (
                <ContextMenuActions
                    actions={[
                        [
                            {
                                key: reactionButtonContextMenuActionKey,
                                label: "See reactions",
                                pressErrorTitle: "Couldn’t open reactions",
                                onPress: onPressSeeReactions,
                            },
                        ],
                    ]}
                >
                    <Button
                        variant="quietest"
                        isPressed={isMouseDownFromOverlayOpen}
                        height={postContentViewFooterButtonHeight}
                        paddingX="1.5"
                        icon={({isPressed}) => (
                            <ReactionButtonIcon
                                currentAccountReaction={currentAccountReaction}
                                isPressed={isPressed}
                            />
                        )}
                    >
                        <span style={{fontVariantNumeric: "tabular-nums"}}>
                            <PrettyNumber number={reactions.get().size} />
                        </span>
                    </Button>
                </ContextMenuActions>
            )}
        </ReactionButtonBase>
    );
}

export function ReactionButtonIcon({
    currentAccountReaction,
    isPressed,
}: {
    currentAccountReaction: Reaction | "GenericLike" | undefined;
    isPressed: boolean;
}) {
    return currentAccountReaction === "GenericLike" ? (
        <Box
            color={isPressed ? {light: "theme-60-const", dark: "theme-40-const"} : "theme-50-const"}
        >
            <ThumbsUpFill2Icon
                size={spacing[postContentViewFooterButtonIconSize]}
                color="currentColor"
            />
        </Box>
    ) : currentAccountReaction !== undefined ? (
        <Box
            position="relative"
            width={postContentViewFooterButtonIconSize}
            height={postContentViewFooterButtonIconSize}
        >
            <Box position="absolute" top="-1.5" left="-1" right="-1" bottom="-1">
                <ReactionIcon reaction={currentAccountReaction} size="full" />
            </Box>
        </Box>
    ) : (
        <ThumbsUp size={spacing[postContentViewFooterButtonIconSize]} />
    );
}

export function ReactionButtonBase({
    reactions,
    onSetReaction,
    onDeleteReaction,
    withoutButtonElementRequirement,
    children,
}: {
    reactions: ReactionSet;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: () => void;
    withoutButtonElementRequirement?: boolean;
    children: (props: {
        currentAccountReaction: Reaction | "GenericLike" | undefined;
        isMouseDownFromOverlayOpen: boolean;
    }) => ReactElement;
}) {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const radialPickerRef = useRef<ReactionRadialPickerRef>(null);

    const [translate, setTranslate] = useState<{xRem: number; yRem: number} | null>(null);
    const [isMouseDownFromOverlayOpen, setIsMouseDownFromOverlayOpen] = useState(false);

    const [isMegaPickerOpen, setIsMegaPickerOpen] = useState(false);

    const currentAccountReaction = reactions.get().get(currentAccount.id);

    return (
        <OverlayTriggerButton
            aria-haspopup="true"
            placement="bottom-start"
            offset={!isMegaPickerOpen ? "0" : undefined}
            // Don't move the overlay if it's near the container bounds. We position the
            // overlay relative to the button using the cursor position.
            fallbackPlacements={!isMegaPickerOpen ? emptyArray : undefined}
            withoutButtonElementRequirement={withoutButtonElementRequirement}
            overlay={({isVisible, onCloseWithAnimation, onCloseWithoutAnimation}) => (
                <Box>
                    {isMegaPickerOpen ? (
                        <ReactionMegaPicker
                            currentAccountReaction={currentAccountReaction}
                            onSetReaction={onSetReaction}
                            onDeleteReaction={onDeleteReaction}
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
                                currentAccountReaction={currentAccountReaction}
                                onSetReaction={onSetReaction}
                                onDeleteReaction={onDeleteReaction}
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

                assert(event.currentTarget instanceof HTMLElement);
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
            {children({currentAccountReaction, isMouseDownFromOverlayOpen})}
        </OverlayTriggerButton>
    );
}
