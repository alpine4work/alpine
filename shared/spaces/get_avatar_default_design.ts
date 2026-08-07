import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {
    Reaction,
    ReactionCharacter,
    ReactionCharacterMap,
    getValueByReactionCharacter,
} from "~/shared/reactions/reaction.js";

// NOTE(calebmer): I went through all of these color combinations manually and
// asked myself "does this look nice?" Removing color combinations that I thought
// didn't look nice.
//
// We exclude `yellow` because it's too light and `indigo` because it's too dark.
const backgroundColorsByReactionCharacter: ReactionCharacterMap<
    ReadonlyArray<Exclude<ThemeColor, "yellow" | "indigo">>
> = {
    Cat: {
        Grey: ["orange", "cyan", "pink"],
        Pink: ["green", "cyan"],
        Yellow: ["green", "cyan", "purple"],
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
    Frog: {
        Green: ["red", "orange", "green", "cyan", "purple", "pink"],
        Cyan: ["red", "orange", "green", "cyan", "purple", "pink"],
        Yellow: ["cyan"],
    },
    Pigeon: {
        Plain: ["green", "cyan", "blue", "purple", "pink"],
        Brown: ["green", "cyan", "blue", "purple", "pink"],
        Grey: ["green", "cyan", "blue", "pink"],
    },
    Tulip: {
        Yellow: ["green", "cyan", "blue", "purple"],
        Pink: ["green", "cyan", "blue"],
        Violet: ["orange", "green", "cyan", "blue", "pink"],
    },
};

export function getAvatarDefaultDesign(
    id: AccountId | SpaceId | BotId,
    overrideReactionCharacter: ReactionCharacter | null,
): {
    reaction: Reaction;
    backgroundColor: ThemeColor;
} {
    const reactionCharacter =
        overrideReactionCharacter ?? getLegacyFallbackReactionCharacterForId(id);
    const reaction: Reaction = {character: reactionCharacter, emotion: "Happy"};

    const backgroundColors = getValueByReactionCharacter(
        backgroundColorsByReactionCharacter,
        reaction.character,
    );

    const backgroundColorIndex = new StableRandom(
        `getDefaultAvatarDesign-${id}-${reaction.character.type}-${reaction.character.variant}`,
    ).randomInteger("", 0, 0, backgroundColors.length);

    return {
        reaction,
        backgroundColor: backgroundColors[backgroundColorIndex]!,
    };
}
