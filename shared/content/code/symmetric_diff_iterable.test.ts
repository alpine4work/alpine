import {symmetricDiffIterable} from "~/shared/content/code/symmetric_diff_iterable.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {shuffleArray} from "~/shared/helpers/array/shuffle_array.js";

test("no change", () => {
    expect(symmetricDiffIterable([], [])).toEqual([]);

    expect(symmetricDiffIterable([1], [1])).toEqual([{type: null, value: 1}]);

    expect(symmetricDiffIterable([1, 2, 3], [1, 2, 3])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
    ]);
});

test("added single value", () => {
    expect(symmetricDiffIterable([], [1])).toEqual([{type: "Added", value: 1}]);

    expect(symmetricDiffIterable([1], [1, 2])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1], [2, 1])).toEqual([
        {type: "Added", value: 2},
        {type: null, value: 1},
    ]);

    expect(symmetricDiffIterable([1, 2, 3], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Added", value: 4},
    ]);

    expect(symmetricDiffIterable([1, 3, 4], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: null, value: 4},
    ]);
});

test("added multiple adjacent values", () => {
    expect(symmetricDiffIterable([], [1, 2, 3])).toEqual([
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
    ]);

    expect(symmetricDiffIterable([1], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
        {type: "Added", value: 4},
    ]);

    expect(symmetricDiffIterable([4], [1, 2, 3, 4])).toEqual([
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([4, 5, 6], [1, 2, 3, 4, 5, 6])).toEqual([
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
        {type: null, value: 5},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 5, 6], [1, 2, 3, 4, 5, 6])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
        {type: "Added", value: 4},
        {type: null, value: 5},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 2, 6], [1, 2, 3, 4, 5, 6])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Added", value: 3},
        {type: "Added", value: 4},
        {type: "Added", value: 5},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 2, 3], [1, 2, 3, 4, 5, 6])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Added", value: 4},
        {type: "Added", value: 5},
        {type: "Added", value: 6},
    ]);
});

test("added multiple non-adjacent values", () => {
    expect(symmetricDiffIterable([2], [1, 2, 3])).toEqual([
        {type: "Added", value: 1},
        {type: null, value: 2},
        {type: "Added", value: 3},
    ]);

    expect(symmetricDiffIterable([2, 4], [1, 2, 3, 4, 5])).toEqual([
        {type: "Added", value: 1},
        {type: null, value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
        {type: "Added", value: 5},
    ]);

    expect(symmetricDiffIterable([2, 4, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8])).toEqual([
        {type: "Added", value: 1},
        {type: null, value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
        {type: "Added", value: 5},
        {type: null, value: 6},
        {type: null, value: 7},
        {type: null, value: 8},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: "Added", value: 4},
        {type: null, value: 5},
        {type: "Added", value: 6},
        {type: null, value: 7},
        {type: null, value: 8},
    ]);

    expect(symmetricDiffIterable([1, 2, 4, 5, 8], [1, 2, 3, 4, 5, 6, 7, 8])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
        {type: null, value: 5},
        {type: "Added", value: 6},
        {type: "Added", value: 7},
        {type: null, value: 8},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7, 8])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: "Added", value: 4},
        {type: null, value: 5},
        {type: null, value: 6},
        {type: null, value: 7},
        {type: "Added", value: 8},
    ]);
});

test("deleted single value", () => {
    expect(symmetricDiffIterable([1], [])).toEqual([{type: "Deleted", value: 1}]);

    expect(symmetricDiffIterable([1, 2], [1])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
    ]);

    expect(symmetricDiffIterable([2, 1], [1])).toEqual([
        {type: "Deleted", value: 2},
        {type: null, value: 1},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [1, 2, 3])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [1, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: null, value: 3},
        {type: null, value: 4},
    ]);
});

test("deleted multiple adjacent values", () => {
    expect(symmetricDiffIterable([1, 2, 3], [])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [1])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [4])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [4, 5, 6])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: null, value: 4},
        {type: null, value: 5},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [1, 5, 6])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: null, value: 5},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [1, 2, 6])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [1, 2, 3])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
    ]);
});

test("deleted multiple non-adjacent values", () => {
    expect(symmetricDiffIterable([1, 2, 3], [2])).toEqual([
        {type: "Deleted", value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [2, 4])).toEqual([
        {type: "Deleted", value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: null, value: 4},
        {type: "Deleted", value: 5},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 7, 8])).toEqual([
        {type: "Deleted", value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: null, value: 4},
        {type: "Deleted", value: 5},
        {type: null, value: 6},
        {type: null, value: 7},
        {type: null, value: 8},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 5, 7, 8])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: null, value: 5},
        {type: "Deleted", value: 6},
        {type: null, value: 7},
        {type: null, value: 8},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 4, 5, 8])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: null, value: 4},
        {type: null, value: 5},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 7},
        {type: null, value: 8},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 5, 6, 7])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: null, value: 5},
        {type: null, value: 6},
        {type: null, value: 7},
        {type: "Deleted", value: 8},
    ]);
});

test("changed single value", () => {
    expect(symmetricDiffIterable([1], [2])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 3, 5], [2, 3, 5])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([1, 3, 5], [1, 4, 5])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 3},
        {type: "Added", value: 4},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([1, 3, 5], [1, 3, 6])).toEqual([
        {type: null, value: 1},
        {type: null, value: 3},
        {type: "Deleted", value: 5},
        {type: "Added", value: 6},
    ]);
});

test("changed single value (deleted multiple)", () => {
    expect(symmetricDiffIterable([1, 2, 3], [4])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 4},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [2, 7, 9])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 5},
        {type: "Added", value: 2},
        {type: null, value: 7},
        {type: null, value: 9},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [1, 4, 9])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 7},
        {type: "Added", value: 4},
        {type: null, value: 9},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [1, 3, 6])).toEqual([
        {type: null, value: 1},
        {type: null, value: 3},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 7},
        {type: "Deleted", value: 9},
        {type: "Added", value: 6},
    ]);
});

test("changed single value (added multiple)", () => {
    expect(symmetricDiffIterable([4], [1, 2, 3])).toEqual([
        {type: "Deleted", value: 4},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
    ]);

    expect(symmetricDiffIterable([2, 7, 9], [1, 3, 5, 7, 9])).toEqual([
        {type: "Deleted", value: 2},
        {type: "Added", value: 1},
        {type: "Added", value: 3},
        {type: "Added", value: 5},
        {type: null, value: 7},
        {type: null, value: 9},
    ]);

    expect(symmetricDiffIterable([1, 4, 9], [1, 3, 5, 7, 9])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 4},
        {type: "Added", value: 3},
        {type: "Added", value: 5},
        {type: "Added", value: 7},
        {type: null, value: 9},
    ]);

    expect(symmetricDiffIterable([1, 3, 6], [1, 3, 5, 7, 9])).toEqual([
        {type: null, value: 1},
        {type: null, value: 3},
        {type: "Deleted", value: 6},
        {type: "Added", value: 5},
        {type: "Added", value: 7},
        {type: "Added", value: 9},
    ]);
});

test("changed multiple non-adjacent values", () => {
    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [2, 3, 6, 7, 10])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 5},
        {type: "Added", value: 6},
        {type: null, value: 7},
        {type: "Deleted", value: 9},
        {type: "Added", value: 10},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [1, 4, 5, 8, 9])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 3},
        {type: "Added", value: 4},
        {type: null, value: 5},
        {type: "Deleted", value: 7},
        {type: "Added", value: 8},
        {type: null, value: 9},
    ]);
});

test("changed multiple adjacent values", () => {
    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [2, 4, 6, 7, 9])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 5},
        {type: "Added", value: 2},
        {type: "Added", value: 4},
        {type: "Added", value: 6},
        {type: null, value: 7},
        {type: null, value: 9},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [1, 4, 6, 8, 9])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 7},
        {type: "Added", value: 4},
        {type: "Added", value: 6},
        {type: "Added", value: 8},
        {type: null, value: 9},
    ]);

    expect(symmetricDiffIterable([1, 3, 5, 7, 9], [1, 3, 6, 8, 10])).toEqual([
        {type: null, value: 1},
        {type: null, value: 3},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 7},
        {type: "Deleted", value: 9},
        {type: "Added", value: 6},
        {type: "Added", value: 8},
        {type: "Added", value: 10},
    ]);
});

test("changed single value when there’s a duplicate adjacent value", () => {
    expect(symmetricDiffIterable([1, 1], [2, 1])).toEqual([
        {type: "Added", value: 2},
        {type: null, value: 1},
        {type: "Deleted", value: 1},
    ]);

    expect(symmetricDiffIterable([1, 1], [1, 2])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 1, 3, 4], [2, 1, 3, 4])).toEqual([
        {type: "Added", value: 2},
        {type: null, value: 1},
        {type: "Deleted", value: 1},
        {type: null, value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 1, 3, 4], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 2, 4], [1, 3, 2, 4])).toEqual([
        {type: null, value: 1},
        {type: "Added", value: 3},
        {type: null, value: 2},
        {type: "Deleted", value: 2},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 2, 4], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 3], [1, 2, 4, 3])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Added", value: 4},
        {type: null, value: 3},
        {type: "Deleted", value: 3},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 3], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 3},
        {type: "Added", value: 4},
    ]);
});

test("changed single value when there’s a duplicate non-adjacent value", () => {
    expect(symmetricDiffIterable([1, 0, 1], [2, 0, 1])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 0},
        {type: null, value: 1},
    ]);

    expect(symmetricDiffIterable([1, 0, 1], [1, 0, 2])).toEqual([
        {type: null, value: 1},
        {type: null, value: 0},
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 0, 1, 3, 4], [2, 0, 1, 3, 4])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 0},
        {type: null, value: 1},
        {type: null, value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 0, 1, 3, 4], [1, 0, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: null, value: 0},
        {type: "Deleted", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 0, 2, 4], [1, 3, 0, 2, 4])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 0},
        {type: null, value: 2},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 0, 2, 4], [1, 2, 0, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 0},
        {type: "Deleted", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 0, 3], [1, 2, 4, 0, 3])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 4},
        {type: null, value: 0},
        {type: null, value: 3},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 0, 3], [1, 2, 3, 0, 4])).toEqual([
        {type: null, value: 1},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: null, value: 0},
        {type: "Deleted", value: 3},
        {type: "Added", value: 4},
    ]);
});

test("moved single value", () => {
    expect(symmetricDiffIterable([1, 2], [2, 1])).toEqual([
        {type: "Deleted", value: 1},
        {type: null, value: 2},
        {type: "Added", value: 1},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [1, 3, 2, 4])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: null, value: 3},
        {type: "Added", value: 2},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 3, 2, 4], [1, 2, 3, 4])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 3},
        {type: null, value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [4, 2, 3, 1])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 4},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 1},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [1, 4, 3, 2])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4], [3, 2, 1, 4])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 3},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 1},
        {type: null, value: 4},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [1, 4, 3, 2, 5])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 2},
        {type: null, value: 5},
    ]);
});

test("moved balanced multiple values", () => {
    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [3, 4, 1, 2, 5])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 3},
        {type: "Added", value: 4},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [4, 5, 3, 1, 2])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: "Added", value: 5},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [4, 5, 3, 1, 2, 6])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: "Added", value: 5},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 6},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [1, 5, 6, 4, 2, 3])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 5},
        {type: "Added", value: 6},
        {type: null, value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [5, 6, 3, 4, 1, 2])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 5},
        {type: "Added", value: 6},
        {type: null, value: 3},
        {type: null, value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6], [5, 6, 4, 3, 1, 2])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 5},
        {type: "Added", value: 6},
        {type: null, value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Added", value: 3},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
    ]);
});

test("moved unbalanced multiple values", () => {
    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [4, 3, 1, 2, 5])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([4, 3, 1, 2, 5], [1, 2, 3, 4, 5])).toEqual([
        {type: "Deleted", value: 4},
        {type: "Added", value: 1},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [1, 5, 4, 2, 3])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 5},
        {type: null, value: 4},
        {type: "Deleted", value: 5},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
    ]);

    expect(symmetricDiffIterable([1, 5, 4, 2, 3], [1, 2, 3, 4, 5])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 5},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 4},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 5},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [3, 4, 2, 1, 5])).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 3},
        {type: "Added", value: 4},
        {type: null, value: 2},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 1},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([3, 4, 2, 1, 5], [1, 2, 3, 4, 5])).toEqual([
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Added", value: 1},
        {type: null, value: 2},
        {type: "Deleted", value: 1},
        {type: "Added", value: 3},
        {type: "Added", value: 4},
        {type: null, value: 5},
    ]);

    expect(symmetricDiffIterable([1, 2, 3, 4, 5], [1, 4, 5, 3, 2])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: "Added", value: 5},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Added", value: 2},
    ]);

    expect(symmetricDiffIterable([1, 4, 5, 3, 2], [1, 2, 3, 4, 5])).toEqual([
        {type: null, value: 1},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Added", value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 2},
        {type: "Added", value: 4},
        {type: "Added", value: 5},
    ]);
});

test("shuffled values without duplicates", () => {
    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8, 9], [2, 7, 5, 6, 1, 4, 3, 8, 9])).toEqual(
        [
            {type: "Deleted", value: 1},
            {type: null, value: 2},
            {type: "Deleted", value: 3},
            {type: "Deleted", value: 4},
            {type: "Added", value: 7},
            {type: null, value: 5},
            {type: null, value: 6},
            {type: "Deleted", value: 7},
            {type: "Added", value: 1},
            {type: "Added", value: 4},
            {type: "Added", value: 3},
            {type: null, value: 8},
            {type: null, value: 9},
        ],
    );

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 7, 5, 6, 8, 2, 9, 4, 3])).toEqual(
        [
            {type: null, value: 1},
            {type: "Deleted", value: 2},
            {type: "Deleted", value: 3},
            {type: "Deleted", value: 4},
            {type: "Added", value: 7},
            {type: null, value: 5},
            {type: null, value: 6},
            {type: "Deleted", value: 7},
            {type: null, value: 8},
            {type: "Added", value: 2},
            {type: null, value: 9},
            {type: "Added", value: 4},
            {type: "Added", value: 3},
        ],
    );

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8, 9], [9, 4, 6, 2, 3, 8, 1, 5, 7])).toEqual(
        [
            {type: "Deleted", value: 1},
            {type: "Deleted", value: 2},
            {type: "Deleted", value: 3},
            {type: "Added", value: 9},
            {type: null, value: 4},
            {type: "Deleted", value: 5},
            {type: null, value: 6},
            {type: "Deleted", value: 7},
            {type: "Added", value: 2},
            {type: "Added", value: 3},
            {type: null, value: 8},
            {type: "Deleted", value: 9},
            {type: "Added", value: 1},
            {type: "Added", value: 5},
            {type: "Added", value: 7},
        ],
    );

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8, 9], [7, 6, 3, 1, 5, 4, 8, 9, 2])).toEqual(
        [
            {type: "Deleted", value: 1},
            {type: "Deleted", value: 2},
            {type: "Added", value: 7},
            {type: "Added", value: 6},
            {type: null, value: 3},
            {type: "Deleted", value: 4},
            {type: "Added", value: 1},
            {type: null, value: 5},
            {type: "Deleted", value: 6},
            {type: "Deleted", value: 7},
            {type: "Added", value: 4},
            {type: null, value: 8},
            {type: null, value: 9},
            {type: "Added", value: 2},
        ],
    );

    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8, 9], [4, 5, 2, 3, 6, 8, 7, 1, 9])).toEqual(
        [
            {type: "Deleted", value: 1},
            {type: "Added", value: 4},
            {type: "Added", value: 5},
            {type: null, value: 2},
            {type: null, value: 3},
            {type: "Deleted", value: 4},
            {type: "Deleted", value: 5},
            {type: null, value: 6},
            {type: "Deleted", value: 7},
            {type: null, value: 8},
            {type: "Added", value: 7},
            {type: "Added", value: 1},
            {type: null, value: 9},
        ],
    );
});

test("shuffled values with duplicates", () => {
    expect(
        symmetricDiffIterable(
            [1, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8, 9],
            [6, 4, 7, 1, 3, 3, 5, 2, 3, 9, 6, 8],
        ),
    ).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Added", value: 6},
        {type: "Added", value: 4},
        {type: "Added", value: 7},
        {type: "Added", value: 1},
        {type: null, value: 3},
        {type: null, value: 3},
        {type: "Deleted", value: 4},
        {type: null, value: 5},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 7},
        {type: "Deleted", value: 8},
        {type: "Added", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 9},
        {type: "Added", value: 6},
        {type: "Added", value: 8},
    ]);

    expect(
        symmetricDiffIterable(
            [1, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8, 9],
            [3, 3, 7, 5, 1, 6, 4, 8, 2, 6, 3, 9],
        ),
    ).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Added", value: 7},
        {type: "Added", value: 5},
        {type: "Added", value: 1},
        {type: null, value: 6},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 7},
        {type: "Added", value: 4},
        {type: null, value: 8},
        {type: "Added", value: 2},
        {type: "Added", value: 6},
        {type: "Added", value: 3},
        {type: null, value: 9},
    ]);

    expect(
        symmetricDiffIterable(
            [1, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8, 9],
            [3, 9, 6, 3, 7, 3, 2, 8, 1, 5, 4, 6],
        ),
    ).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 3},
        {type: "Added", value: 9},
        {type: "Added", value: 6},
        {type: null, value: 3},
        {type: "Added", value: 7},
        {type: null, value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 7},
        {type: "Added", value: 2},
        {type: null, value: 8},
        {type: "Deleted", value: 9},
        {type: "Added", value: 1},
        {type: "Added", value: 5},
        {type: "Added", value: 4},
        {type: "Added", value: 6},
    ]);

    expect(
        symmetricDiffIterable(
            [1, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8, 9],
            [3, 3, 9, 6, 2, 1, 3, 7, 5, 6, 4, 8],
        ),
    ).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Added", value: 3},
        {type: null, value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 6},
        {type: "Added", value: 9},
        {type: "Added", value: 6},
        {type: "Added", value: 2},
        {type: "Added", value: 1},
        {type: "Added", value: 3},
        {type: null, value: 7},
        {type: "Added", value: 5},
        {type: "Added", value: 6},
        {type: "Added", value: 4},
        {type: null, value: 8},
        {type: "Deleted", value: 9},
    ]);

    expect(
        symmetricDiffIterable(
            [1, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8, 9],
            [8, 5, 2, 3, 4, 1, 6, 9, 7, 3, 6, 3],
        ),
    ).toEqual([
        {type: "Deleted", value: 1},
        {type: "Added", value: 8},
        {type: "Added", value: 5},
        {type: null, value: 2},
        {type: null, value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Added", value: 4},
        {type: "Added", value: 1},
        {type: "Added", value: 6},
        {type: "Added", value: 9},
        {type: "Added", value: 7},
        {type: "Added", value: 3},
        {type: null, value: 6},
        {type: "Deleted", value: 7},
        {type: "Deleted", value: 8},
        {type: "Deleted", value: 9},
        {type: "Added", value: 3},
    ]);
});

test("shuffled values that don’t converge in a small lookahead range", () => {
    expect(symmetricDiffIterable([1, 2, 3, 4, 5, 6, 7, 8, 9], [6, 7, 9, 8, 1, 2, 3, 4, 5])).toEqual(
        [
            {type: "Deleted", value: 1},
            {type: "Deleted", value: 2},
            {type: "Deleted", value: 3},
            {type: "Deleted", value: 4},
            {type: "Deleted", value: 5},
            {type: "Deleted", value: 6},
            {type: "Deleted", value: 7},
            {type: "Deleted", value: 8},
            {type: "Deleted", value: 9},
            {type: "Added", value: 6},
            {type: "Added", value: 7},
            {type: "Added", value: 9},
            {type: "Added", value: 8},
            {type: "Added", value: 1},
            {type: "Added", value: 2},
            {type: "Added", value: 3},
            {type: "Added", value: 4},
            {type: "Added", value: 5},
        ],
    );

    expect(
        symmetricDiffIterable(
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
            [10, 16, 14, 17, 9, 12, 13, 4, 15, 18, 1, 19, 2, 20, 5, 6, 8, 3, 11, 7],
        ),
    ).toEqual([
        {type: "Deleted", value: 1},
        {type: "Deleted", value: 2},
        {type: "Deleted", value: 3},
        {type: "Deleted", value: 4},
        {type: "Deleted", value: 5},
        {type: "Deleted", value: 6},
        {type: "Deleted", value: 7},
        {type: "Deleted", value: 8},
        {type: "Deleted", value: 9},
        {type: "Deleted", value: 10},
        {type: "Deleted", value: 11},
        {type: "Deleted", value: 12},
        {type: "Deleted", value: 13},
        {type: "Deleted", value: 14},
        {type: "Deleted", value: 15},
        {type: "Deleted", value: 16},
        {type: "Deleted", value: 17},
        {type: "Deleted", value: 18},
        {type: "Deleted", value: 19},
        {type: "Deleted", value: 20},
        {type: "Added", value: 10},
        {type: "Added", value: 16},
        {type: "Added", value: 14},
        {type: "Added", value: 17},
        {type: "Added", value: 9},
        {type: "Added", value: 12},
        {type: "Added", value: 13},
        {type: "Added", value: 4},
        {type: "Added", value: 15},
        {type: "Added", value: 18},
        {type: "Added", value: 1},
        {type: "Added", value: 19},
        {type: "Added", value: 2},
        {type: "Added", value: 20},
        {type: "Added", value: 5},
        {type: "Added", value: 6},
        {type: "Added", value: 8},
        {type: "Added", value: 3},
        {type: "Added", value: 11},
        {type: "Added", value: 7},
    ]);

    for (let i = 0; i < 10_000; i++) {
        const array = createArrayWithLength(50, i => i + 1);
        const shuffledArray = shuffleArray([...array]);
        symmetricDiffIterable(array, shuffledArray);
    }
});
