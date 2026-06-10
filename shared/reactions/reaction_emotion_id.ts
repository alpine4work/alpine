import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ReactionEmotion} from "~/shared/reactions/reaction.js";

/**
 * The integer ID for each reaction emotion. Once assigned, IDs are stable — they
 * appear on the wire and in persisted state — so existing entries must not be
 * renumbered. New emotions get the next unused ID.
 */
export const reactionEmotionIds: Record<ReactionEmotion, number> = {
    Celebrate: 1,
    DeadInside: 2,
    Hardship: 3,
    Happy: 4,
    Laugh: 5,
    Lolsob: 6,
    Shock: 7,
    Heart: 8,
    Yes: 9,
    No: 10,
    ThankYou: 11,
};

export const reactionEmotionById = new Lazy<ReadonlyMap<number, ReactionEmotion>>(() => {
    const reactionEmotionById = new Map<number, ReactionEmotion>();

    for (const [emotion, id] of Object.entries(reactionEmotionIds) as Array<
        [ReactionEmotion, number]
    >) {
        reactionEmotionById.set(id, emotion);
    }

    return reactionEmotionById;
});
