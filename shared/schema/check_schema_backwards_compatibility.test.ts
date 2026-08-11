import {BlockInference} from "~/shared/helpers/types/block_inference.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    SchemaBackwardsIncompatibleError,
    checkSchemaBackwardsCompatibility,
} from "~/shared/schema/check_schema_backwards_compatibility.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

function testCase<LastValue, NextValue>({
    isBackwardsCompatible,
    lastSchema,
    nextSchema,
    sampleValues,
}: {
    isBackwardsCompatible: boolean;
    lastSchema: Schema<LastValue>;
    nextSchema: Schema<NextValue>;
    sampleValues: Array<BlockInference<LastValue>>;
}) {
    if (isBackwardsCompatible) {
        expect(() => {
            checkSchemaBackwardsCompatibility(
                lastSchema.getDescription(),
                nextSchema.getDescription(),
            );
        }).not.toThrow();

        for (const sampleValue of sampleValues) {
            expect(() => {
                nextSchema.deserialize(lastSchema.serialize(sampleValue as LastValue));
            }).not.toThrow();
        }
    } else {
        expect(() => {
            checkSchemaBackwardsCompatibility(
                lastSchema.getDescription(),
                nextSchema.getDescription(),
            );
        }).toThrow(SchemaBackwardsIncompatibleError);

        for (const sampleValue of sampleValues) {
            expect(() => {
                nextSchema.deserialize(lastSchema.serialize(sampleValue as LastValue));
            }).toThrow(SchemaDeserializationError);
        }
    }
}

test("value schemas can generalize to the full type", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value(true),
        nextSchema: Schema.boolean,
        sampleValues: [true],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value(42),
        nextSchema: Schema.float,
        sampleValues: [42],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value(42),
        nextSchema: Schema.integer,
        sampleValues: [42],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value(3.14),
        nextSchema: Schema.float,
        sampleValues: [3.14],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value("foo"),
        nextSchema: Schema.string,
        sampleValues: ["foo"],
    });
});

test("value schemas can not generalize to a different type", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value(3.14),
        nextSchema: Schema.integer,
        sampleValues: [3.14],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value(42),
        nextSchema: Schema.boolean,
        sampleValues: [42],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value(42),
        nextSchema: Schema.string,
        sampleValues: [42],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value("42"),
        nextSchema: Schema.integer,
        sampleValues: ["42"],
    });
});

test("value schemas are not compatible with a value schema with a different value", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value(3.14),
        nextSchema: Schema.value(42),
        sampleValues: [3.14],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value(42),
        nextSchema: Schema.value(3.14),
        sampleValues: [42],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value("foo"),
        nextSchema: Schema.value("bar"),
        sampleValues: ["foo"],
    });
});

test("scalar schemas are backwards compatible with themselves", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.boolean,
        nextSchema: Schema.boolean,
        sampleValues: [true, false],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.integer,
        nextSchema: Schema.integer,
        sampleValues: [-42, 0, 1, 2, 42],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.float,
        nextSchema: Schema.float,
        sampleValues: [-42, -3.14, 0, 1, 2, 3.14, 42],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.string,
        nextSchema: Schema.string,
        sampleValues: ["", "foo", "bar"],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.bytes,
        nextSchema: Schema.bytes,
        sampleValues: [new Uint8Array(), new Uint8Array([0, 1, 2])],
    });
});

test("scalar schemas are not backwards compatible with other schemas", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.boolean,
        nextSchema: Schema.integer,
        sampleValues: [true, false],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.integer,
        nextSchema: Schema.boolean,
        sampleValues: [-42, 0, 1, 2, 42],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.float,
        nextSchema: Schema.integer,
        sampleValues: [-3.14, 3.14],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.string,
        nextSchema: Schema.array(Schema.string),
        sampleValues: ["", "foo", "bar"],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.bytes,
        nextSchema: Schema.string,
        sampleValues: [new Uint8Array(), new Uint8Array([0, 1, 2])],
    });
});

test("integer schema is backwards compatible with float schema", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.integer,
        nextSchema: Schema.float,
        sampleValues: [-42, 0, 1, 2, 42],
    });
});

test("non-null schema is backwards compatible with nullable schema", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.integer,
        nextSchema: Schema.integer.nullable(),
        sampleValues: [-42, 0, 1, 2, 42],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.integer.nullable(),
        nextSchema: Schema.integer,
        sampleValues: [null],
    });
});

test("array schema is backwards compatible if its items are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.array(Schema.integer),
        nextSchema: Schema.array(Schema.integer.nullable()),
        sampleValues: [[], [1], [1, 2, 3]],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.array(Schema.integer.nullable()),
        nextSchema: Schema.array(Schema.integer),
        sampleValues: [[null], [null, null, null]],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.array(Schema.integer),
        nextSchema: Schema.array(Schema.string),
        sampleValues: [[1], [1, 2, 3]],
    });
});

test("object schema is backwards compatible if its keys are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.integer.nullable()}),
        sampleValues: [
            {x: 1, y: 2},
            {x: 3, y: 4},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.nullable()}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.integer}),
        sampleValues: [{x: 1, y: null}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.string}),
        sampleValues: [{x: 1, y: 2}],
    });
});

test("object schema can add or remove optional properties", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.optional(),
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
        }),
        sampleValues: [
            {x: 1, y: 2},
            {x: 3, y: 4, z: 5},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.optional(),
        }),
        sampleValues: [{x: 1, y: 2}],
    });
});

test("object schema is backwards compatible for optional properties if those properties are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.optional()}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.integer.nullable().optional()}),
        sampleValues: [
            {x: 1, y: 2},
            {x: 3, y: 4},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.nullable().optional()}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.integer.optional()}),
        sampleValues: [{x: 1, y: null}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.optional()}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.string.optional()}),
        sampleValues: [{x: 1, y: 2}],
    });
});

test("object schema can not make an optional property required", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer,
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.optional(),
        }),
        sampleValues: [{x: 1, y: 2, z: 3}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.optional(),
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer,
        }),
        sampleValues: [{x: 1, y: 2}],
    });
});

test("object schema can add or remove properties with default", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.default(0),
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
        }),
        sampleValues: [
            {x: 1, y: 2, z: 3},
            {x: 4, y: 5, z: 6},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.default(0),
        }),
        sampleValues: [{x: 1, y: 2}],
    });
});

test("object schema is backwards compatible for default properties if those properties are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.default(0)}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.integer.nullable().default(0)}),
        sampleValues: [
            {x: 1, y: 2},
            {x: 3, y: 4},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.nullable().default(0)}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.integer.default(0)}),
        sampleValues: [{x: 1, y: null}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({x: Schema.integer, y: Schema.integer.default(0)}),
        nextSchema: Schema.object({x: Schema.integer, y: Schema.string.default("foo")}),
        sampleValues: [{x: 1, y: 2}],
    });
});

test("object schema can not make a default property required", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer,
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.default(0),
        }),
        sampleValues: [{x: 1, y: 2, z: 3}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.default(0),
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer,
        }),
        sampleValues: [],
    });
});

test("object schema can change default value required", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.default(-42),
        }),
        nextSchema: Schema.object({
            x: Schema.integer,
            y: Schema.integer,
            z: Schema.integer.default(+42),
        }),
        sampleValues: [{x: 1, y: 2, z: 3}],
    });
});

test("object schema can rename properties with original property key", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            foo: Schema.integer,
            bar: Schema.integer,
        }),
        nextSchema: Schema.object({
            foo: Schema.integer,
            qux: Schema.integer.originalPropertyKey("bar"),
        }),
        sampleValues: [{foo: 1, bar: 2}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({
            foo: Schema.integer,
            bar: Schema.integer,
        }),
        nextSchema: Schema.object({
            foo: Schema.integer,
            qux: Schema.integer,
        }),
        sampleValues: [{foo: 1, bar: 2}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({
            foo: Schema.integer,
            qux: Schema.integer.originalPropertyKey("bar"),
        }),
        nextSchema: Schema.object({
            foo: Schema.integer,
            bar: Schema.integer,
        }),
        sampleValues: [{foo: 1, qux: 2}],
    });
});

test("union schema is backwards compatible if its object schemas are", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer.nullable(),
            }),
        }),
        sampleValues: [
            {type: "foo", foo: 1},
            {type: "bar", bar: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer.nullable(),
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        sampleValues: [{type: "bar", bar: null}],
    });
});

test("union schema can add new variants and be backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        sampleValues: [{type: "foo", foo: 1}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
        }),
        sampleValues: [{type: "bar", bar: 2}],
    });
});

test("union schema variants can be renamed with original variant name", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            qux: Schema.object({
                type: Schema.value("qux").originalValue("bar"),
                bar: Schema.integer,
            }),
        }),
        sampleValues: [
            {type: "foo", foo: 1},
            {type: "bar", bar: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            qux: Schema.object({
                type: Schema.value("qux"),
                bar: Schema.integer,
            }),
        }),
        sampleValues: [{type: "bar", bar: 2}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            qux: Schema.object({
                type: Schema.value("qux").originalValue("bar"),
                bar: Schema.integer,
            }),
        }),
        nextSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                foo: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                bar: Schema.integer,
            }),
        }),
        sampleValues: [
            {type: "foo", foo: 1},
            {type: "qux", bar: 2},
        ],
    });
});

test("any schema may convert into unknown", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.unknown(),
        nextSchema: Schema.unknown(),
        sampleValues: [42, "foo", {x: 1, y: 2}, false],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.integer,
        nextSchema: Schema.unknown(),
        sampleValues: [1, 2, 3],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.unknown(),
        nextSchema: Schema.integer,
        sampleValues: ["foo", {x: 1, y: 2}, false],
    });
});

test("id may convert into string", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.id(),
        nextSchema: Schema.id(),
        sampleValues: [generateId()],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.id(),
        nextSchema: Schema.string,
        sampleValues: [generateId()],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.string,
        nextSchema: Schema.id(),
        sampleValues: ["", "foo"],
    });
});

test("result entries are separately backwards compatible with each other", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        nextSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        sampleValues: [
            {ok: true, foo: 1},
            {ok: false, bar: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        nextSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer.nullable(),
            }),
        ),
        sampleValues: [
            {ok: true, foo: 1},
            {ok: false, bar: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        nextSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer.nullable(),
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        sampleValues: [
            {ok: true, foo: 1},
            {ok: false, bar: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer.nullable(),
            }),
        ),
        nextSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        sampleValues: [{ok: false, bar: null}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer.nullable(),
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        nextSchema: Schema.result(
            Schema.object({
                ok: Schema.value(true),
                foo: Schema.integer,
            }),
            Schema.object({
                ok: Schema.value(false),
                bar: Schema.integer,
            }),
        ),
        sampleValues: [{ok: true, foo: null}],
    });
});

test("set schema is backwards compatible if its items are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.set(Schema.integer),
        nextSchema: Schema.set(Schema.integer.nullable()),
        sampleValues: [new Set([]), new Set([1]), new Set([1, 2, 3])],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.set(Schema.integer.nullable()),
        nextSchema: Schema.set(Schema.integer),
        sampleValues: [new Set([null]), new Set([null, null, null])],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.set(Schema.integer),
        nextSchema: Schema.set(Schema.string),
        sampleValues: [new Set([1]), new Set([1, 2, 3])],
    });
});

test("map schema is backwards compatible if its entries are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.map(Schema.integer, Schema.integer),
        nextSchema: Schema.map(Schema.integer.nullable(), Schema.integer),
        sampleValues: [
            new Map<number, number>([]),
            new Map([[1, 1]]),
            new Map([
                [1, 3],
                [2, 2],
                [3, 1],
            ]),
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.map(Schema.integer, Schema.integer),
        nextSchema: Schema.map(Schema.integer, Schema.integer.nullable()),
        sampleValues: [
            new Map<number, number>([]),
            new Map([[1, 1]]),
            new Map([
                [1, 3],
                [2, 2],
                [3, 1],
            ]),
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.map(Schema.integer.nullable(), Schema.integer),
        nextSchema: Schema.map(Schema.integer, Schema.integer),
        sampleValues: [
            new Map([[null, 1]]),
            new Map([
                [null, 1],
                [null, 2],
                [null, 3],
            ]),
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.map(Schema.integer, Schema.integer.nullable()),
        nextSchema: Schema.map(Schema.integer, Schema.integer),
        sampleValues: [
            new Map([[1, null]]),
            new Map([
                [1, null],
                [2, null],
                [3, null],
            ]),
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.map(Schema.integer, Schema.integer),
        nextSchema: Schema.map(Schema.string, Schema.integer),
        sampleValues: [
            new Map([[1, 1]]),
            new Map([
                [1, 3],
                [2, 2],
                [3, 1],
            ]),
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.map(Schema.integer, Schema.integer),
        nextSchema: Schema.map(Schema.integer, Schema.string),
        sampleValues: [
            new Map([[1, 1]]),
            new Map([
                [1, 3],
                [2, 2],
                [3, 1],
            ]),
        ],
    });
});

test("enum may add values but not remove them", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.enum([1, 2, 3] as const),
        nextSchema: Schema.enum([1, 2, 3, 4, 5] as const),
        sampleValues: [1, 2, 3],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.enum([1, 2, 3, 4, 5] as const),
        nextSchema: Schema.enum([1, 2, 3] as const),
        sampleValues: [4, 5],
    });
});

test("enum may add values to a single value schema", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value(1),
        nextSchema: Schema.enum([1, 2, 3]),
        sampleValues: [1],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value(4),
        nextSchema: Schema.enum([1, 2, 3]),
        sampleValues: [4],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value(4).originalValue(1),
        nextSchema: Schema.enum([1, 2, 3]),
        sampleValues: [4],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.enum([1, 2, 3]),
        nextSchema: Schema.value(1),
        sampleValues: [2, 3],
    });
});

test("value schema may change over time", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.value("foo"),
        nextSchema: Schema.value("bar"),
        sampleValues: ["foo"],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value("foo"),
        nextSchema: Schema.value("bar").originalValue("foo"),
        sampleValues: ["foo"],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.value("foo").originalValue("bar"),
        nextSchema: Schema.value("bar"),
        sampleValues: ["foo"],
    });
});

test("tuple schema is backwards compatible if its elements are backwards compatible", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.tuple([]),
        nextSchema: Schema.tuple([]),
        sampleValues: [[]],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.tuple([Schema.integer, Schema.integer]),
        nextSchema: Schema.tuple([Schema.integer, Schema.integer.nullable()]),
        sampleValues: [
            [1, 2],
            [3, 4],
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.tuple([Schema.integer, Schema.integer.nullable()]),
        nextSchema: Schema.tuple([Schema.integer, Schema.integer]),
        sampleValues: [[1, null]],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.tuple([Schema.integer, Schema.integer]),
        nextSchema: Schema.tuple([Schema.integer, Schema.string]),
        sampleValues: [[1, 2]],
    });
});

test("tuple schema can not change element lengths", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.tuple([Schema.integer]),
        nextSchema: Schema.tuple([Schema.integer, Schema.integer]),
        sampleValues: [[1]],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.tuple([Schema.integer, Schema.integer]),
        nextSchema: Schema.tuple([Schema.integer]),
        sampleValues: [[1, 2]],
    });
});

test("union schema can become object schema when there\u2019s one variant", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.value("foo"),
            a: Schema.integer,
        }),
        sampleValues: [{type: "foo", a: 1}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.value("foo"),
            a: Schema.integer.optional(),
        }),
        sampleValues: [{type: "foo", a: 1}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer.optional(),
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.value("foo"),
            a: Schema.integer,
        }),
        sampleValues: [{type: "foo"}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            a: Schema.integer,
        }),
        sampleValues: [{type: "foo", a: 1}],
    });
});

test("union schema can become object schema when there\u2019s multiple variants", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar"]),
            a: Schema.integer,
        }),
        sampleValues: [
            {type: "foo", a: 1},
            {type: "bar", a: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                a: Schema.integer,
            }),
            qux: Schema.object({
                type: Schema.value("qux"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar", "qux"]),
            a: Schema.integer,
        }),
        sampleValues: [
            {type: "foo", a: 1},
            {type: "bar", a: 2},
            {type: "qux", a: 3},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                a: Schema.integer,
            }),
            qux: Schema.object({
                type: Schema.value("qux"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar", "qux"]),
            a: Schema.integer.optional(),
        }),
        sampleValues: [
            {type: "foo", a: 1},
            {type: "bar", a: 2},
            {type: "qux", a: 3},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                a: Schema.integer.optional(),
            }),
            qux: Schema.object({
                type: Schema.value("qux"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar", "qux"]),
            a: Schema.integer.optional(),
        }),
        sampleValues: [
            {type: "foo", a: 1},
            {type: "bar", a: 2},
            {type: "bar"},
            {type: "qux", a: 3},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                a: Schema.integer.optional(),
            }),
            qux: Schema.object({
                type: Schema.value("qux"),
                a: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar", "qux"]),
            a: Schema.integer,
        }),
        sampleValues: [{type: "bar"}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                b: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar"]),
            a: Schema.integer.optional(),
            b: Schema.integer.optional(),
        }),
        sampleValues: [
            {type: "foo", a: 1},
            {type: "bar", b: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.union({
            foo: Schema.object({
                type: Schema.value("foo"),
                a: Schema.integer,
            }),
            bar: Schema.object({
                type: Schema.value("bar"),
                b: Schema.integer,
            }),
        }),
        nextSchema: Schema.object({
            type: Schema.enum(["foo", "bar"]),
            a: Schema.integer,
            b: Schema.integer.optional(),
        }),
        sampleValues: [{type: "bar", b: 2}],
    });
});

test("object can become union", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"])}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a")}),
            b: Schema.object({type: Schema.value("b")}),
        }),
        sampleValues: [{type: "a"}, {type: "b"}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({type: Schema.enum(["a", "b", "c"])}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a")}),
            b: Schema.object({type: Schema.value("b")}),
        }),
        sampleValues: [{type: "c"}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"])}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a")}),
            b: Schema.object({type: Schema.value("b")}),
            c: Schema.object({type: Schema.value("c")}),
        }),
        sampleValues: [{type: "a"}, {type: "b"}],
    });
});

test("object with properties can become union", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"]), foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.integer}),
        }),
        sampleValues: [
            {type: "a", foo: 1},
            {type: "b", foo: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"]), foo: Schema.integer.optional()}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.integer}),
        }),
        sampleValues: [{type: "a"}, {type: "b"}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"]), foo: Schema.integer.optional()}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a")}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.integer}),
        }),
        sampleValues: [{type: "b"}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"]), foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.integer.optional()}),
        }),
        sampleValues: [
            {type: "a", foo: 1},
            {type: "b", foo: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({type: Schema.enum(["a", "b"]), foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.integer}),
            c: Schema.object({type: Schema.value("c"), foo: Schema.integer.optional()}),
            d: Schema.object({type: Schema.value("d")}),
        }),
        sampleValues: [
            {type: "a", foo: 1},
            {type: "b", foo: 2},
        ],
    });
});

test("object can become union with custom key", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"])}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a")}),
            b: Schema.object({bar: Schema.value("b")}),
        }),
        sampleValues: [{bar: "a"}, {bar: "b"}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b", "c"])}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a")}),
            b: Schema.object({bar: Schema.value("b")}),
        }),
        sampleValues: [{bar: "c"}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"])}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a")}),
            b: Schema.object({bar: Schema.value("b")}),
            c: Schema.object({bar: Schema.value("c")}),
        }),
        sampleValues: [{bar: "a"}, {bar: "b"}],
    });
});

test("object with properties can become union with custom key", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"]), foo: Schema.integer}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({bar: Schema.value("b"), foo: Schema.integer}),
        }),
        sampleValues: [
            {bar: "a", foo: 1},
            {bar: "b", foo: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"]), foo: Schema.integer.optional()}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({bar: Schema.value("b"), foo: Schema.integer}),
        }),
        sampleValues: [{bar: "a"}, {bar: "b"}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"]), foo: Schema.integer.optional()}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a")}),
            b: Schema.object({bar: Schema.value("b"), foo: Schema.integer}),
        }),
        sampleValues: [{bar: "b"}],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"]), foo: Schema.integer}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({bar: Schema.value("b"), foo: Schema.integer.optional()}),
        }),
        sampleValues: [
            {bar: "a", foo: 1},
            {bar: "b", foo: 2},
        ],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({bar: Schema.enum(["a", "b"]), foo: Schema.integer}),
        nextSchema: Schema.unionWithKey("bar", {
            a: Schema.object({bar: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({bar: Schema.value("b"), foo: Schema.integer}),
            c: Schema.object({bar: Schema.value("c"), foo: Schema.integer.optional()}),
            d: Schema.object({bar: Schema.value("d")}),
        }),
        sampleValues: [
            {bar: "a", foo: 1},
            {bar: "b", foo: 2},
        ],
    });
});

test("object can become union with default type", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        }).defaultVariant("a"),
        sampleValues: [{foo: 1}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        }).defaultVariant("b"),
        sampleValues: [{foo: 1}],
    });
});

test("object can become union with default type when there\u2019s a type value", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        }).defaultVariant("a"),
        sampleValues: [{type: "a", foo: 1}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({type: Schema.value("b"), foo: Schema.integer}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        }).defaultVariant("a"),
        sampleValues: [{type: "b", foo: 1}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        nextSchema: Schema.object({type: Schema.value("a").optional(), foo: Schema.integer}),
        sampleValues: [{type: "b", foo: "yo"}],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        nextSchema: Schema.union({
            a: Schema.object({type: Schema.value("a"), foo: Schema.integer}),
            b: Schema.object({type: Schema.value("b"), foo: Schema.string}),
        }).defaultVariant("a"),
        sampleValues: [],
    });
});

test("property can become object with `wrapOriginalPropertyInObject()`", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({foo: Schema.integer}),
        nextSchema: Schema.object({
            foo: Schema.object({
                a: Schema.integer,
                b: Schema.integer,
            }).wrapOriginalPropertyInObject("a", {b: 2}),
        }),
        sampleValues: [{foo: 1}],
    });
});

test("renamed property can become object with `wrapOriginalPropertyInObject()`", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({foo: Schema.integer}),
        nextSchema: Schema.object({
            qux: Schema.object({foo: Schema.integer, b: Schema.integer})
                .wrapOriginalPropertyInObject("foo", {b: 2})
                .originalPropertyKey("foo"),
        }),
        sampleValues: [{foo: 1}],
    });
});

test("property that became object with `wrapOriginalPropertyInObject()` checks backwards compatibility in other properties", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({
            foo: Schema.object({
                a: Schema.integer,
                b: Schema.integer,
            }).wrapOriginalPropertyInObject("a", {b: 2}),
        }),
        nextSchema: Schema.object({
            foo: Schema.object({
                a: Schema.integer,
                b: Schema.string,
            }).wrapOriginalPropertyInObject("a", {b: "hello"}),
        }),
        sampleValues: [{foo: {a: 1, b: 2}}],
    });
});

test("property can become union with `wrapOriginalPropertyInUnionVariant()`", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({foo: Schema.integer}),
        nextSchema: Schema.object({
            foo: Schema.union({
                X: Schema.object({
                    type: Schema.value("X"),
                    a: Schema.integer,
                    b: Schema.integer,
                }),
                Y: Schema.object({
                    type: Schema.value("Y"),
                    c: Schema.integer,
                    d: Schema.integer,
                }),
            }).wrapOriginalPropertyInUnionVariant("X", "a", {b: 2}),
        }),
        sampleValues: [{foo: 1}],
    });
});

test("renamed property can become union with `wrapOriginalPropertyInUnionVariant()`", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.object({foo: Schema.integer}),
        nextSchema: Schema.object({
            qux: Schema.union({
                X: Schema.object({
                    type: Schema.value("X"),
                    a: Schema.integer,
                    b: Schema.integer,
                }),
                Y: Schema.object({
                    type: Schema.value("Y"),
                    c: Schema.integer,
                    d: Schema.integer,
                }),
            })
                .wrapOriginalPropertyInUnionVariant("X", "a", {b: 2})
                .originalPropertyKey("foo"),
        }),
        sampleValues: [{foo: 1}],
    });
});

test("property that became object with `wrapOriginalPropertyInUnionVariant()` checks backwards compatibility in other properties", () => {
    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.object({
            foo: Schema.union({
                X: Schema.object({
                    type: Schema.value("X"),
                    a: Schema.integer,
                    b: Schema.integer,
                }),
                Y: Schema.object({
                    type: Schema.value("Y"),
                    c: Schema.integer,
                    d: Schema.integer,
                }),
            }).wrapOriginalPropertyInUnionVariant("X", "a", {b: 2}),
        }),
        nextSchema: Schema.object({
            foo: Schema.union({
                X: Schema.object({
                    type: Schema.value("X"),
                    a: Schema.integer,
                    b: Schema.string,
                }),
                Y: Schema.object({
                    type: Schema.value("Y"),
                    c: Schema.integer,
                    d: Schema.integer,
                }),
            }).wrapOriginalPropertyInUnionVariant("X", "a", {b: "hello"}),
        }),
        sampleValues: [{foo: {type: "X", a: 1, b: 2}}],
    });
});
