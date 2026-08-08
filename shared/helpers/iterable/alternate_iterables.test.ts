import {alternateIterables} from "~/shared/helpers/iterable/alternate_iterables.open_source.js";

test("alternates values from each iterable in order", () => {
    expect(Array.from(alternateIterables([1, 2], [3, 4], [5, 6]))).toEqual([1, 3, 5, 2, 4, 6]);
});

test("continues alternating after shorter iterables are exhausted", () => {
    expect(Array.from(alternateIterables(["a", "b", "c"], ["d"], ["e", "f"]))).toEqual([
        "a",
        "d",
        "e",
        "b",
        "f",
        "c",
    ]);
});

test("alternates two long iterables with the same length", () => {
    const firstIterable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const secondIterable = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

    expect(Array.from(alternateIterables(firstIterable, secondIterable))).toEqual([
        1, 11, 2, 12, 3, 13, 4, 14, 5, 15, 6, 16, 7, 17, 8, 18, 9, 19, 10, 20,
    ]);
});

test("alternates two long iterables until the shorter iterable is exhausted", () => {
    const firstIterable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const secondIterable = [11, 12, 13, 14, 15, 16, 17];

    expect(Array.from(alternateIterables(firstIterable, secondIterable))).toEqual([
        1, 11, 2, 12, 3, 13, 4, 14, 5, 15, 6, 16, 7, 17, 8, 9, 10,
    ]);
});
