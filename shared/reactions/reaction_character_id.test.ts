import {reactionCharacterIds} from "~/shared/reactions/reaction_character_id.js";

const reactionCharacterIdsArray = Object.values(reactionCharacterIds).flatMap(ids =>
    Object.values(ids).flatMap(ids => Object.values(ids)),
);

// This allows us to use 0 as a special "null" value in the future if we need.
test("`reactionCharacterIds` doesn’t include zero", () => {
    expect(reactionCharacterIdsArray.includes(0)).toEqual(false);
});

test("`reactionCharacterIds` has unique IDs", () => {
    expect(reactionCharacterIdsArray.length).toEqual(new Set(reactionCharacterIdsArray).size);
});

test("`reactionCharacterIds` are positive integers", () => {
    for (const id of reactionCharacterIdsArray) {
        expect(id).toBeGreaterThan(0);
        expect(id).toEqual(Math.trunc(id));
        expect(id).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
});

test("`reactionCharacterIds` has no gaps", () => {
    let expectedId = 1;

    for (const id of reactionCharacterIdsArray.slice().sort((a, b) => a - b)) {
        expect(id).toEqual(expectedId);
        expectedId++;
    }
});
