import {ThumbsUp} from "phosphor-react";
import {ReactElement, useMemo, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {ContextMenuActions} from "~/client/web/design/context_menu.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {ThumbsUpFill2Icon} from "~/client/web/icons/thumbs_up_fill2_icon.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {ReactionBarPicker} from "~/client/web/reactions/internal/reaction_bar_picker.js";
import {ReactionMegaPicker} from "~/client/web/reactions/internal/reaction_mega_picker.js";
import {ReactionPickerRef} from "~/client/web/reactions/internal/reaction_picker_base.js";
import {ReactionRadialPicker} from "~/client/web/reactions/internal/reaction_radial_picker.js";
import {ReactionTooltip} from "~/client/web/reactions/internal/reaction_tooltip.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    postContentViewFooterButtonHeight,
    postContentViewFooterButtonHeightRem,
    postContentViewFooterButtonIconSize,
} from "~/client/web/styles/forum_shared_styles.js";
import {reactionRadialPickerSizeRem} from "~/client/web/styles/reaction_shared_styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
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
    const genericLikeReactions = useMemo(
        () =>
            Array.from(
                filterMapIterable(reactions.get(), ([accountId, reaction]) =>
                    reaction === "GenericLike" ? {accountId} : undefined,
                ),
            ),
        [reactions],
    );

    return (
        <ReactionButtonBase
            reactions={reactions}
            onSetReaction={onSetReaction}
            onDeleteReaction={onDeleteReaction}
        >
            {({isPointerDownFromOverlayOpen}) => (
                <ReactionTooltip
                    introduction="Liked by"
                    reactions={genericLikeReactions}
                    withContextMenuInstructions={true}
                >
                    <ContextMenuActions
                        actions={[
                            [
                                {
                                    key: reactionButtonContextMenuActionKey,
                                    label: "See reactions",
                                    pressErrorTitle: "Couldn\u2019t open reactions",
                                    onPress: onPressSeeReactions,
                                },
                            ],
                        ]}
                    >
                        <Button
                            variant={genericLikeReactions.length > 0 ? "quieter" : "quietest"}
                            isPressed={isPointerDownFromOverlayOpen}
                            height={postContentViewFooterButtonHeight}
                            paddingX="1.5"
                            icon={({isPressed}) =>
                                genericLikeReactions.length > 0 ? (
                                    <Box
                                        color={
                                            isPressed
                                                ? {light: "theme-60-const", dark: "theme-40-const"}
                                                : "theme-50-const"
                                        }
                                    >
                                        <ThumbsUpFill2Icon
                                            size={spacing[postContentViewFooterButtonIconSize]}
                                            color="currentColor"
                                        />
                                    </Box>
                                ) : (
                                    <ThumbsUp size={spacing[postContentViewFooterButtonIconSize]} />
                                )
                            }
                        >
                            <span style={{fontVariantNumeric: "tabular-nums"}}>
                                <PrettyNumber number={reactions.get().size} />
                            </span>
                        </Button>
                    </ContextMenuActions>
                </ReactionTooltip>
            )}
        </ReactionButtonBase>
    );
}

export function CurrentAccountReactionButtonIcon({
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
    onReactionPickerClose,
    children,
}: {
    reactions: ReactionSet;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: () => void;
    withoutButtonElementRequirement?: boolean;
    onReactionPickerClose?: () => void;
    children: (props: {
        currentAccountReaction: Reaction | "GenericLike" | undefined;
        isPointerDownFromOverlayOpen: boolean;
    }) => ReactElement;
}) {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const platform = usePlatform();

    const reactionPickerRef = useRef<ReactionPickerRef>(null);

    const [translate, setTranslate] = useState<{xRem: number; yRem: number} | null>(null);
    const [isPointerDownFromOverlayOpen, setIsPointerDownFromOverlayOpen] = useState(false);

    const [isMegaPickerOpen, setIsMegaPickerOpen] = useState(false);

    const currentAccountReaction = reactions.get().get(currentAccount.id);

    return (
        <OverlayTriggerButton
            aria-haspopup="true"
            placement={platform === "mobile" ? "top-start" : "bottom-start"}
            offset={!isMegaPickerOpen ? "0" : undefined}
            // Don't allow clicking the overlay element before we've applied additional
            // translations to it.
            overlayPointerEvents="none"
            // Don't move the overlay if it's near the container bounds. We position the
            // overlay relative to the button using the cursor position.
            fallbackPlacements={!isMegaPickerOpen ? emptyArray : undefined}
            withoutButtonElementRequirement={withoutButtonElementRequirement}
            overlay={({isVisible, onCloseWithAnimation, onCloseWithoutAnimation}) => (
                <Box>
                    {platform === "mobile" ? (
                        <ReactionBarPicker
                            ref={reactionPickerRef}
                            isVisible={isVisible}
                            currentAccountReaction={currentAccountReaction}
                            onSetReaction={onSetReaction}
                            onDeleteReaction={onDeleteReaction}
                            onCloseWithAnimation={onCloseWithAnimation}
                            isPointerDownFromOverlayOpen={isPointerDownFromOverlayOpen}
                        />
                    ) : (
                        <>
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
                                        ref={reactionPickerRef}
                                        isVisible={isVisible}
                                        currentAccountReaction={currentAccountReaction}
                                        onSetReaction={onSetReaction}
                                        onDeleteReaction={onDeleteReaction}
                                        onOpenMegaPicker={() => setIsMegaPickerOpen(true)}
                                        onCloseWithAnimation={onCloseWithAnimation}
                                        isPointerDownFromOverlayOpen={isPointerDownFromOverlayOpen}
                                    />
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            )}
            animateOverlayOut={
                !isMegaPickerOpen
                    ? () => {
                          const reactionPicker = assertExists(reactionPickerRef.current);
                          return reactionPicker.animateOut();
                      }
                    : undefined
            }
            onActuallyVisibleChange={isActuallyVisible => {
                if (!isActuallyVisible) {
                    setIsMegaPickerOpen(false);
                    onReactionPickerClose?.();
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

                setIsPointerDownFromOverlayOpen(true);

                const cleanup = () => {
                    setIsPointerDownFromOverlayOpen(false);

                    document.removeEventListener("pointerup", cleanup);
                    document.removeEventListener("pointercancel", cleanup);
                };

                document.addEventListener("pointerup", cleanup);
                document.addEventListener("pointercancel", cleanup);
            }}
        >
            {children({
                currentAccountReaction,
                isPointerDownFromOverlayOpen,
            })}
        </OverlayTriggerButton>
    );
}
