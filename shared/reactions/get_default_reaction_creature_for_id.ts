import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {Id} from "~/shared/id/id.js";
import {
    ReactionCreature,
    allReactionCreatureTypes,
    allReactionCreatureVariantsByType,
} from "~/shared/reactions/reaction.js";

/**
 * Get the default reaction creature for an account if an account hasn't
 * configured one in settings.
 */
export function getDefaultReactionCreatureForId(id: Id): ReactionCreature {
    const stableRandom = new StableRandom("DefaultReactionCreature");

    const typeIndex = stableRandom.randomInteger(id, 0, 0, allReactionCreatureTypes.length);
    const type = allReactionCreatureTypes[typeIndex]!;

    const variants = allReactionCreatureVariantsByType[type];
    const variantIndex = stableRandom.randomInteger(id, 1, 0, variants.length);
    const variant = variants[variantIndex]!;

    return {type, variant} as ReactionCreature;
}
