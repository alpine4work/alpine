import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ReactionCharacter, ReactionCharacterMap} from "~/shared/reactions/reaction.js";

export const reactionCharacterIds: ReactionCharacterMap<number> = {
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
 * Get the `ReactionCharacter` object for a given ID.
 */
export const reactionCharacterById = new Lazy<ReadonlyMap<number, ReactionCharacter>>(() => {
    const reactionCharacterById = new Map<number, ReactionCharacter>();

    for (const [type, characterMap] of Object.entries(reactionCharacterIds as any)) {
        for (const [variant, id] of Object.entries(characterMap as any)) {
            reactionCharacterById.set(id as any, {type, variant} as any);
        }
    }

    return reactionCharacterById;
});
