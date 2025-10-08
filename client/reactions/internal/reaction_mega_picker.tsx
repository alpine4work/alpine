import {useMemo, useState} from "react";
import {usePress} from "react-aria";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {Box} from "~/client/design/box.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {ReactionIcon} from "~/client/reactions/icons/reaction_icon.js";
import {orderedReactionEmotions} from "~/client/reactions/internal/ordered_reaction_characters_and_emotions.js";
import {sortReactionCharactersAroundOurCharacter} from "~/client/reactions/internal/sort_reaction_characters_around_our_character.js";
import {ReactionCharacterSelector} from "~/client/reactions/reaction_character_selector.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {Reaction} from "~/shared/reactions/reaction.js";

const iconSize = "8";
const iconGalleryPaddingX = "2";
const iconGalleryPaddingY = "2";

const characterSelectorWidth = "32";

const widthRem =
    parseRemLength(characterSelectorWidth) +
    parseRemLength(iconSize) * orderedReactionEmotions.length +
    parseRemLength(iconGalleryPaddingX) * 2;

export function ReactionMegaPicker({
    onSetReaction,
    onCloseWithoutAnimation,
}: {
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
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
                                    onSetReaction={onSetReaction}
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
                    <ReactionCharacterSelector />
                </Box>
            </Box>
        </Box>
    );
}

function ReactionMegaPickerGalleryIcon({
    reaction,
    onSetReaction,
    onCloseWithoutAnimation,
}: {
    reaction: Reaction;
    onSetReaction: (reaction: Reaction | "GenericLike") => void;
    onCloseWithoutAnimation: () => void;
}) {
    const {isPressed, pressProps} = usePress({
        onPress: () => {
            onSetReaction(reaction);
            onCloseWithoutAnimation();
        },
    });

    return (
        <Box {...pressProps} backgroundColor={isPressed ? "grey-10" : undefined} borderRadius="1">
            <ReactionIcon reaction={reaction} size={iconSize} />
        </Box>
    );
}
