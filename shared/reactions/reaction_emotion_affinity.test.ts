import {jest} from "@jest/globals";
import {ReactionEmotion} from "~/shared/reactions/reaction.js";
import {
    ReactionEmotionAffinity,
    applyReactionEmotionAffinityDecay,
    defaultTop4ReactionEmotionsInOrder,
    defaultTop5ReactionEmotionsInOrder,
    defaultTop6ReactionEmotionsInOrder,
} from "~/shared/reactions/reaction_emotion_affinity.js";

const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
const initialTime = new Date("2024-06-01T00:00:00Z").getTime();

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(initialTime);
});

afterEach(() => {
    jest.useRealTimers();
});

function emptyAffinity(): ReactionEmotionAffinity {
    return {
        affinityByEmotion: new Map(),
        top4ReactionEmotions: defaultTop4ReactionEmotionsInOrder,
        top5ReactionEmotions: defaultTop5ReactionEmotionsInOrder,
        top6ReactionEmotions: defaultTop6ReactionEmotionsInOrder,
    };
}

function react(
    affinity: ReactionEmotionAffinity,
    emotion: ReactionEmotion,
    times: number = 1,
): ReactionEmotionAffinity {
    let result = affinity;
    for (let i = 0; i < times; i++) {
        result = applyReactionEmotionAffinityDecay(result, emotion);
    }
    return result;
}

function emotionNames(
    topEmotions: ReadonlyArray<{emotion: ReactionEmotion; isDefault: boolean}>,
): Array<ReactionEmotion> {
    return topEmotions.map(({emotion}) => emotion);
}

describe("default top reaction emotions", () => {
    test("top4 has expected emotions in expected order", () => {
        expect(emotionNames(defaultTop4ReactionEmotionsInOrder)).toEqual([
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("top5 has expected emotions in expected order", () => {
        expect(emotionNames(defaultTop5ReactionEmotionsInOrder)).toEqual([
            "Shock",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("top6 has expected emotions in expected order", () => {
        expect(emotionNames(defaultTop6ReactionEmotionsInOrder)).toEqual([
            "DeadInside",
            "Shock",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("top5 extends top4 with one emotion prepended", () => {
        expect(defaultTop5ReactionEmotionsInOrder.slice(1)).toEqual(
            defaultTop4ReactionEmotionsInOrder,
        );
    });

    test("top6 extends top5 with one emotion prepended", () => {
        expect(defaultTop6ReactionEmotionsInOrder.slice(1)).toEqual(
            defaultTop5ReactionEmotionsInOrder,
        );
    });

    test("all top4 defaults are marked as default", () => {
        expect(defaultTop4ReactionEmotionsInOrder.every(e => e.isDefault)).toBe(true);
    });

    test("all top5 defaults are marked as default", () => {
        expect(defaultTop5ReactionEmotionsInOrder.every(e => e.isDefault)).toBe(true);
    });

    test("all top6 defaults are marked as default", () => {
        expect(defaultTop6ReactionEmotionsInOrder.every(e => e.isDefault)).toBe(true);
    });
});

describe("point increments without time decay", () => {
    test("first reaction stores 1 point for the emotion", () => {
        const result = applyReactionEmotionAffinityDecay(emptyAffinity(), "Heart");
        expect(result.affinityByEmotion.get("Heart")).toEqual({
            points: 1,
            lastUpdatedTime: initialTime,
        });
    });

    test("second reaction (no time passed) accumulates to 2 points", () => {
        const result = react(emptyAffinity(), "Heart", 2);
        expect(result.affinityByEmotion.get("Heart")?.points).toBe(2);
    });

    test("N reactions at the same instant produce exactly N points", () => {
        const result = react(emptyAffinity(), "Heart", 10);
        expect(result.affinityByEmotion.get("Heart")?.points).toBe(10);
    });

    test("different emotions accumulate independently", () => {
        let state = emptyAffinity();
        state = react(state, "Heart", 3);
        state = react(state, "Happy", 5);
        expect({
            heart: state.affinityByEmotion.get("Heart")?.points,
            happy: state.affinityByEmotion.get("Happy")?.points,
        }).toEqual({heart: 3, happy: 5});
    });

    test("lastUpdatedTime reflects the current time on each reaction", () => {
        let state = applyReactionEmotionAffinityDecay(emptyAffinity(), "Heart");
        jest.setSystemTime(initialTime + 12345);
        state = applyReactionEmotionAffinityDecay(state, "Heart");
        expect(state.affinityByEmotion.get("Heart")?.lastUpdatedTime).toBe(initialTime + 12345);
    });
});

describe("time-based point decay", () => {
    test("points decay by factor e^-3 after 30 days for updated emotion", () => {
        let state = applyReactionEmotionAffinityDecay(emptyAffinity(), "Heart");
        state = applyReactionEmotionAffinityDecay(state, "Happy");
        jest.setSystemTime(initialTime + thirtyDaysMs);
        state = applyReactionEmotionAffinityDecay(state, "Heart");
        // After 30 days, prior 1 point decays to e^-3. Plus new +1 = 1 + e^-3.
        expect(state.affinityByEmotion.get("Heart")?.points).toBeCloseTo(1 + Math.exp(-3), 8);

        // Happy points are not decayed. When evaluating top reaction emotions, we combine
        // the last known affinity points with the last updated time.
        expect(state.affinityByEmotion.get("Happy")?.points).toEqual(1);
    });

    test("points decay by factor e^-6 after 60 days", () => {
        let state = applyReactionEmotionAffinityDecay(emptyAffinity(), "Heart");
        jest.setSystemTime(initialTime + 2 * thirtyDaysMs);
        state = applyReactionEmotionAffinityDecay(state, "Heart");
        expect(state.affinityByEmotion.get("Heart")?.points).toBeCloseTo(1 + Math.exp(-6), 8);
    });

    test("points decay by factor e^-1.5 after 15 days", () => {
        let state = applyReactionEmotionAffinityDecay(emptyAffinity(), "Heart");
        jest.setSystemTime(initialTime + thirtyDaysMs / 2);
        state = applyReactionEmotionAffinityDecay(state, "Heart");
        expect(state.affinityByEmotion.get("Heart")?.points).toBeCloseTo(1 + Math.exp(-1.5), 8);
    });

    test("decay compounds across multiple intervals", () => {
        // Start at 5 points. Advance 30 days (decay by e^-3). Then 30 more days (another
        // e^-3). Net decay: e^-6. Plus 1 for the final reaction.
        let state = react(emptyAffinity(), "Heart", 5);
        jest.setSystemTime(initialTime + thirtyDaysMs);
        state = applyReactionEmotionAffinityDecay(state, "Heart");
        // Heart now has 5 \* e^-3 + 1 at time t0+30d.
        jest.setSystemTime(initialTime + 2 * thirtyDaysMs);
        state = applyReactionEmotionAffinityDecay(state, "Heart");
        // Prior points \* e^-3 + 1.
        const expected = (5 * Math.exp(-3) + 1) * Math.exp(-3) + 1;
        expect(state.affinityByEmotion.get("Heart")?.points).toBeCloseTo(expected, 8);
    });
});

describe("earning threshold (> 1.8 points)", () => {
    test("1 reaction (points = 1) is below threshold; emotion does not enter top6", () => {
        const state = applyReactionEmotionAffinityDecay(emptyAffinity(), "Heart");
        expect(state.top4ReactionEmotions.some(e => e.emotion === "Heart")).toBe(false);
        expect(state.top5ReactionEmotions.some(e => e.emotion === "Heart")).toBe(false);
        expect(state.top6ReactionEmotions.some(e => e.emotion === "Heart")).toBe(false);
    });

    test("2 reactions (points = 2) cross threshold; emotion enters top6", () => {
        const state = react(emptyAffinity(), "Heart", 2);
        expect(state.top4ReactionEmotions.map(({emotion}) => emotion)).toEqual([
            "Heart",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
        expect(state.top5ReactionEmotions.map(({emotion}) => emotion)).toEqual([
            "Heart",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
        expect(state.top6ReactionEmotions.map(({emotion}) => emotion)).toEqual([
            "Heart",
            "Shock",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("earned emotion is marked isDefault: false", () => {
        const state = react(emptyAffinity(), "Heart", 2);
        const heart = state.top6ReactionEmotions.find(e => e.emotion === "Heart");
        expect(heart?.isDefault).toBe(false);
    });

    test("non-earned emotion does not appear in top lists", () => {
        const state = applyReactionEmotionAffinityDecay(emptyAffinity(), "Happy");
        expect(state.top4ReactionEmotions.some(e => e.emotion === "Happy")).toBe(false);
    });

    test("emotion is not removed from default list when its affinity points decay below default value (1.8)", () => {
        // Reach exactly 1.8 via decay: start at 2 points, let decay bring it to ~1.8. 2 _
        // e^(-3t/30d) = 1.8 → t = -30d/3 _ ln(0.9) ≈ 1.054 days.
        let state = react(emptyAffinity(), "Heart", 2);
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        // Fast-forward enough time for Heart to decay below 1.8.
        const decayMs = -(thirtyDaysMs / 3) * Math.log(0.9);
        jest.setSystemTime(initialTime + decayMs + 1);
        // Trigger re-evaluation via an inert reaction.
        state = applyReactionEmotionAffinityDecay(state, "Happy");
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
    });
});

describe("top6 displacement order", () => {
    test("first earned emotion replaces DeadInside", () => {
        const state = react(emptyAffinity(), "Heart", 2);
        expect(emotionNames(state.top6ReactionEmotions)).toEqual([
            "Heart",
            "Shock",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("second earned emotion replaces Shock", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        expect(emotionNames(state.top6ReactionEmotions)).toEqual([
            "Heart",
            "Happy",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("third earned emotion replaces Lolsob", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        expect(emotionNames(state.top6ReactionEmotions)).toEqual([
            "Heart",
            "Happy",
            "ThankYou",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("fourth earned emotion replaces Laugh", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        state = react(state, "No", 2);
        expect(emotionNames(state.top6ReactionEmotions)).toEqual([
            "Heart",
            "Happy",
            "ThankYou",
            "No",
            "Yes",
            "Celebrate",
        ]);
    });

    test("fifth earned emotion replaces Yes", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        state = react(state, "No", 2);
        state = react(state, "Hardship", 2);
        expect(emotionNames(state.top6ReactionEmotions)).toEqual([
            "Heart",
            "Happy",
            "ThankYou",
            "No",
            "Hardship",
            "Celebrate",
        ]);
    });
});

describe("top5 displacement order", () => {
    test("first earned emotion replaces Shock", () => {
        const state = react(emptyAffinity(), "Heart", 2);
        expect(emotionNames(state.top5ReactionEmotions)).toEqual([
            "Heart",
            "Lolsob",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("fourth earned emotion replaces Yes, leaving only Celebrate as default", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        state = react(state, "No", 2);
        expect(emotionNames(state.top5ReactionEmotions)).toEqual([
            "Heart",
            "Happy",
            "ThankYou",
            "No",
            "Celebrate",
        ]);
    });
});

describe("top4 displacement order", () => {
    test("first earned emotion replaces Lolsob", () => {
        const state = react(emptyAffinity(), "Heart", 2);
        expect(emotionNames(state.top4ReactionEmotions)).toEqual([
            "Heart",
            "Laugh",
            "Yes",
            "Celebrate",
        ]);
    });

    test("third earned emotion replaces Yes, leaving only Celebrate as default", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        expect(emotionNames(state.top4ReactionEmotions)).toEqual([
            "Heart",
            "Happy",
            "ThankYou",
            "Celebrate",
        ]);
    });
});

describe("stability: earned slots are sticky", () => {
    test("first-earned emotion stays at index 0 after another emotion is earned", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        state = react(state, "Happy", 2);
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        expect(state.top6ReactionEmotions[1]!.emotion).toBe("Happy");
        state = react(state, "Heart", 5);
        state = react(state, "Happy", 2);
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        expect(state.top6ReactionEmotions[1]!.emotion).toBe("Happy");
    });

    test("earned emotions maintain earn-order even when later one has more points", () => {
        let state = react(emptyAffinity(), "Heart", 2); // Heart: 2
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");

        state = react(state, "Happy", 2); // Happy: 2
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        expect(state.top6ReactionEmotions[1]!.emotion).toBe("Happy");

        state = react(state, "Happy", 10); // Happy: 12, Heart still 2 Heart should still come before Happy in the top list.
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        expect(state.top6ReactionEmotions[1]!.emotion).toBe("Happy");
    });

    test("reacting with a default keeps it at its original slot position and does not flip its isDefault flag", () => {
        const state = react(emptyAffinity(), "Lolsob", 5);
        expect(state.top6ReactionEmotions).toEqual(defaultTop6ReactionEmotionsInOrder);
    });
});

describe("eviction of decayed earned slots", () => {
    test("earned emotion decayed below a new challenger\u2019s points is evicted", () => {
        let state = react(emptyAffinity(), "Heart", 2); // Heart: 2.
        jest.setSystemTime(initialTime + thirtyDaysMs);
        // Heart decayed to 2 \* e^-3 ≈ 0.0995. Earn Happy with 2 points.
        state = react(state, "Happy", 2);
        expect(state.top6ReactionEmotions.some(e => e.emotion === "Heart")).toBe(false);
    });

    test("after eviction, the evicting emotion takes the evicted slot", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        jest.setSystemTime(initialTime + thirtyDaysMs);
        state = react(state, "Happy", 2);
        // Heart was at index 0, evicted by Happy → Happy at index 0.
        expect(state.top6ReactionEmotions[0]).toEqual({emotion: "Happy", isDefault: false});
    });

    test("strongly earned emotion is not displaced by a weaker new challenger", () => {
        let state = react(emptyAffinity(), "Heart", 10); // Heart: 10.
        state = react(state, "Happy", 2); // Happy: 2 < Heart: 10. Heart should stay at index 0 (Happy takes next default
        // slot).
        expect(state.top6ReactionEmotions[0]!.emotion).toBe("Heart");
        expect(state.top6ReactionEmotions[1]!.emotion).toBe("Happy");
    });

    test("an already-earned emotion is not re-evaluated to displace itself", () => {
        // Heart is earned. Reacting with Heart again should NOT re-enter Heart at a
        // different slot — it stays where it was.
        let state = react(emptyAffinity(), "Heart", 2);
        const beforeIdx = state.top6ReactionEmotions.findIndex(e => e.emotion === "Heart");
        state = react(state, "Heart", 20);
        const afterIdx = state.top6ReactionEmotions.findIndex(e => e.emotion === "Heart");
        expect(afterIdx).toBe(beforeIdx);
    });
});

describe("full saturation (all slots earned)", () => {
    test("earning 5 non-default emotions leaves only Celebrate as default in top6", () => {
        let state = emptyAffinity();
        state = react(state, "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        state = react(state, "No", 2);
        state = react(state, "Hardship", 2);
        const defaults = state.top6ReactionEmotions.filter(e => e.isDefault);
        expect(defaults).toEqual([{emotion: "Celebrate", isDefault: true}]);
    });

    test("a previously-dropped default can re-enter as a non-default slot", () => {
        // Fill top6 with all 5 non-default emotions.
        let state = emptyAffinity();
        state = react(state, "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        state = react(state, "No", 2);
        state = react(state, "Hardship", 2);
        // Now earn DeadInside (which was dropped from top6 on the first earning).
        state = react(state, "DeadInside", 2);
        const deadInside = state.top6ReactionEmotions.find(e => e.emotion === "DeadInside");
        expect(deadInside).toEqual({emotion: "DeadInside", isDefault: false});
    });

    test("earning all 5 non-defaults plus DeadInside fully saturates top6", () => {
        let state = emptyAffinity();
        state = react(state, "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        state = react(state, "No", 2);
        state = react(state, "Hardship", 2);
        state = react(state, "DeadInside", 2);
        expect(state.top6ReactionEmotions.every(e => !e.isDefault)).toBe(true);
    });
});

describe("input immutability", () => {
    test("applyReactionEmotionAffinityDecay does not mutate the input\u2019s affinity map", () => {
        const input = emptyAffinity();
        const snapshotSize = input.affinityByEmotion.size;
        applyReactionEmotionAffinityDecay(input, "Heart");
        expect(input.affinityByEmotion.size).toBe(snapshotSize);
    });

    test("applyReactionEmotionAffinityDecay does not mutate the input\u2019s top6 array", () => {
        const input = emptyAffinity();
        const snapshot = [...input.top6ReactionEmotions];
        react(input, "Heart", 5);
        expect([...input.top6ReactionEmotions]).toEqual(snapshot);
    });

    test("applyReactionEmotionAffinityDecay does not mutate the input\u2019s top4 array", () => {
        const input = emptyAffinity();
        const snapshot = [...input.top4ReactionEmotions];
        react(input, "Heart", 5);
        expect([...input.top4ReactionEmotions]).toEqual(snapshot);
    });
});

describe("length invariants", () => {
    test("top4 always has exactly 4 entries", () => {
        let state = emptyAffinity();
        for (const emotion of ["Heart", "Happy", "ThankYou", "No", "Hardship"] as const) {
            state = react(state, emotion, 2);
            expect(state.top4ReactionEmotions).toHaveLength(4);
        }
    });

    test("top5 always has exactly 5 entries", () => {
        let state = emptyAffinity();
        for (const emotion of ["Heart", "Happy", "ThankYou", "No", "Hardship"] as const) {
            state = react(state, emotion, 2);
            expect(state.top5ReactionEmotions).toHaveLength(5);
        }
    });

    test("top6 always has exactly 6 entries", () => {
        let state = emptyAffinity();
        for (const emotion of ["Heart", "Happy", "ThankYou", "No", "Hardship"] as const) {
            state = react(state, emotion, 2);
            expect(state.top6ReactionEmotions).toHaveLength(6);
        }
    });
});

describe("cross-list consistency", () => {
    test("an earned emotion appears in all three top lists at index 0", () => {
        const state = react(emptyAffinity(), "Heart", 2);
        expect({
            top4: state.top4ReactionEmotions[0]!.emotion,
            top5: state.top5ReactionEmotions[0]!.emotion,
            top6: state.top6ReactionEmotions[0]!.emotion,
        }).toEqual({top4: "Heart", top5: "Heart", top6: "Heart"});
    });

    test("three earned emotions occupy the first three slots in all three top lists", () => {
        let state = react(emptyAffinity(), "Heart", 2);
        state = react(state, "Happy", 2);
        state = react(state, "ThankYou", 2);
        expect({
            top4: emotionNames(state.top4ReactionEmotions).slice(0, 3),
            top5: emotionNames(state.top5ReactionEmotions).slice(0, 3),
            top6: emotionNames(state.top6ReactionEmotions).slice(0, 3),
        }).toEqual({
            top4: ["Heart", "Happy", "ThankYou"],
            top5: ["Heart", "Happy", "ThankYou"],
            top6: ["Heart", "Happy", "ThankYou"],
        });
    });
});
