import {Lazy} from "~/shared/helpers/control/lazy.js";
import {Reaction, ReactionMap} from "~/shared/reactions/reaction.js";

/**
 * The integer ID for each reaction icon.
 */
export const reactionIds: ReactionMap<number> = {
    Cat: {
        Grey: {
            Celebrate: 1,
            DeadInside: 2,
            Hardship: 3,
            Heart: 4,
            Laugh: 5,
            Lolsob: 6,
            No: 7,
            Shock: 8,
            Yes: 9,
        },
        Pink: {
            Celebrate: 10,
            DeadInside: 11,
            Hardship: 12,
            Heart: 13,
            Laugh: 14,
            Lolsob: 15,
            No: 16,
            Shock: 17,
            Yes: 18,
        },
        Yellow: {
            Celebrate: 19,
            DeadInside: 20,
            Hardship: 21,
            Heart: 22,
            Laugh: 23,
            Lolsob: 24,
            No: 25,
            Shock: 26,
            Yes: 27,
        },
    },
    Tree: {
        Blue: {
            Celebrate: 46,
            DeadInside: 47,
            Hardship: 48,
            Heart: 49,
            Laugh: 50,
            Lolsob: 51,
            No: 52,
            Shock: 53,
            Yes: 54,
        },
        Green: {
            Celebrate: 37,
            DeadInside: 38,
            Hardship: 39,
            Heart: 40,
            Laugh: 41,
            Lolsob: 42,
            No: 43,
            Shock: 44,
            Yes: 45,
        },
        Pink: {
            Celebrate: 28,
            DeadInside: 29,
            Hardship: 30,
            Heart: 31,
            Laugh: 32,
            Lolsob: 33,
            No: 34,
            Shock: 35,
            Yes: 36,
        },
    },
    Yeti: {
        Blue: {
            Celebrate: 55,
            DeadInside: 56,
            Hardship: 57,
            Heart: 58,
            Laugh: 59,
            Lolsob: 60,
            No: 61,
            Shock: 62,
            Yes: 63,
        },
        Brown: {
            Celebrate: 64,
            DeadInside: 65,
            Hardship: 66,
            Heart: 67,
            Laugh: 68,
            Lolsob: 69,
            No: 70,
            Shock: 71,
            Yes: 72,
        },
        Olive: {
            Celebrate: 73,
            DeadInside: 74,
            Hardship: 75,
            Heart: 76,
            Laugh: 77,
            Lolsob: 78,
            No: 79,
            Shock: 80,
            Yes: 81,
        },
    },
};

/**
 * Get the `Reaction` object for a given ID.
 */
export const reactionById = new Lazy<ReadonlyMap<number, Reaction>>(() => {
    const reactionById = new Map<number, Reaction>();

    for (const [type, creatureMap] of Object.entries(reactionIds as any)) {
        for (const [variant, variantMap] of Object.entries(creatureMap as any)) {
            for (const [emotion, id] of Object.entries(variantMap as any)) {
                reactionById.set(id as any, {creature: {type, variant}, emotion} as any);
            }
        }
    }

    return reactionById;
});
