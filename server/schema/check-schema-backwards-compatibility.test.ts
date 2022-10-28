import {
    SchemaBackwardsIncompatibleError,
    checkSchemaBackwardsCompatibility,
} from "~/server/schema/check-schema-backwards-compatibility";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {generateId} from "~/shared/id/id";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";

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
            checkSchemaBackwardsCompatibility(lastSchema.description, nextSchema.description);
        }).not.toThrow();

        for (const sampleValue of sampleValues) {
            expect(() => {
                nextSchema.deserialize(lastSchema.serialize(sampleValue as LastValue));
            }).not.toThrow();
        }
    } else {
        expect(() => {
            checkSchemaBackwardsCompatibility(lastSchema.description, nextSchema.description);
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
                type: Schema.value("qux"),
                bar: Schema.integer,
            }).originalUnionType("bar"),
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
                type: Schema.value("qux"),
                bar: Schema.integer,
            }).originalUnionType("bar"),
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
        lastSchema: Schema.unknown,
        nextSchema: Schema.unknown,
        sampleValues: [42, "foo", {x: 1, y: 2}, false],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.integer,
        nextSchema: Schema.unknown,
        sampleValues: [1, 2, 3],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.unknown,
        nextSchema: Schema.integer,
        sampleValues: ["foo", {x: 1, y: 2}, false],
    });
});

test("id may convert into string", () => {
    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.id,
        nextSchema: Schema.id,
        sampleValues: [generateId()],
    });

    testCase({
        isBackwardsCompatible: true,
        lastSchema: Schema.id,
        nextSchema: Schema.string,
        sampleValues: [generateId()],
    });

    testCase({
        isBackwardsCompatible: false,
        lastSchema: Schema.string,
        nextSchema: Schema.id,
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
