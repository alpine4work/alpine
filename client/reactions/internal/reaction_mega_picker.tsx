import {useMemo, useState} from "react";
import {usePress} from "react-aria";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {Box} from "~/client/design/box.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {orderedReactionEmotions} from "~/client/reactions/internal/ordered_reaction_creatures_and_emotions.js";
import {ReactionCreatureSelector} from "~/client/reactions/internal/reaction_creature_selector.js";
import {ReactionIcon} from "~/client/reactions/internal/reaction_icon.js";
import {sortReactionCreaturesAroundOurCreature} from "~/client/reactions/internal/sort_reaction_creatures_around_our_creature.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {getLegacyFallbackReactionCreatureForId} from "~/shared/reactions/get_legacy_fallback_reaction_creature_for_id.js";
import {Reaction} from "~/shared/reactions/reaction.js";

const iconSize = "8";
const iconGalleryPaddingX = "2";
const iconGalleryPaddingY = "2";

const creatureSelectorWidth = "32";

const widthRem =
    parseRemLength(creatureSelectorWidth) +
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

    const ourCreature = useMemo(
        () =>
            currentAccountData.reactionCreature ??
            getLegacyFallbackReactionCreatureForId(currentAccount.id),
        [currentAccount.id, currentAccountData.reactionCreature],
    );

    // `useState()` instead of `useMemo()` since we want to calculate this on mount
    // then keep it the same after that.
    const [creatures] = useState(() => sortReactionCreaturesAroundOurCreature(ourCreature));

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
                    {creatures.map(creature => (
                        <Box
                            key={`${creature.type}-${creature.variant}`}
                            width="full"
                            display="flex"
                        >
                            {orderedReactionEmotions.map(emotion => (
                                <ReactionMegaPickerGalleryIcon
                                    key={emotion}
                                    reaction={{creature, emotion}}
                                    onSetReaction={onSetReaction}
                                    onCloseWithoutAnimation={onCloseWithoutAnimation}
                                />
                            ))}
                        </Box>
                    ))}
                </Box>
            </Box>
            <Box
                width={creatureSelectorWidth}
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
                    <ReactionCreatureSelector />
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
