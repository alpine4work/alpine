import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ReactionCreature, ReactionCreatureType} from "~/shared/reactions/reaction.js";

export const reactionCreatureIds: {
    readonly [Type in ReactionCreatureType]: Readonly<
        Record<Extract<ReactionCreature, {readonly type: Type}>["variant"], number>
    >;
} = {
    Cat: {
        Grey: 1,
        Pink: 2,
        Yellow: 3,
    },
    Tree: {
        Blue: 6,
        Green: 5,
        Pink: 4,
    },
    Yeti: {
        Blue: 7,
        Brown: 8,
        Olive: 9,
    },
};

/**
 * Get the `ReactionCreature` object for a given ID.
 */
export const reactionCreatureById = new Lazy<ReadonlyMap<number, ReactionCreature>>(() => {
    const reactionCreatureById = new Map<number, ReactionCreature>();

    for (const [type, creatureMap] of Object.entries(reactionCreatureIds as any)) {
        for (const [variant, id] of Object.entries(creatureMap as any)) {
            reactionCreatureById.set(id as any, {type, variant} as any);
        }
    }

    return reactionCreatureById;
});
