import {ReactionEmotion} from "~/shared/reactions/reaction.js";
import {ReactionEmotionSchema} from "~/shared/reactions/reaction_emotion_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

const thirtyDaysDurationMs = 1000 * 60 * 60 * 24 * 30;

/**
 * Default picker emotions ordered by **replacement priority** — the first entry is
 * the first slot to be evicted when the user earns a new favorite, and the last
 * entry is the most sticky. Product chose this order based on which built-in
 * emotions we're most willing to sacrifice for personalization.
 *
 * Because `updateTopReactionEmotions` processes slots weakest-first (breaking ties
 * by index), earned emotions fill in starting from index 0. Users see their
 * favorites at the front of the picker and the surviving defaults tail out behind
 * them.
 *
 * `top5` and `top6` extend `top4` by prepending additional \"most expendable\"
 * defaults so that the three lists stay nested and consistent.
 */
export const defaultTop4ReactionEmotionsInOrder: ReadonlyArray<ReactionAffinityTopEmotion> = [
    {
        emotion: "Lolsob",
        isDefault: true,
    },
    {
        emotion: "Laugh",
        isDefault: true,
    },
    {
        emotion: "Yes",
        isDefault: true,
    },
    {
        emotion: "Celebrate",
        isDefault: true,
    },
] as const;

export const defaultTop5ReactionEmotionsInOrder: ReadonlyArray<ReactionAffinityTopEmotion> = [
    {
        emotion: "Shock",
        isDefault: true,
    },
    ...defaultTop4ReactionEmotionsInOrder,
] as const;

export const defaultTop6ReactionEmotionsInOrder: ReadonlyArray<ReactionAffinityTopEmotion> = [
    {
        emotion: "DeadInside",
        isDefault: true,
    },
    ...defaultTop5ReactionEmotionsInOrder,
] as const;

const ReactionEmotionAffinityPointsSchema = Schema.object({
    points: Schema.float,
    lastUpdatedTime: Schema.integer,
});
type ReactionEmotionAffinityPoints = SchemaType<typeof ReactionEmotionAffinityPointsSchema>;

const ReactionAffinityTopEmotionSchema = Schema.object({
    emotion: ReactionEmotionSchema,
    isDefault: Schema.boolean,
});
type ReactionAffinityTopEmotion = SchemaType<typeof ReactionAffinityTopEmotionSchema>;

export type ReactionEmotionAffinity = SchemaType<typeof ReactionEmotionAffinitySchema>;

export const ReactionEmotionAffinitySchema = Schema.object({
    affinityByEmotion: Schema.map(ReactionEmotionSchema, ReactionEmotionAffinityPointsSchema),
    // We maintain three picker previews (4, 5, and 6 slots) eagerly on every update so
    // the client can render whichever size fits the current viewport without
    // recomputing. Each list is ordered replacement-priority first: earned emotions
    // occupy the front, surviving defaults trail at the back.
    top4ReactionEmotions: Schema.array(ReactionAffinityTopEmotionSchema).minLength(4).maxLength(4),
    top5ReactionEmotions: Schema.array(ReactionAffinityTopEmotionSchema).minLength(5).maxLength(5),
    top6ReactionEmotions: Schema.array(ReactionAffinityTopEmotionSchema).minLength(6).maxLength(6),
});

/**
 * Record that the user just reacted with `emotion` and return the updated affinity
 * state: the emotion's point balance is bumped (with prior points decayed to now)
 * and each of the three picker previews is re-evaluated in case the new reaction
 * should promote `emotion` into a top slot.
 *
 * Not idempotent at the function level — calling it twice counts the reaction
 * twice. Callers relying on at-most-once semantics must dedupe upstream (the
 * server does this via DynamoDB `clientRequestToken`).
 */
export function applyReactionEmotionAffinityDecay(
    reactionAffinity: ReactionEmotionAffinity,
    emotion: ReactionEmotion,
): ReactionEmotionAffinity {
    const reactionAffinityByEmotion = incrementPointsForReactionEmotion(
        reactionAffinity.affinityByEmotion,
        emotion,
    );
    const top4Emotions = updateTopReactionEmotions(
        reactionAffinity.top4ReactionEmotions,
        reactionAffinityByEmotion,
    );
    const top5Emotions = updateTopReactionEmotions(
        reactionAffinity.top5ReactionEmotions,
        reactionAffinityByEmotion,
    );
    const top6Emotions = updateTopReactionEmotions(
        reactionAffinity.top6ReactionEmotions,
        reactionAffinityByEmotion,
    );
    return {
        affinityByEmotion: reactionAffinityByEmotion,
        top4ReactionEmotions: top4Emotions,
        top5ReactionEmotions: top5Emotions,
        top6ReactionEmotions: top6Emotions,
    };
}

/**
 * Add +1 point to `emotion` on top of its time-decayed previous value.
 *
 * We decay first and then add so that the stored `points` field is always an "as
 * of `lastUpdatedTime`" value. This keeps reactions spaced months apart composable
 * without accumulating stale credit from the distant past.
 */
function incrementPointsForReactionEmotion(
    oldAffinityByEmotion: ReadonlyMap<ReactionEmotion, ReactionEmotionAffinityPoints>,
    emotion: ReactionEmotion,
): ReadonlyMap<ReactionEmotion, ReactionEmotionAffinityPoints> {
    const currentTime = Date.now();
    const newAffinityByEmotion = new Map(oldAffinityByEmotion);
    const oldAffinity = oldAffinityByEmotion.get(emotion);
    const oldPoints = oldAffinity ? getCurrentReactionEmotionPoints(currentTime, oldAffinity) : 0;
    newAffinityByEmotion.set(emotion, {points: oldPoints + 1, lastUpdatedTime: currentTime});
    return newAffinityByEmotion;
}

/**
 * Greedy replacement pass that decides whether any picker slot should be swapped
 * out for an emotion the user has been using more.
 *
 * ## Strategy
 *
 * For each slot (weakest-threshold first), scan challengers (lowest-qualifying
 * first) and swap in the first one that exceeds the slot's threshold and isn't
 * already in the top list.
 *
 * Weakest-slot-first + lowest-qualifier-first is the key property: by burning the
 * minimum viable challenger on the most replaceable slot, we preserve stronger
 * challengers for stronger slots later in the same pass. Without this pairing, a
 * single high-affinity emotion could greedily fill multiple slots via re-entry
 * tricks, or weaker challengers could block stronger ones from reaching their best
 * fit.
 *
 * ## Thresholds
 *
 * - **Default slots** (seeded placeholders) have a floor of 1.8 points. A
 *   challenger must have strictly more than 1.8 to displace them, which prevents a
 *   single incidental reaction from reshaping the picker. Reacting twice within a
 *   two-day window clears the floor. Once a default is displaced it is not
 *   re-seeded — if the user wants it back, they have to react with it enough to
 *   beat an existing slot on its own merits, just like any other emotion.
 * - **Earned slots** have no floor — they can be displaced by any emotion with
 *   strictly more (decayed) points than they currently hold. An earned favorite
 *   that has decayed heavily therefore becomes easier to unseat, which is
 *   intentional.
 *
 * ## Stability
 *
 * The output preserves the input slot order, so earned emotions stay in the slots
 * they first claimed and the picker doesn't visually reshuffle on each reaction.
 * Slot identities drift only when a replacement actually happens.
 *
 * ## Example
 *
 * Starting from the default top6 (all slots default, threshold 1.8 each):
 *
 *     [DeadInside, Shock, Lolsob, Laugh, Yes, Celebrate]
 *
 * 1.  User reacts twice with Heart (points ≈ 2). Heart clears the 1.8 floor and
 *     takes the weakest slot by index tie-break (slot 0, DeadInside):
 *
 *         [Heart, Shock, Lolsob, Laugh, Yes, Celebrate]
 *
 * 2.  User reacts twice with Happy (points ≈ 2). Heart's slot now has threshold 2
 *     (earned), so it's no longer weakest — the weakest slot is Shock at 1.8.
 *     Happy displaces Shock:
 *
 *         [Heart, Happy, Lolsob, Laugh, Yes, Celebrate]
 *
 * 3.  A month passes with no reactions. Heart and Happy decay to ≈ 0.1 each. User
 *     reacts once with ThankYou (points = 1). ThankYou can't clear the 1.8 floor
 *     on any default slot, but Heart's earned slot now has threshold 0.1 (no floor
 *     on earned slots), and ThankYou's 1 > 0.1 is enough to displace it:
 *
 *         [ThankYou, Happy, Lolsob, Laugh, Yes, Celebrate]
 *
 *     Note that DeadInside doesn't return to slot 0 when Heart vacates — defaults
 *     have to earn their way back.
 */
function updateTopReactionEmotions(
    topEmotions: ReadonlyArray<ReactionAffinityTopEmotion>,
    affinityByEmotion: ReadonlyMap<ReactionEmotion, ReactionEmotionAffinityPoints>,
): ReadonlyArray<ReactionAffinityTopEmotion> {
    const currentTime = Date.now();

    // Annotate each slot with the threshold a challenger must strictly exceed to claim
    // it. `index` is kept so we can restore the original slot order at the end of the
    // function.
    const sortedTopEmotions = topEmotions.map((topEmotion, index) => {
        return {
            index,
            emotion: topEmotion.emotion,
            isDefault: topEmotion.isDefault,
            pointThreshold: Math.max(
                getCurrentReactionEmotionPoints(
                    currentTime,
                    affinityByEmotion.get(topEmotion.emotion) ?? {points: 0, lastUpdatedTime: 0},
                ),
                topEmotion.isDefault ? 1.8 : 0,
            ),
        };
    });
    // Weakest slot first. Index tie-break keeps the ordering deterministic — and,
    // combined with the `defaultTopN` constants' "least precious first" convention,
    // causes newly earned emotions to fill in from index 0.
    sortedTopEmotions.sort((a, b) => a.pointThreshold - b.pointThreshold || a.index - b.index);

    // Challengers are ranked by their _decayed_ points (their current relevance), not
    // the raw stored value, so a favorite that hasn't been used in months can't coast
    // on historical credit.
    const sortedAffinityByEmotion = Array.from(affinityByEmotion, ([emotion, affinity]) => {
        return {
            emotion,
            points: getCurrentReactionEmotionPoints(currentTime, affinity),
        };
    });
    // Ascending so the inner loop picks up the WEAKEST qualifying challenger per slot
    // — see the function doc for why this matters.
    sortedAffinityByEmotion.sort((a, b) => a.points - b.points);

    for (const topEmotion of sortedTopEmotions) {
        for (const emotionByAffinity of sortedAffinityByEmotion) {
            // `sortedTopEmotions` is mutated in place as we assign, so this check also
            // excludes emotions we've already placed into another slot earlier in this same
            // outer iteration. Without it, a single high-points emotion could fill multiple
            // slots.
            const isEmotionByAffinityInTopEmotions = sortedTopEmotions.some(
                otherTopEmotion => otherTopEmotion.emotion === emotionByAffinity.emotion,
            );

            if (
                emotionByAffinity.emotion !== topEmotion.emotion &&
                emotionByAffinity.points > topEmotion.pointThreshold &&
                !isEmotionByAffinityInTopEmotions
            ) {
                topEmotion.emotion = emotionByAffinity.emotion;
                topEmotion.isDefault = false;
                topEmotion.pointThreshold = emotionByAffinity.points;
                break;
            }
        }
    }

    // Restore original slot positions so the picker doesn't reshuffle when nothing of
    // note has changed.
    sortedTopEmotions.sort((a, b) => a.index - b.index);

    return sortedTopEmotions.map(({emotion, isDefault}) => ({emotion, isDefault}));
}

/**
 * An exponential decay function `f(t) = e^-3t` where `t` is measured in months.
 * This function will decay 1 point to 0.05 (which we round down to 0) in 1 month.
 */
function getCurrentReactionEmotionPoints(
    currentTime: number,
    {points, lastUpdatedTime}: ReactionEmotionAffinityPoints,
): number {
    const elapsedTime = currentTime - lastUpdatedTime;
    return points * Math.exp(-(3 * (elapsedTime / thirtyDaysDurationMs)));
}
