import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

test("will say undefined is not a plain object", () => {
    expect(isPlainObject(undefined)).toEqual(false);
});

test("will say null is not a plain object", () => {
    expect(isPlainObject(null)).toEqual(false);
});

test("will say boolean is not a plain object", () => {
    expect(isPlainObject(true)).toEqual(false);
    expect(isPlainObject(false)).toEqual(false);
});

test("will say number is not a plain object", () => {
    expect(isPlainObject(0)).toEqual(false);
    expect(isPlainObject(42)).toEqual(false);
});

test("will say string is not a plain object", () => {
    expect(isPlainObject("")).toEqual(false);
    expect(isPlainObject("hello world")).toEqual(false);
});

test("will say symbol is not a plain object", () => {
    expect(isPlainObject(Symbol())).toEqual(false);
});

test("will say array is not a plain object", () => {
    expect(isPlainObject([])).toEqual(false);
    expect(isPlainObject([1, 2, 3])).toEqual(false);
});

test("will say map is not a plain object", () => {
    expect(isPlainObject(new Map())).toEqual(false);
});

test("will say function is not a plain object", () => {
    expect(isPlainObject(() => {})).toEqual(false);
});

test("will say object literal is a plain object", () => {
    expect(isPlainObject({})).toEqual(true);
    expect(isPlainObject({x: 1, y: 2})).toEqual(true);
});

test("will say object without prototype is a plain object", () => {
    expect(isPlainObject(Object.create(null))).toEqual(true);
});
