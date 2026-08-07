import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";
import {Id} from "~/shared/id/id.open_source.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";

// IMPORTANT: This array should never change! Otherwise the character we use for
// accounts with a `reactionCharacter` of null will change unexpectedly! We set
// `reactionCharacter` for new accounts on account creation to make sure they have
// access to the full list of reaction characters.
const legacyFallbackReactionCharacters: Array<ReactionCharacter> = [
    {type: "Cat", variant: "Grey"},
    {type: "Cat", variant: "Pink"},
    {type: "Cat", variant: "Yellow"},
    {type: "Tree", variant: "Blue"},
    {type: "Tree", variant: "Green"},
    {type: "Tree", variant: "Pink"},
    {type: "Yeti", variant: "Blue"},
    {type: "Yeti", variant: "Brown"},
    {type: "Yeti", variant: "Olive"},
];

/**
 * Get the default reaction character for an account that hasn't configured an
 * account in settings and was created before 2025-10-06 when we started picking a
 * random character for new accounts from our full set of reaction characters.
 */
export function getLegacyFallbackReactionCharacterForId(id: Id): ReactionCharacter {
    const stableRandom = new StableRandom("LegacyFallbackReactionCharacter");

    const index = stableRandom.randomInteger(id, 0, 0, legacyFallbackReactionCharacters.length);

    return legacyFallbackReactionCharacters[index]!;
}
