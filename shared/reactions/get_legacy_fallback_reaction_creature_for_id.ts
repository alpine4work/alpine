import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {Id} from "~/shared/id/id.js";
import {ReactionCreature} from "~/shared/reactions/reaction.js";

// IMPORTANT: This array should never change! Otherwise the creature we use for
// accounts with a `reactionCreature` of null will change unexpectedly! We set
// `reactionCreature` for new accounts on account creation to make sure they
// have access to the full list of reaction creatures.
const legacyFallbackReactionCreatures: Array<ReactionCreature> = [
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
 * Get the default reaction creature for an account that hasn't configured an
 * account in settings and was created before 2025-10-06 when we started
 * picking a random creature for new accounts from our full set of reaction
 * creatures.
 */
export function getLegacyFallbackReactionCreatureForId(id: Id): ReactionCreature {
    const stableRandom = new StableRandom("LegacyFallbackReactionCreature");

    const creatureIndex = stableRandom.randomInteger(
        id,
        0,
        0,
        legacyFallbackReactionCreatures.length,
    );

    const creature = legacyFallbackReactionCreatures[creatureIndex]!;

    return creature;
}
