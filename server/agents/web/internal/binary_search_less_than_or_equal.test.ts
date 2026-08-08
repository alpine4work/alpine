import {binarySearchLessThanOrEqual} from "~/server/agents/web/internal/binary_search_less_than_or_equal.open_source.js";

test("finds an exact matching value", () => {
    expect(binarySearchLessThanOrEqual([2, 4, 6], 4)).toEqual({index: 1, value: 4});
});

test("finds the greatest value less than the target", () => {
    expect(binarySearchLessThanOrEqual([2, 4, 8], 7)).toEqual({index: 1, value: 4});
});

test("finds the last duplicate equal to the target", () => {
    expect(binarySearchLessThanOrEqual([1, 4, 4, 4, 9], 4)).toEqual({index: 3, value: 4});
});

test("returns null when every value is greater than the target", () => {
    expect(binarySearchLessThanOrEqual([2, 4, 6], 1)).toBeNull();
});

test("returns null for an empty array", () => {
    expect(binarySearchLessThanOrEqual([], 1)).toBeNull();
});
