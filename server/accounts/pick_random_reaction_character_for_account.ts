import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {
    ReactionCharacter,
    allReactionCharacterTypes,
    allReactionCharacterVariantsByType,
} from "~/shared/reactions/reaction.js";

export function pickRandomReactionCharacterForAccount(): ReactionCharacter {
    const typeIndex = randomInteger(0, allReactionCharacterTypes.length);
    const type = allReactionCharacterTypes[typeIndex]!;

    const variantIndex = randomInteger(0, allReactionCharacterVariantsByType[type].length);
    const variant = allReactionCharacterVariantsByType[type][variantIndex]!;

    return {type, variant} as ReactionCharacter;
}
