import {useMemo, useState} from "react";
import {usePress} from "react-aria";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {sortReactionCharactersAroundOurCharacter} from "~/client/web/reactions/internal/sort_reaction_characters_around_our_character.js";
import {orderedReactionEmotions} from "~/client/web/reactions/ordered_reaction_characters_and_emotions.js";
import {ReactionCharacterCarouselSelector} from "~/client/web/reactions/reaction_character_carousel_selector.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {Reaction, areReactionsEqual} from "~/shared/reactions/reaction.js";

const iconSize = "8";
const iconGalleryPaddingX = "2";
const iconGalleryPaddingY = "2";

const characterSelectorWidth = "32";

const widthRem =
    parseRemLength(characterSelectorWidth) +
    parseRemLength(iconSize) * orderedReactionEmotions.length +
    parseRemLength(iconGalleryPaddingX) * 2;

export function ReactionMegaPicker({
    currentAccountReaction,
    onSetReaction,
    onDeleteReaction,
    onCloseWithoutAnimation,
}: {
    currentAccountReaction: Reaction | "GenericLike" | undefined;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: () => void;
    onCloseWithoutAnimation: () => void;
}) {
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const currentAccountData = useAccountModel(currentAccount);

    const ourCharacter = useMemo(
        () =>
            currentAccountData.reactionCharacter ??
            getLegacyFallbackReactionCharacterForId(currentAccount.id),
        [currentAccount.id, currentAccountData.reactionCharacter],
    );

    // `useState()` instead of `useMemo()` since we want to calculate this on mount
    // then keep it the same after that.
    const [characters] = useState(() => sortReactionCharactersAroundOurCharacter(ourCharacter));

    return (
        <Box
            pointerEvents="auto"
            height="32"
            backgroundColor="grey-0"
            boxShadow="elevation-20"
            borderRadius="1.5"
            display="flex"
            style={{width: `${widthRem}rem`}}
        >
            <Box
                ref={useScrollbar()}
                position="relative"
                flexGrow="1"
                height="full"
                overflowY="scroll"
            >
                <Box paddingX={iconGalleryPaddingX} paddingY={iconGalleryPaddingY}>
                    {characters.map(character => (
                        <Box
                            key={`${character.type}-${character.variant}`}
                            width="full"
                            display="flex"
                        >
                            {orderedReactionEmotions.map(emotion => (
                                <ReactionMegaPickerGalleryIcon
                                    key={emotion}
                                    reaction={{character, emotion}}
                                    currentAccountReaction={currentAccountReaction}
                                    onSetReaction={onSetReaction}
                                    onDeleteReaction={onDeleteReaction}
                                    onCloseWithoutAnimation={onCloseWithoutAnimation}
                                />
                            ))}
                        </Box>
                    ))}
                </Box>
            </Box>
            <Box
                width={characterSelectorWidth}
                height="full"
                // Use box shadow for border to not change the layout.
                style={{boxShadow: `-1px 0 0 0 ${colorSchemeVars["grey-5"]}`}}
                display="flex"
                flexDirection="column"
                justifyContent="center"
            >
                <Box
                    flexShrink="0"
                    paddingX="2"
                    paddingTop="1.5"
                    fontSize="50"
                    color="grey-70"
                    textAlign="center"
                    // Optically center text since often reactions are more left-side heavy.
                    marginLeft="-0.5"
                >
                    Your character
                </Box>
                <Box flexGrow="1" display="flex" flexDirection="column" justifyContent="center">
                    <ReactionCharacterCarouselSelector />
                </Box>
            </Box>
        </Box>
    );
}

function ReactionMegaPickerGalleryIcon({
    reaction,
    currentAccountReaction,
    onSetReaction,
    onDeleteReaction,
    onCloseWithoutAnimation,
}: {
    reaction: Reaction;
    currentAccountReaction: Reaction | "GenericLike" | undefined;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: () => void;
    onCloseWithoutAnimation: () => void;
}) {
    const isCurrentAccountReaction = useMemo(
        () => areReactionsEqual(currentAccountReaction, reaction),
        [currentAccountReaction, reaction],
    );

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isCurrentAccountReaction) {
                onDeleteReaction();
            } else {
                onSetReaction(reaction);
            }
            onCloseWithoutAnimation();
        },
    });

    return (
        <Box {...pressProps} position="relative" zIndex="0">
            {(isPressed || isCurrentAccountReaction) && (
                <Box
                    position="absolute"
                    zIndex="-10"
                    backgroundColor={isPressed ? "grey-10" : "grey-5"}
                    borderRadius="1"
                    style={{
                        // 1px away from the icon edge at the top/right so if we have a pressed icon next
                        // to a selected icon there's some gap between the two icons.
                        top: 1,
                        right: 1,
                        left: 0,
                        bottom: 0,
                    }}
                />
            )}
            <ReactionIcon reaction={reaction} size={iconSize} />
        </Box>
    );
}
