import {orderedReactionCreatures} from "~/client/reactions/internal/ordered_reaction_creatures_and_emotions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ReactionCreature} from "~/shared/reactions/reaction.js";

export function sortReactionCreaturesAroundOurCreature(
    ourCreature: ReactionCreature,
): ReadonlyArray<ReactionCreature> {
    const creatures: Array<ReactionCreature> = [];

    const ourCreatureIndex = orderedReactionCreatures.findIndex(
        otherCreature =>
            otherCreature.type === ourCreature.type &&
            otherCreature.variant === ourCreature.variant,
    );
    assert(ourCreatureIndex !== -1);

    for (let index = ourCreatureIndex; index < orderedReactionCreatures.length; index++) {
        const otherCreature = orderedReactionCreatures[index]!;
        creatures.push(otherCreature);
    }

    let sameCreatureTypeInsertionIndex = 1;

    for (let index = 0; index < ourCreatureIndex; index++) {
        const otherCreature = orderedReactionCreatures[index]!;

        if (otherCreature.type === ourCreature.type) {
            creatures.splice(sameCreatureTypeInsertionIndex, 0, otherCreature);
            sameCreatureTypeInsertionIndex++;
        } else {
            creatures.push(otherCreature);
        }
    }

    return creatures;
}
