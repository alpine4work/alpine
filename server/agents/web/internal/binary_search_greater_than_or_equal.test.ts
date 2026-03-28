import {binarySearchGreaterThanOrEqual} from "~/server/agents/web/internal/binary_search_greater_than_or_equal.js";

test("finds an exact matching value", () => {
    expect(binarySearchGreaterThanOrEqual([2, 4, 6], 4)).toEqual({index: 1, value: 4});
});

test("finds the least value greater than the target", () => {
    expect(binarySearchGreaterThanOrEqual([2, 6, 8], 4)).toEqual({index: 1, value: 6});
});

test("finds the first duplicate equal to the target", () => {
    expect(binarySearchGreaterThanOrEqual([1, 4, 4, 4, 9], 4)).toEqual({index: 1, value: 4});
});

test("returns null when every value is less than the target", () => {
    expect(binarySearchGreaterThanOrEqual([2, 4, 6], 7)).toBeNull();
});

test("returns null for an empty array", () => {
    expect(binarySearchGreaterThanOrEqual([], 1)).toBeNull();
});
