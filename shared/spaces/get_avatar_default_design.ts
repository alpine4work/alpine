import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getLegacyFallbackReactionCreatureForId} from "~/shared/reactions/get_legacy_fallback_reaction_creature_for_id.js";
import {
    Reaction,
    ReactionCreature,
    ReactionCreatureMap,
    getValueByReactionCreature,
} from "~/shared/reactions/reaction.js";

// NOTE(calebmer): I went through all of these color combinations manually and
// asked myself "does this look nice?" Removing color combinations that I
// thought didn't look nice.
const backgroundColorsByReactionCreature: ReactionCreatureMap<ReadonlyArray<ThemeColor>> = {
    Cat: {
        Grey: ["orange", "green", "cyan", "pink"],
        Pink: ["green", "cyan", "blue"],
        Yellow: ["green", "cyan", "blue", "purple"],
    },
    Tree: {
        Blue: ["orange", "cyan", "pink"],
        Green: ["orange", "green", "cyan", "pink"],
        Pink: ["orange", "green", "cyan", "blue", "pink"],
    },
    Yeti: {
        Blue: ["red", "orange", "green", "cyan", "blue", "purple", "pink"],
        Brown: ["orange", "green", "cyan", "blue", "purple", "pink"],
        Olive: ["red", "orange", "green", "cyan", "blue", "purple", "pink"],
    },
};

export function getAvatarDefaultDesign(
    id: AccountId | SpaceId,
    overrideReactionCreature: ReactionCreature | null,
): {
    reaction: Reaction;
    backgroundColor: ThemeColor;
} {
    const reactionCreature = overrideReactionCreature ?? getLegacyFallbackReactionCreatureForId(id);
    const reaction: Reaction = {creature: reactionCreature, emotion: "Happy"};

    const backgroundColors = getValueByReactionCreature(
        backgroundColorsByReactionCreature,
        reaction.creature,
    );

    const backgroundColorIndex = new StableRandom(
        `getDefaultAvatarDesign-${id}-${reaction.creature.type}-${reaction.creature.variant}`,
    ).randomInteger("", 0, 0, backgroundColors.length);

    return {
        reaction,
        backgroundColor: backgroundColors[backgroundColorIndex]!,
    };
}
