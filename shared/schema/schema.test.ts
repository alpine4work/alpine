import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

function validate<Value>(schema: Schema<Value>, value: unknown): boolean {
    try {
        const deserializedValue = schema.deserialize(value as any);
        schema.validate?.(deserializedValue);
        return true;
    } catch (error) {
        if (error instanceof SchemaDeserializationError) {
            return false;
        } else {
            throw error;
        }
    }
}

const maxSafeInteger = Number.MAX_SAFE_INTEGER;
const unsafeInteger = Number.MAX_SAFE_INTEGER * 2;
assert(Number.isInteger(unsafeInteger));

class Test1 {
    a = 1;
    c = 3;
}

(Test1.prototype as any).b = 2;

class Test2 {
    constructor(properties: {[key: string]: unknown}) {
        Object.assign(this, properties);
    }
}

test("float works for all numbers", () => {
    const schema = Schema.float;

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(true);
    expect(validate(schema, 1)).toEqual(true);
    expect(validate(schema, -1)).toEqual(true);
    expect(validate(schema, 42)).toEqual(true);
    expect(validate(schema, -42)).toEqual(true);
    expect(validate(schema, 3.1415)).toEqual(true);
    expect(validate(schema, -3.1415)).toEqual(true);
    expect(validate(schema, Infinity)).toEqual(true);
    expect(validate(schema, NaN)).toEqual(true);
    expect(validate(schema, maxSafeInteger)).toEqual(true);
    expect(validate(schema, unsafeInteger)).toEqual(true);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("integer works for safe integers", () => {
    const schema = Schema.integer;

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(true);
    expect(validate(schema, 1)).toEqual(true);
    expect(validate(schema, -1)).toEqual(true);
    expect(validate(schema, 42)).toEqual(true);
    expect(validate(schema, -42)).toEqual(true);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(true);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("nullable includes null", () => {
    const schema = Schema.integer.nullable();

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(true);
    expect(validate(schema, 0)).toEqual(true);
    expect(validate(schema, 1)).toEqual(true);
    expect(validate(schema, -1)).toEqual(true);
    expect(validate(schema, 42)).toEqual(true);
    expect(validate(schema, -42)).toEqual(true);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(true);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("optional includes undefined", () => {
    const schema = Schema.object({p: Schema.integer.optional()});

    expect(validate(schema, {p: undefined})).toEqual(true);
    expect(validate(schema, {p: null})).toEqual(false);
    expect(validate(schema, {p: 0})).toEqual(true);
    expect(validate(schema, {p: 1})).toEqual(true);
    expect(validate(schema, {p: -1})).toEqual(true);
    expect(validate(schema, {p: 42})).toEqual(true);
    expect(validate(schema, {p: -42})).toEqual(true);
    expect(validate(schema, {p: 3.1415})).toEqual(false);
    expect(validate(schema, {p: -3.1415})).toEqual(false);
    expect(validate(schema, {p: Infinity})).toEqual(false);
    expect(validate(schema, {p: NaN})).toEqual(false);
    expect(validate(schema, {p: maxSafeInteger})).toEqual(true);
    expect(validate(schema, {p: unsafeInteger})).toEqual(false);
    expect(validate(schema, {p: true})).toEqual(false);
    expect(validate(schema, {p: false})).toEqual(false);
    expect(validate(schema, {p: ""})).toEqual(false);
    expect(validate(schema, {p: "foo"})).toEqual(false);
    expect(validate(schema, {p: "fooBar"})).toEqual(false);
    expect(validate(schema, {p: "fooBar2"})).toEqual(false);
    expect(validate(schema, {p: "8px"})).toEqual(false);
    expect(validate(schema, {p: "Hello, world!"})).toEqual(false);
    expect(validate(schema, {p: []})).toEqual(false);
    expect(validate(schema, {p: [1, 2, 3]})).toEqual(false);
    expect(validate(schema, {p: [1, "foo", 3]})).toEqual(false);
    expect(validate(schema, {p: {}})).toEqual(false);
    expect(validate(schema, {p: {a: 1, c: 3}})).toEqual(false);
    expect(validate(schema, {p: {a: 1, b: 2, c: 3}})).toEqual(false);
    expect(validate(schema, {p: {a: 1, b: "foo", c: 3}})).toEqual(false);
    expect(validate(schema, {p: new Test1()})).toEqual(false);
});

test("boolean works for booleans", () => {
    const schema = Schema.boolean;

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(true);
    expect(validate(schema, false)).toEqual(true);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("string works for strings", () => {
    const schema = Schema.string;

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(true);
    expect(validate(schema, "foo")).toEqual(true);
    expect(validate(schema, "fooBar")).toEqual(true);
    expect(validate(schema, "fooBar2")).toEqual(true);
    expect(validate(schema, "8px")).toEqual(true);
    expect(validate(schema, "Hello, world!")).toEqual(true);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("array validates arrays with items of the correct type", () => {
    const schema = Schema.array(Schema.float);

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(true);
    expect(validate(schema, [1, 2, 3])).toEqual(true);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("object validates objects with keys of the correct type", () => {
    const schema = Schema.object({
        a: Schema.float,
        b: Schema.float,
        c: Schema.float,
    });

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(true);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
});

test("object with optional keys validates objects with keys of the correct type", () => {
    const schema = Schema.object({
        a: Schema.float,
        b: Schema.float.optional(),
        c: Schema.float,
    });

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(true);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(true);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(true);
});

test("object with default keys validates objects with keys of the correct type", () => {
    const schema = Schema.object({
        a: Schema.float,
        b: Schema.float.default(42),
        c: Schema.float,
    });

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(true);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(true);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(true);
});

test("object does not delete unknown keys in-place", () => {
    const schema = Schema.object({
        a: Schema.float,
        c: Schema.float,
    });

    const object = {a: 1, b: 2, c: 3};

    expect(object).toEqual({a: 1, b: 2, c: 3});
    expect(schema.deserialize(object)).toEqual({a: 1, c: 3});
    expect(schema.deserialize(object)).not.toBe(object);
    expect(object).toEqual({a: 1, b: 2, c: 3});
});

test("object produces new object for non-plain object", () => {
    const schema = Schema.object({
        a: Schema.float,
        b: Schema.float.optional(),
    });

    const object = new Test1();

    expect(object).toEqual({a: 1, c: 3});
    expect(schema.deserialize(object as any)).not.toBe(object);
    expect(schema.deserialize(object as any)).toEqual({a: 1});
    expect(object).toEqual({a: 1, c: 3});
});

test("object with default property adds a new property to object", () => {
    const schema = Schema.object({
        a: Schema.float,
        b: Schema.float.default(2),
    });

    expect(schema.deserialize({a: 1})).toEqual({a: 1, b: 2});
});

test("object with original property key can rename a property key", () => {
    const schema = Schema.object({
        a: Schema.float,
        b: Schema.float.originalPropertyKey("c"),
    });

    expect(schema.deserialize({a: 1, c: 3})).toEqual({a: 1, b: 3});
    expect(schema.deserialize({a: 1, b: 2, c: 3})).toEqual({a: 1, b: 3});
});

test("value only matches exactly identical values", () => {
    {
        const schema = Schema.value(3.1415);

        expect(validate(schema, undefined)).toEqual(false);
        expect(validate(schema, null)).toEqual(false);
        expect(validate(schema, 0)).toEqual(false);
        expect(validate(schema, 1)).toEqual(false);
        expect(validate(schema, -1)).toEqual(false);
        expect(validate(schema, 42)).toEqual(false);
        expect(validate(schema, -42)).toEqual(false);
        expect(validate(schema, 3.1415)).toEqual(true);
        expect(validate(schema, -3.1415)).toEqual(false);
        expect(validate(schema, Infinity)).toEqual(false);
        expect(validate(schema, NaN)).toEqual(false);
        expect(validate(schema, maxSafeInteger)).toEqual(false);
        expect(validate(schema, unsafeInteger)).toEqual(false);
        expect(validate(schema, true)).toEqual(false);
        expect(validate(schema, false)).toEqual(false);
        expect(validate(schema, "")).toEqual(false);
        expect(validate(schema, "foo")).toEqual(false);
        expect(validate(schema, "fooBar")).toEqual(false);
        expect(validate(schema, "fooBar2")).toEqual(false);
        expect(validate(schema, "8px")).toEqual(false);
        expect(validate(schema, "Hello, world!")).toEqual(false);
        expect(validate(schema, [])).toEqual(false);
        expect(validate(schema, [1, 2, 3])).toEqual(false);
        expect(validate(schema, [1, "foo", 3])).toEqual(false);
        expect(validate(schema, {})).toEqual(false);
        expect(validate(schema, {a: 1, c: 3})).toEqual(false);
        expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
        expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
        expect(validate(schema, new Test1())).toEqual(false);
    }
    {
        const schema = Schema.value("fooBar2");

        expect(validate(schema, undefined)).toEqual(false);
        expect(validate(schema, null)).toEqual(false);
        expect(validate(schema, 0)).toEqual(false);
        expect(validate(schema, 1)).toEqual(false);
        expect(validate(schema, -1)).toEqual(false);
        expect(validate(schema, 42)).toEqual(false);
        expect(validate(schema, -42)).toEqual(false);
        expect(validate(schema, 3.1415)).toEqual(false);
        expect(validate(schema, -3.1415)).toEqual(false);
        expect(validate(schema, Infinity)).toEqual(false);
        expect(validate(schema, NaN)).toEqual(false);
        expect(validate(schema, maxSafeInteger)).toEqual(false);
        expect(validate(schema, unsafeInteger)).toEqual(false);
        expect(validate(schema, true)).toEqual(false);
        expect(validate(schema, false)).toEqual(false);
        expect(validate(schema, "")).toEqual(false);
        expect(validate(schema, "foo")).toEqual(false);
        expect(validate(schema, "fooBar")).toEqual(false);
        expect(validate(schema, "fooBar2")).toEqual(true);
        expect(validate(schema, "8px")).toEqual(false);
        expect(validate(schema, "Hello, world!")).toEqual(false);
        expect(validate(schema, [])).toEqual(false);
        expect(validate(schema, [1, 2, 3])).toEqual(false);
        expect(validate(schema, [1, "foo", 3])).toEqual(false);
        expect(validate(schema, {})).toEqual(false);
        expect(validate(schema, {a: 1, c: 3})).toEqual(false);
        expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
        expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
        expect(validate(schema, new Test1())).toEqual(false);
    }
    {
        const schema = Schema.value(NaN);

        expect(validate(schema, undefined)).toEqual(false);
        expect(validate(schema, null)).toEqual(false);
        expect(validate(schema, 0)).toEqual(false);
        expect(validate(schema, 1)).toEqual(false);
        expect(validate(schema, -1)).toEqual(false);
        expect(validate(schema, 42)).toEqual(false);
        expect(validate(schema, -42)).toEqual(false);
        expect(validate(schema, 3.1415)).toEqual(false);
        expect(validate(schema, -3.1415)).toEqual(false);
        expect(validate(schema, Infinity)).toEqual(false);
        expect(validate(schema, NaN)).toEqual(true);
        expect(validate(schema, maxSafeInteger)).toEqual(false);
        expect(validate(schema, unsafeInteger)).toEqual(false);
        expect(validate(schema, true)).toEqual(false);
        expect(validate(schema, false)).toEqual(false);
        expect(validate(schema, "")).toEqual(false);
        expect(validate(schema, "foo")).toEqual(false);
        expect(validate(schema, "fooBar")).toEqual(false);
        expect(validate(schema, "fooBar2")).toEqual(false);
        expect(validate(schema, "8px")).toEqual(false);
        expect(validate(schema, "Hello, world!")).toEqual(false);
        expect(validate(schema, [])).toEqual(false);
        expect(validate(schema, [1, 2, 3])).toEqual(false);
        expect(validate(schema, [1, "foo", 3])).toEqual(false);
        expect(validate(schema, {})).toEqual(false);
        expect(validate(schema, {a: 1, c: 3})).toEqual(false);
        expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
        expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
        expect(validate(schema, new Test1())).toEqual(false);
    }
});

test("empty union validates nothing", () => {
    const schema = Schema.union({});

    expect(validate(schema, undefined)).toEqual(false);
    expect(validate(schema, null)).toEqual(false);
    expect(validate(schema, 0)).toEqual(false);
    expect(validate(schema, 1)).toEqual(false);
    expect(validate(schema, -1)).toEqual(false);
    expect(validate(schema, 42)).toEqual(false);
    expect(validate(schema, -42)).toEqual(false);
    expect(validate(schema, 3.1415)).toEqual(false);
    expect(validate(schema, -3.1415)).toEqual(false);
    expect(validate(schema, Infinity)).toEqual(false);
    expect(validate(schema, NaN)).toEqual(false);
    expect(validate(schema, maxSafeInteger)).toEqual(false);
    expect(validate(schema, unsafeInteger)).toEqual(false);
    expect(validate(schema, true)).toEqual(false);
    expect(validate(schema, false)).toEqual(false);
    expect(validate(schema, "")).toEqual(false);
    expect(validate(schema, "foo")).toEqual(false);
    expect(validate(schema, "fooBar")).toEqual(false);
    expect(validate(schema, "fooBar2")).toEqual(false);
    expect(validate(schema, "8px")).toEqual(false);
    expect(validate(schema, "Hello, world!")).toEqual(false);
    expect(validate(schema, [])).toEqual(false);
    expect(validate(schema, [1, 2, 3])).toEqual(false);
    expect(validate(schema, [1, "foo", 3])).toEqual(false);
    expect(validate(schema, {})).toEqual(false);
    expect(validate(schema, {a: 1, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: 2, c: 3})).toEqual(false);
    expect(validate(schema, {a: 1, b: "foo", c: 3})).toEqual(false);
    expect(validate(schema, {type: null})).toEqual(false);
    expect(validate(schema, {type: 42})).toEqual(false);
    expect(validate(schema, {type: "foo"})).toEqual(false);
    expect(validate(schema, new Test1())).toEqual(false);
    expect(validate(schema, new Test2({}))).toEqual(false);
    expect(validate(schema, new Test2({type: null}))).toEqual(false);
    expect(validate(schema, new Test2({type: 42}))).toEqual(false);
    expect(validate(schema, new Test2({type: "foo"}))).toEqual(false);
});

test("union requires variant objects to have a type property of the same name", () => {
    expect(() => {
        Schema.union({
            // @ts-expect-error
            foo: Schema.object({
                type: Schema.value("bar"),
            }),
        });
    }).toThrow("Expected value schema for union variant’s `type` property to be `foo`");

    Schema.union({
        // @ts-expect-error
        foo: Schema.object({
            type: Schema.value("foo").optional(),
        }),
    });

    expect(() => {
        Schema.union({
            // @ts-expect-error
            foo: Schema.object({
                type: Schema.value("bar").originalValue("qux"),
            }),
        });
    }).toThrow("Expected value schema for union variant’s `type` property to be `foo`");

    expect(() => {
        Schema.union({
            // @ts-expect-error
            foo: Schema.object({
                type: Schema.value("bar").originalValue("foo"),
            }),
        });
    }).toThrow("Expected value schema for union variant’s `type` property to be `foo`");
});

test("union does not validate objects with an unknown type string", () => {
    const schema = Schema.union({
        foo: Schema.object({
            type: Schema.value("foo"),
        }),
        bar: Schema.object({
            type: Schema.value("bar"),
        }),
    });

    const object1 = {type: "foo"};
    const object2 = {type: "bar"};
    const object3 = {type: "qux"};

    expect(schema.deserialize(object1)).toEqual(object1);
    expect(object1).toEqual({type: "foo"});

    expect(schema.deserialize(object2)).toEqual(object2);
    expect(object2).toEqual({type: "bar"});

    expect(() => schema.deserialize(object3)).toThrow(SchemaDeserializationError);
});

test("union does not look at a type property in the prototype", () => {
    class Test {}
    (Test.prototype as any).type = "foo";

    const schema = Schema.union({
        foo: Schema.object({
            type: Schema.value("foo"),
        }),
        bar: Schema.object({
            type: Schema.value("bar"),
        }),
    });

    expect(validate(schema, new Test())).toEqual(false);
});

test("union variants can be renamed", () => {
    const schema = Schema.union({
        foo: Schema.object({
            type: Schema.value("foo"),
        }),
        bar: Schema.object({
            type: Schema.value("bar").originalValue("qux"),
        }),
    });

    expect(schema.deserialize({type: "foo"})).toEqual({type: "foo"});
    expect(validate(schema, {type: "bar"})).toEqual(false);
    expect(schema.deserialize({type: "qux"})).toEqual({type: "bar"});

    expect(schema.serialize({type: "foo"})).toEqual({type: "foo"});
    expect(schema.serialize({type: "bar"})).toEqual({type: "qux"});
});

test("can rename optional object properties no matter where the combinator lies", () => {
    const schema1 = Schema.object({
        foo: Schema.integer.optional().originalPropertyKey("bar"),
    });

    const schema2 = Schema.object({
        foo: Schema.integer.originalPropertyKey("bar").optional(),
    });

    const schema3 = Schema.object({
        foo: Schema.integer.default(0).originalPropertyKey("bar"),
    });

    const schema4 = Schema.object({
        foo: Schema.integer.originalPropertyKey("bar").default(0),
    });

    expect(schema1.deserialize({})).toEqual({});
    expect(schema1.deserialize({foo: 1})).toEqual({});
    expect(schema1.deserialize({bar: 1})).toEqual({foo: 1});
    expect(schema2.deserialize({})).toEqual({});
    expect(schema2.deserialize({foo: 1})).toEqual({});
    expect(schema2.deserialize({bar: 1})).toEqual({foo: 1});
    expect(schema3.deserialize({})).toEqual({foo: 0});
    expect(schema3.deserialize({foo: 1})).toEqual({foo: 0});
    expect(schema3.deserialize({bar: 1})).toEqual({foo: 1});
    expect(schema4.deserialize({})).toEqual({foo: 0});
    expect(schema4.deserialize({foo: 1})).toEqual({foo: 0});
    expect(schema4.deserialize({bar: 1})).toEqual({foo: 1});
});

test("validate will be null if validation is a noop", () => {
    expect(Schema.float.validate).toEqual(null);
    expect(Schema.integer.validate).not.toEqual(null);

    expect(() => Schema.float.validate?.(3)).not.toThrow(InvalidArgumentError);
    expect(() => Schema.float.validate?.(3.14)).not.toThrow(InvalidArgumentError);
    expect(() => Schema.integer.validate?.(3)).not.toThrow(InvalidArgumentError);
    expect(() => Schema.integer.validate?.(3.14)).toThrow(InvalidArgumentError);
});

test("validate will be null if validation is a noop through levels of composition", () => {
    const schema1 = Schema.array(Schema.object({p: Schema.float}).nullable());
    const schema2 = Schema.array(Schema.object({p: Schema.integer}).nullable());

    expect(schema1.validate).toEqual(null);
    expect(schema2.validate).not.toEqual(null);

    expect(() => schema1.validate?.([{p: 1}, null, {p: 3}])).not.toThrow(InvalidArgumentError);
    expect(() => schema1.validate?.([{p: 1}, null, {p: 3.14}])).not.toThrow(InvalidArgumentError);
    expect(() => schema2.validate?.([{p: 1}, null, {p: 3}])).not.toThrow(InvalidArgumentError);
    expect(() => schema2.validate?.([{p: 1}, null, {p: 3.14}])).toThrow(InvalidArgumentError);
});

test("string trim will actually trim on serialization and throw on validation", () => {
    const schema = Schema.string.trim();

    expect(schema.serialize("foo")).toEqual("foo");
    expect(schema.serialize(" foo")).toEqual("foo");
    expect(schema.serialize("foo ")).toEqual("foo");
    expect(schema.serialize(" foo ")).toEqual("foo");

    expect(() => schema.validate?.("foo")).not.toThrow(InvalidArgumentError);
    expect(() => schema.validate?.(" foo")).toThrow(InvalidArgumentError);
    expect(() => schema.validate?.("foo ")).toThrow(InvalidArgumentError);
    expect(() => schema.validate?.(" foo ")).toThrow(InvalidArgumentError);
});

test("string lower case will actually lower case on serialization and throw on validation", () => {
    const schema = Schema.string.lowerCase();

    expect(schema.serialize("foo")).toEqual("foo");
    expect(schema.serialize("Foo")).toEqual("foo");
    expect(schema.serialize("FOO")).toEqual("foo");

    expect(() => schema.validate?.("foo")).not.toThrow(InvalidArgumentError);
    expect(() => schema.validate?.("Foo")).toThrow(InvalidArgumentError);
    expect(() => schema.validate?.("FOO")).toThrow(InvalidArgumentError);
});

test("missing optional property is still missing when deserialized", () => {
    const schema = Schema.object({p: Schema.integer.optional()});

    expect(hasOwnProperty(schema.deserialize({p: 42}), "p")).toEqual(true);
    expect(hasOwnProperty(schema.deserialize({}), "p")).toEqual(false);
});

test("interface can create multiple independent implementations", () => {
    const Animal = Schema.interface({
        type: Schema.string,
        age: Schema.integer,
    });

    const CatSchema = Animal.implement({
        type: Schema.value("Cat"),
        breed: Schema.enum(["Calico", "Siamese", "Tabby", "Tuxedo"]),
    });

    const DogSchema = Animal.implement({
        type: Schema.value("Dog"),
        breed: Schema.enum(["Bulldog", "Labrador", "Beagle", "Poodle"]),
    });

    const dog1 = new Animal(DogSchema, {type: "Dog", age: 2, breed: "Labrador"});

    expect(dog1.type).toEqual("Dog");
    expect(dog1.age).toEqual(2);
    expect(cast<{type: string; breed?: string}>(dog1).breed).toEqual(undefined);
    expect(dog1.deserialize(DogSchema)).toEqual({type: "Dog", age: 2, breed: "Labrador"});
    expect(() => dog1.deserialize(CatSchema)).toThrow(
        "Can’t deserialize `InterfaceSchemaInstance` with different schemas",
    );

    const dog2 = Animal.schema.deserialize(Animal.schema.serialize(dog1));

    expect(dog2.type).toEqual("Dog");
    expect(dog2.age).toEqual(2);
    expect(cast<{type: string; breed?: string}>(dog2).breed).toEqual(undefined);
    expect(dog2.deserialize(DogSchema)).toEqual({type: "Dog", age: 2, breed: "Labrador"});
    expect(() => dog2.deserialize(CatSchema)).toThrow(
        "Can’t deserialize `InterfaceSchemaInstance` with different schemas",
    );

    const dog3 = Animal.schema.deserialize(Animal.schema.serialize(dog2));

    expect(dog3.type).toEqual("Dog");
    expect(dog3.age).toEqual(2);
    expect(cast<{type: string; breed?: string}>(dog3).breed).toEqual(undefined);
    expect(() => dog3.deserialize(CatSchema)).toThrow("Expected value to be `Cat` in `.type`");
    expect(dog3.deserialize(DogSchema)).toEqual({type: "Dog", age: 2, breed: "Labrador"});
});

test("validation combinator on basic schema accepts values that pass validation", () => {
    const evenIntegerSchema = Schema.integer.validation(
        "must be even",
        (value): value is number => value % 2 === 0,
    );

    expect(validate(evenIntegerSchema, 0)).toEqual(true);
    expect(validate(evenIntegerSchema, 2)).toEqual(true);
    expect(validate(evenIntegerSchema, -4)).toEqual(true);
    expect(validate(evenIntegerSchema, 42)).toEqual(true);
});

test("validation combinator on basic schema rejects values that fail validation", () => {
    const evenIntegerSchema = Schema.integer.validation(
        "must be even",
        (value): value is number => value % 2 === 0,
    );

    expect(validate(evenIntegerSchema, 1)).toEqual(false);
    expect(validate(evenIntegerSchema, 3)).toEqual(false);
    expect(validate(evenIntegerSchema, -5)).toEqual(false);
    expect(validate(evenIntegerSchema, 99)).toEqual(false);
});

test("validation combinator on basic schema still validates underlying schema", () => {
    const evenIntegerSchema = Schema.integer.validation(
        "must be even",
        (value): value is number => value % 2 === 0,
    );

    expect(validate(evenIntegerSchema, 3.14)).toEqual(false);
    expect(validate(evenIntegerSchema, "4")).toEqual(false);
    expect(validate(evenIntegerSchema, true)).toEqual(false);
    expect(validate(evenIntegerSchema, null)).toEqual(false);
    expect(validate(evenIntegerSchema, undefined)).toEqual(false);
});

test("validation combinator throws InvalidArgumentError on serialization failure", () => {
    const evenIntegerSchema = Schema.integer.validation(
        "must be even",
        (value): value is number => value % 2 === 0,
    );

    expect(() => evenIntegerSchema.serialize(1)).toThrow(InvalidArgumentError);
    expect(() => evenIntegerSchema.serialize(1)).toThrow("Validation failed: must be even");
});

test("validation combinator throws SchemaDeserializationError on deserialization failure", () => {
    const evenIntegerSchema = Schema.integer.validation(
        "must be even",
        (value): value is number => value % 2 === 0,
    );

    expect(() => evenIntegerSchema.deserialize(3)).toThrow(SchemaDeserializationError);
    expect(() => evenIntegerSchema.deserialize(3)).toThrow("Validation failed: must be even");
});

test("validation combinator can be chained with multiple validations", () => {
    const positiveEvenIntegerSchema = Schema.integer
        .validation("must be positive", value => value > 0)
        .validation("must be even", value => value % 2 === 0);

    expect(validate(positiveEvenIntegerSchema, 2)).toEqual(true);
    expect(validate(positiveEvenIntegerSchema, 4)).toEqual(true);
    expect(validate(positiveEvenIntegerSchema, 0)).toEqual(false);
    expect(validate(positiveEvenIntegerSchema, -2)).toEqual(false);
    expect(validate(positiveEvenIntegerSchema, 1)).toEqual(false);
    expect(validate(positiveEvenIntegerSchema, 3)).toEqual(false);
});

test("validation combinator works with string schema", () => {
    const nonEmptyStringSchema = Schema.string.validation(
        "must not be empty",
        (value): value is string => value.length > 0,
    );

    expect(validate(nonEmptyStringSchema, "hello")).toEqual(true);
    expect(validate(nonEmptyStringSchema, "a")).toEqual(true);
    expect(validate(nonEmptyStringSchema, "")).toEqual(false);
});

test("validation combinator works with complex validation logic", () => {
    const validEmailSchema = Schema.string.validation(
        "must be valid email",
        (value): value is string => {
            return value.includes("@") && value.includes(".") && value.length > 5;
        },
    );

    expect(validate(validEmailSchema, "user@example.com")).toEqual(true);
    expect(validate(validEmailSchema, "a@b.c")).toEqual(false);
    expect(validate(validEmailSchema, "invalid")).toEqual(false);
    expect(validate(validEmailSchema, "@example.com")).toEqual(true);
    expect(validate(validEmailSchema, "user@")).toEqual(false);
    expect(validate(validEmailSchema, "user.com")).toEqual(false);
});

test("validation combinator preserves original schema behavior on success", () => {
    const trimmedNonEmptyStringSchema = Schema.string
        .trim()
        .validation(
            "must not be empty after trimming",
            (value): value is string => value.length > 0,
        );

    expect(trimmedNonEmptyStringSchema.serialize("  hello  ")).toEqual("hello");
    expect(trimmedNonEmptyStringSchema.deserialize("  world  ")).toEqual("world");
});

test("validation combinator works with nullable schema", () => {
    const positiveIntegerOrNullSchema = Schema.integer
        .nullable()
        .validation(
            "if not null, must be positive",
            (value): value is number | null => value === null || value > 0,
        );

    expect(validate(positiveIntegerOrNullSchema, null)).toEqual(true);
    expect(validate(positiveIntegerOrNullSchema, 5)).toEqual(true);
    expect(validate(positiveIntegerOrNullSchema, -1)).toEqual(false);
    expect(validate(positiveIntegerOrNullSchema, 0)).toEqual(false);
});

test("validation combinator sets validate property to non-null function", () => {
    const basicSchema = Schema.string;
    const validatedSchema = Schema.string.validation("test", () => true);

    expect(basicSchema.validate).toEqual(null);
    expect(validatedSchema.validate).not.toEqual(null);
    expect(typeof validatedSchema.validate).toEqual("function");
});

test("`ObjectSchema` validation combinator accepts objects that pass validation", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    expect(validate(rangeSchema, {min: 1, max: 10})).toEqual(true);
    expect(validate(rangeSchema, {min: 0, max: 1})).toEqual(true);
    expect(validate(rangeSchema, {min: -5, max: 5})).toEqual(true);
});

test("`ObjectSchema` validation combinator rejects objects that fail validation", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    expect(validate(rangeSchema, {min: 10, max: 1})).toEqual(false);
    expect(validate(rangeSchema, {min: 5, max: 5})).toEqual(false);
    expect(validate(rangeSchema, {min: 1, max: 0})).toEqual(false);
});

test("`ObjectSchema` validation combinator still validates object structure", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    expect(validate(rangeSchema, {min: 1.5, max: 10})).toEqual(false);
    expect(validate(rangeSchema, {min: "1", max: 10})).toEqual(false);
    expect(validate(rangeSchema, {max: 10})).toEqual(false);
    expect(validate(rangeSchema, {})).toEqual(false);
    expect(validate(rangeSchema, {min: 1, max: 10, extra: "value"})).toEqual(true);
});

test("`ObjectSchema` validation combinator throws errors with appropriate messages", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    expect(() => rangeSchema.serialize({min: 10, max: 1})).toThrow(InvalidArgumentError);
    expect(() => rangeSchema.serialize({min: 10, max: 1})).toThrow(
        "Validation failed: min must be less than max",
    );

    expect(() => rangeSchema.deserialize({min: 10, max: 1})).toThrow(SchemaDeserializationError);
    expect(() => rangeSchema.deserialize({min: 10, max: 1})).toThrow(
        "Validation failed: min must be less than max",
    );
});

test("`ObjectSchema` validation combinator can be chained with multiple validations", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    })
        .validation("min must be less than max", value => value.min < value.max)
        .validation("range must be at least 2", value => value.max - value.min >= 2);

    expect(validate(rangeSchema, {min: 1, max: 10})).toEqual(true);
    expect(validate(rangeSchema, {min: 0, max: 2})).toEqual(true);
    expect(validate(rangeSchema, {min: 1, max: 2})).toEqual(false);
    expect(validate(rangeSchema, {min: 10, max: 1})).toEqual(false);
});

test("`ObjectSchema` validation combinator works with complex object structures", () => {
    const personSchema = Schema.object({
        name: Schema.string,
        age: Schema.integer,
        email: Schema.string.optional(),
    })
        .validation(
            "if email provided, must contain @",
            value => !value.email || value.email.includes("@"),
        )
        .validation("age must be non-negative", value => value.age >= 0);

    expect(validate(personSchema, {name: "Alice", age: 25})).toEqual(true);
    expect(validate(personSchema, {name: "Bob", age: 30, email: "bob@example.com"})).toEqual(true);
    expect(validate(personSchema, {name: "Charlie", age: 35, email: "invalid"})).toEqual(false);
    expect(validate(personSchema, {name: "David", age: -5})).toEqual(false);
});

test("`ObjectSchema` validation combinator works with nested objects", () => {
    const userSchema = Schema.object({
        profile: Schema.object({
            firstName: Schema.string,
            lastName: Schema.string,
        }),
        settings: Schema.object({
            theme: Schema.enum(["light", "dark"]),
            notifications: Schema.boolean,
        }),
    }).validation(
        "first name and last name must be different",
        value => value.profile.firstName !== value.profile.lastName,
    );

    expect(
        validate(userSchema, {
            profile: {firstName: "John", lastName: "Doe"},
            settings: {theme: "light", notifications: true},
        }),
    ).toEqual(true);

    expect(
        validate(userSchema, {
            profile: {firstName: "John", lastName: "John"},
            settings: {theme: "dark", notifications: false},
        }),
    ).toEqual(false);
});

test("`ObjectSchema` validation combinator can access all object properties", () => {
    const coordinateSchema = Schema.object({
        x: Schema.integer,
        y: Schema.integer,
        z: Schema.integer.optional(),
    }).validation("coordinates must form valid 2D or 3D point", value => {
        if (value.z !== undefined) {
            return Math.abs(value.x) + Math.abs(value.y) + Math.abs(value.z) <= 100;
        }
        return Math.abs(value.x) + Math.abs(value.y) <= 50;
    });

    expect(validate(coordinateSchema, {x: 10, y: 20})).toEqual(true);
    expect(validate(coordinateSchema, {x: 30, y: 30})).toEqual(false);
    expect(validate(coordinateSchema, {x: 10, y: 20, z: 30})).toEqual(true);
    expect(validate(coordinateSchema, {x: 50, y: 40, z: 30})).toEqual(false);
});

test("`ObjectSchema` validation combinator prevents use of omit with validations", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
        name: Schema.string,
    }).validation("min must be less than max", value => value.min < value.max);

    expect(() => rangeSchema.omit(["name"])).toThrow(
        "Can’t use `omit()` on object schema with validations",
    );
});

test("`ObjectSchema` validation combinator prevents use of partial with validations", () => {
    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    expect(() => rangeSchema.partial()).toThrow(
        "Can’t use `partial()` on object schema with validations",
    );
});

test("`ObjectSchema` validation combinator merges validations when extending", () => {
    const baseSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    const extendedSchema = baseSchema.merge(
        Schema.object({
            name: Schema.string,
        }).validation("name must not be empty", value => value.name.length > 0),
    );

    expect(validate(extendedSchema, {min: 1, max: 10, name: "test"})).toEqual(true);
    expect(validate(extendedSchema, {min: 10, max: 1, name: "test"})).toEqual(false);
    expect(validate(extendedSchema, {min: 1, max: 10, name: ""})).toEqual(false);
    expect(validate(extendedSchema, {min: 10, max: 1, name: ""})).toEqual(false);
});

test("`ObjectSchema` validation combinator works with type guard validation", () => {
    type PositiveRange = {min: number; max: number} & {__brand: "positive"};

    const positiveRangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation(
        "both min and max must be positive",
        (value): value is PositiveRange => value.min > 0 && value.max > 0 && value.min < value.max,
    );

    expect(validate(positiveRangeSchema, {min: 1, max: 10})).toEqual(true);
    expect(validate(positiveRangeSchema, {min: -1, max: 10})).toEqual(false);
    expect(validate(positiveRangeSchema, {min: 1, max: -10})).toEqual(false);
    expect(validate(positiveRangeSchema, {min: 0, max: 10})).toEqual(false);
});

test("`ObjectSchema` validation combinator creates non-null validate property", () => {
    const baseSchema = Schema.object({min: Schema.float, max: Schema.float});
    const validatedSchema = baseSchema.validation("test", () => true);

    expect(baseSchema.validate).toEqual(null);
    expect(validatedSchema.validate).not.toEqual(null);
    expect(typeof validatedSchema.validate).toEqual("function");
});

test("validation combinator inside object property schemas runs validations on nested values", () => {
    const evenNumberSchema = Schema.integer.validation("must be even", value => value % 2 === 0);

    const objectSchema = Schema.object({
        id: Schema.string,
        count: evenNumberSchema,
        score: Schema.integer,
    });

    expect(validate(objectSchema, {id: "test", count: 4, score: 100})).toEqual(true);
    expect(validate(objectSchema, {id: "test", count: 2, score: 99})).toEqual(true);
    expect(validate(objectSchema, {id: "test", count: 3, score: 100})).toEqual(false);
    expect(validate(objectSchema, {id: "test", count: 1, score: 99})).toEqual(false);
});

test("validation combinator inside object property schemas throws appropriate errors", () => {
    const positiveNumberSchema = Schema.integer.validation("must be positive", value => value > 0);

    const objectSchema = Schema.object({
        name: Schema.string,
        value: positiveNumberSchema,
    });

    expect(() => objectSchema.serialize({name: "test", value: -5})).toThrow(InvalidArgumentError);
    expect(() => objectSchema.serialize({name: "test", value: -5})).toThrow(
        "Validation failed: must be positive",
    );

    expect(() => objectSchema.deserialize({name: "test", value: 0})).toThrow(
        SchemaDeserializationError,
    );
    expect(() => objectSchema.deserialize({name: "test", value: 0})).toThrow(
        "Validation failed: must be positive",
    );
});

test("validation combinator inside array item schema runs validations on array elements", () => {
    const evenNumberSchema = Schema.integer.validation("must be even", value => value % 2 === 0);
    const arraySchema = Schema.array(evenNumberSchema);

    expect(validate(arraySchema, [])).toEqual(true);
    expect(validate(arraySchema, [2, 4, 6])).toEqual(true);
    expect(validate(arraySchema, [0, -2, 8])).toEqual(true);
    expect(validate(arraySchema, [1, 2, 3])).toEqual(false);
    expect(validate(arraySchema, [2, 4, 5])).toEqual(false);
});

test("validation combinator inside array item schema throws appropriate errors", () => {
    const positiveNumberSchema = Schema.integer.validation("must be positive", value => value > 0);
    const arraySchema = Schema.array(positiveNumberSchema);

    expect(() => arraySchema.serialize([1, 2, -3])).toThrow(InvalidArgumentError);
    expect(() => arraySchema.serialize([1, 2, -3])).toThrow("Validation failed: must be positive");

    expect(() => arraySchema.deserialize([5, 0, 10])).toThrow(SchemaDeserializationError);
    expect(() => arraySchema.deserialize([5, 0, 10])).toThrow(
        "Validation failed: must be positive",
    );
});

test("validation combinator works with nested object structures containing validations", () => {
    const emailSchema = Schema.string.validation(
        "must be valid email",
        value => value.includes("@") && value.includes("."),
    );

    const rangeSchema = Schema.object({
        min: Schema.integer,
        max: Schema.integer,
    }).validation("min must be less than max", value => value.min < value.max);

    const userSchema = Schema.object({
        profile: Schema.object({
            email: emailSchema,
            name: Schema.string,
        }),
        settings: rangeSchema,
        tags: Schema.array(
            Schema.string.validation("tag must not be empty", value => value.length > 0),
        ),
    });

    expect(
        validate(userSchema, {
            profile: {email: "user@example.com", name: "John"},
            settings: {min: 1, max: 10},
            tags: ["work", "personal"],
        }),
    ).toEqual(true);

    expect(
        validate(userSchema, {
            profile: {email: "invalid-email", name: "John"},
            settings: {min: 1, max: 10},
            tags: ["work", "personal"],
        }),
    ).toEqual(false);

    expect(
        validate(userSchema, {
            profile: {email: "user@example.com", name: "John"},
            settings: {min: 10, max: 1},
            tags: ["work", "personal"],
        }),
    ).toEqual(false);

    expect(
        validate(userSchema, {
            profile: {email: "user@example.com", name: "John"},
            settings: {min: 1, max: 10},
            tags: ["work", ""],
        }),
    ).toEqual(false);
});

test("validation combinator inside nullable schema works correctly", () => {
    const positiveNumberSchema = Schema.integer
        .validation("must be positive", value => value > 0)
        .nullable();

    const objectSchema = Schema.object({
        optionalValue: positiveNumberSchema,
    });

    expect(validate(objectSchema, {optionalValue: null})).toEqual(true);
    expect(validate(objectSchema, {optionalValue: 5})).toEqual(true);
    expect(validate(objectSchema, {optionalValue: -1})).toEqual(false);
    expect(validate(objectSchema, {optionalValue: 0})).toEqual(false);
});

test("validation combinator inside optional object property works correctly", () => {
    const positiveNumberSchema = Schema.integer.validation("must be positive", value => value > 0);

    const objectSchema = Schema.object({
        requiredValue: Schema.string,
        optionalValue: positiveNumberSchema.optional(),
    });

    expect(validate(objectSchema, {requiredValue: "test"})).toEqual(true);
    expect(validate(objectSchema, {requiredValue: "test", optionalValue: 5})).toEqual(true);
    expect(validate(objectSchema, {requiredValue: "test", optionalValue: -1})).toEqual(false);
    expect(validate(objectSchema, {requiredValue: "test", optionalValue: 0})).toEqual(false);
});

test("validation combinator inside union variant schemas works correctly", () => {
    const positiveIntegerSchema = Schema.integer.validation("must be positive", value => value > 0);

    const unionSchema = Schema.union({
        numberVariant: Schema.object({
            type: Schema.value("numberVariant"),
            value: positiveIntegerSchema,
        }),
        stringVariant: Schema.object({
            type: Schema.value("stringVariant"),
            value: Schema.string.validation("must not be empty", value => value.length > 0),
        }),
    });

    expect(validate(unionSchema, {type: "numberVariant", value: 5})).toEqual(true);
    expect(validate(unionSchema, {type: "stringVariant", value: "hello"})).toEqual(true);
    expect(validate(unionSchema, {type: "numberVariant", value: -1})).toEqual(false);
    expect(validate(unionSchema, {type: "stringVariant", value: ""})).toEqual(false);
});

test("multiple validation combinators in deeply nested structures work correctly", () => {
    const positiveSchema = Schema.integer.validation("must be positive", value => value > 0);
    const evenSchema = Schema.integer.validation("must be even", value => value % 2 === 0);
    const nonEmptyStringSchema = Schema.string.validation(
        "must not be empty",
        value => value.length > 0,
    );

    const complexSchema = Schema.object({
        metadata: Schema.object({
            tags: Schema.array(nonEmptyStringSchema),
            scores: Schema.array(positiveSchema),
        }),
        data: Schema.array(
            Schema.object({
                id: nonEmptyStringSchema,
                count: evenSchema,
            }),
        ),
    });

    expect(
        validate(complexSchema, {
            metadata: {
                tags: ["tag1", "tag2"],
                scores: [1, 2, 3],
            },
            data: [
                {id: "item1", count: 2},
                {id: "item2", count: 4},
            ],
        }),
    ).toEqual(true);

    expect(
        validate(complexSchema, {
            metadata: {
                tags: ["tag1", ""],
                scores: [1, 2, 3],
            },
            data: [{id: "item1", count: 2}],
        }),
    ).toEqual(false);

    expect(
        validate(complexSchema, {
            metadata: {
                tags: ["tag1", "tag2"],
                scores: [1, -2, 3],
            },
            data: [{id: "item1", count: 2}],
        }),
    ).toEqual(false);

    expect(
        validate(complexSchema, {
            metadata: {
                tags: ["tag1", "tag2"],
                scores: [1, 2, 3],
            },
            data: [{id: "item1", count: 3}],
        }),
    ).toEqual(false);
});

test("validation combinator preserves validation order in nested structures", () => {
    const multiValidationSchema = Schema.integer
        .validation("must be positive", value => value > 0)
        .validation("must be even", value => value % 2 === 0);

    const arraySchema = Schema.array(multiValidationSchema);

    expect(validate(arraySchema, [2, 4, 6])).toEqual(true);
    expect(validate(arraySchema, [0, 2, 4])).toEqual(false);
    expect(validate(arraySchema, [1, 2, 4])).toEqual(false);
    expect(validate(arraySchema, [-2, 4, 6])).toEqual(false);
});

test("validation combinator inside map value schema works correctly", () => {
    const positiveNumberSchema = Schema.integer.validation("must be positive", value => value > 0);
    const mapSchema = Schema.map(Schema.string, positiveNumberSchema);

    const validMap = [
        ["key1", 5],
        ["key2", 10],
        ["key3", 1],
    ];

    const invalidMap = [
        ["key1", 5],
        ["key2", -10],
        ["key3", 1],
    ];

    expect(validate(mapSchema, validMap)).toEqual(true);
    expect(validate(mapSchema, invalidMap)).toEqual(false);
});

test("validation combinator inside set item schema works correctly", () => {
    const evenNumberSchema = Schema.integer.validation("must be even", value => value % 2 === 0);
    const setSchema = Schema.set(evenNumberSchema);

    const validSet = [2, 4, 6];
    const invalidSet = [2, 3, 4];

    expect(validate(setSchema, validSet)).toEqual(true);
    expect(validate(setSchema, invalidSet)).toEqual(false);
});
