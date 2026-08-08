import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {
    StringifiableValueForDeepEqualCheck,
    stringifyForDeepEqualCheck,
} from "~/shared/helpers/control/stringify_for_deep_equal_check.open_source.js";

function testDeepEqual(
    value1: StringifiableValueForDeepEqualCheck,
    value2: StringifiableValueForDeepEqualCheck,
    equal: boolean,
) {
    expect(isDeepEqual(value1, value2)).toEqual(equal);
    if (equal) {
        expect(stringifyForDeepEqualCheck(value1)).toEqual(stringifyForDeepEqualCheck(value2));
    } else {
        expect(stringifyForDeepEqualCheck(value1)).not.toEqual(stringifyForDeepEqualCheck(value2));
    }
}

test("primitives are considered equal", () => {
    testDeepEqual(0, 0, true);
    testDeepEqual(0, 1, false);
    testDeepEqual(1, -1, false);
    testDeepEqual("foo", "foo", true);
    testDeepEqual("foo", "bar", false);
    testDeepEqual(true, true, true);
    testDeepEqual(true, false, false);
});

test("null and undefined are not equal", () => {
    testDeepEqual(null, null, true);
    testDeepEqual(undefined, undefined, true);
    testDeepEqual(null, undefined, false);
    testDeepEqual([null], [undefined], false);
    testDeepEqual({p: null}, {p: undefined}, false);
    testDeepEqual({p: undefined}, {p: undefined}, true);
});

test("missing object property is different from an undefined object property", () => {
    testDeepEqual({}, {p: undefined}, false);
});

test("undefined is stringified", () => {
    expect(stringifyForDeepEqualCheck(null)).toEqual("null");
    expect(stringifyForDeepEqualCheck(undefined)).toEqual("undefined");
    expect(stringifyForDeepEqualCheck([null])).toEqual("[null]");
    expect(stringifyForDeepEqualCheck([undefined])).toEqual("[undefined]");
    // eslint-disable-next-line cyberworlds/string-quotes
    expect(stringifyForDeepEqualCheck({p: null})).toEqual('{"p":null}');
    // eslint-disable-next-line cyberworlds/string-quotes
    expect(stringifyForDeepEqualCheck({p: undefined})).toEqual('{"p":undefined}');
    expect(stringifyForDeepEqualCheck({})).toEqual("{}");
});

test("positive zero and negative zero are equal", () => {
    testDeepEqual(+0, -0, true);
});

test("NaN is equal", () => {
    testDeepEqual(NaN, NaN, true);
    testDeepEqual(NaN, 42, false);
    testDeepEqual(NaN, null, false);
});

test("NaN is stringified", () => {
    expect(stringifyForDeepEqualCheck(NaN)).toEqual("NaN");
});

test("infinity is equal", () => {
    testDeepEqual(Infinity, Infinity, true);
    testDeepEqual(-Infinity, -Infinity, true);
    testDeepEqual(Infinity, -Infinity, false);
    testDeepEqual(Infinity, 42, false);
    testDeepEqual(Infinity, NaN, false);
    testDeepEqual(Infinity, null, false);
});

test("infinity is stringified", () => {
    expect(stringifyForDeepEqualCheck(Infinity)).toEqual("Infinity");
    expect(stringifyForDeepEqualCheck(-Infinity)).toEqual("-Infinity");
});

test("object key order does not matter for equality", () => {
    testDeepEqual({a: 1, b: 2}, {b: 2, a: 1}, true);
    testDeepEqual({a: 1, b: 2}, {b: 1, a: 2}, false);
});

test("array order does matter for equality", () => {
    testDeepEqual([1, 2], [1, 2], true);
    testDeepEqual([1, 2], [2, 1], false);
});

test("set order does not matter for equality", () => {
    testDeepEqual(new Set([1, 2]), new Set([1, 2]), true);
    testDeepEqual(new Set([1, 2]), new Set([2, 1]), true);
});

test("sets are not equal to arrays", () => {
    testDeepEqual([1, 2], new Set([1, 2]), false);
    testDeepEqual([1, 2], new Set([2, 1]), false);
});

test("map order does not matter for equality", () => {
    testDeepEqual(
        new Map([
            [1, 2],
            [3, 4],
        ]),
        new Map([
            [3, 4],
            [1, 2],
        ]),
        true,
    );
    testDeepEqual(
        new Map([
            [1, 2],
            [3, 4],
        ]),
        new Map([
            [1, 2],
            [3, 4],
        ]),
        true,
    );
    testDeepEqual(
        new Map([
            [1, 2],
            [3, 4],
        ]),
        new Map([
            [2, 1],
            [3, 4],
        ]),
        false,
    );
    testDeepEqual(
        new Map([
            [1, 2],
            [3, 4],
        ]),
        new Map([
            [3, 2],
            [1, 4],
        ]),
        false,
    );
});

test("maps are not equal to objects", () => {
    testDeepEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
        {a: 1, b: 2},
        false,
    );
    testDeepEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
        {b: 2, a: 1},
        false,
    );
});

test("dates are not equal to strings or numbers", () => {
    const date1 = new Date("2023-08-11T21:43:14.952Z");
    const date2 = new Date("2023-08-11T21:43:19.189Z");

    testDeepEqual(date1, date1.toISOString(), false);
    testDeepEqual(date1, date1.getTime(), false);
    testDeepEqual(date1, date2, false);
    testDeepEqual(date1, date1, true);
    testDeepEqual(date2, date2, true);
});
