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
