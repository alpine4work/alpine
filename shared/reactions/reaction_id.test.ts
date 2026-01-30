import {reactionIds} from "~/shared/reactions/reaction_id.js";

const reactionIdsArray = Object.values(reactionIds).flatMap(ids =>
    Object.values(ids).flatMap(ids => Object.values(ids)),
);

test("`reactionIds` doesn\u2019t include zero", () => {
    expect(reactionIdsArray.includes(0)).toEqual(false);
});

test("`reactionIds` has unique IDs", () => {
    expect(reactionIdsArray.length).toEqual(new Set(reactionIdsArray).size);
});

test("`reactionIds` are positive integers", () => {
    for (const id of reactionIdsArray) {
        expect(id).toBeGreaterThan(0);
        expect(id).toEqual(Math.trunc(id));
        expect(id).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
});

test("`reactionIds` has no gaps", () => {
    let expectedId = 1;

    for (const id of reactionIdsArray.slice().sort((a, b) => a - b)) {
        expect(id).toEqual(expectedId);
        expectedId++;
    }
});
