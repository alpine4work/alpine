import {reactionCreatureIds} from "~/shared/reactions/reaction_creature_id.js";

const reactionCreatureIdsArray = Object.values(reactionCreatureIds).flatMap(ids =>
    Object.values(ids).flatMap(ids => Object.values(ids)),
);

// This allows us to use 0 as a special "null" value in the future if we need.
test("`reactionCreatureIds` doesn’t include zero", () => {
    expect(reactionCreatureIdsArray.includes(0)).toEqual(false);
});

test("`reactionCreatureIds` has unique IDs", () => {
    expect(reactionCreatureIdsArray.length).toEqual(new Set(reactionCreatureIdsArray).size);
});

test("`reactionCreatureIds` are positive integers", () => {
    for (const id of reactionCreatureIdsArray) {
        expect(id).toBeGreaterThan(0);
        expect(id).toEqual(Math.trunc(id));
        expect(id).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
});
