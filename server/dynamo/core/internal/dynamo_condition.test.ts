import {
    DynamoCondition,
    DynamoConditionExpression,
    DynamoConditionExpressionCompilationContext,
} from "~/server/dynamo/core/internal/dynamo_condition.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const schema = Schema.object({
    a: Schema.integer,
    b: Schema.integer.nullable(),
    c: Schema.integer.optional(),
    d: Schema.integer.nullable().optional(),
    e: Schema.integer.default(0),
    f: Schema.integer.originalPropertyKey("x"),
    o: Schema.object({
        a: Schema.integer,
        b: Schema.integer.nullable(),
        c: Schema.integer.optional(),
        d: Schema.integer.nullable().optional(),
        e: Schema.integer.default(0),
        f: Schema.integer.originalPropertyKey("x"),
        o: Schema.object({
            a: Schema.integer,
            b: Schema.integer.nullable(),
            c: Schema.integer.optional(),
            d: Schema.integer.nullable().optional(),
            e: Schema.integer.default(0),
            f: Schema.integer.originalPropertyKey("x"),
        }),
    }),
});

function compile(condition: DynamoCondition<SchemaType<typeof schema>>): {
    string: string;
    variables: {[key: string]: unknown};
} {
    const context = DynamoConditionExpressionCompilationContext.new();
    const {string} = DynamoConditionExpression.from(condition).compile(schema, context);
    return {
        string,
        variables: Object.fromEntries(context.iterateVariables()),
    };
}

test("compiles plain equals expression", () => {
    expect(compile({a: 1})).toEqual({
        string: "a = :v1",
        variables: {":v1": 1},
    });
    expect(compile({b: 2})).toEqual({
        string: "b = :v1",
        variables: {":v1": 2},
    });
    expect(compile({b: null})).toEqual({
        string: "b = :v1",
        variables: {":v1": null},
    });
    expect(compile({c: 3})).toEqual({
        string: "c = :v1",
        variables: {":v1": 3},
    });
    expect(compile({c: 3})).toEqual({
        string: "c = :v1",
        variables: {":v1": 3},
    });
    expect(compile({d: 4})).toEqual({
        string: "d = :v1",
        variables: {":v1": 4},
    });
    expect(compile({d: null})).toEqual({
        string: "d = :v1",
        variables: {":v1": null},
    });
    expect(compile({e: 1})).toEqual({
        string: "attribute_not_exists(e) and :v2 = :v1 or attribute_exists(e) and e = :v1",
        variables: {":v1": 1, ":v2": 0},
    });

    expect(compile({a: 1, b: 2, d: null})).toEqual({
        string: "a = :v1 and b = :v2 and d = :v3",
        variables: {
            ":v1": 1,
            ":v2": 2,
            ":v3": null,
        },
    });

    expect(() => compile({c: undefined})).toThrow(
        "Assertion failure: Condition object must be non-empty",
    );
    expect(() => compile({e: undefined})).toThrow(
        "Assertion failure: Condition object must be non-empty",
    );
});

test("compiles equals expression", () => {
    expect(compile({a: DynamoConditionExpression.eq(1)})).toEqual({
        string: "a = :v1",
        variables: {":v1": 1},
    });
    expect(compile({b: DynamoConditionExpression.eq(2)})).toEqual({
        string: "b = :v1",
        variables: {":v1": 2},
    });
    expect(compile({b: DynamoConditionExpression.eq(null)})).toEqual({
        string: "b = :v1",
        variables: {":v1": null},
    });
    expect(compile({c: DynamoConditionExpression.eq(3)})).toEqual({
        string: "c = :v1",
        variables: {":v1": 3},
    });
    expect(compile({c: DynamoConditionExpression.eq(3)})).toEqual({
        string: "c = :v1",
        variables: {":v1": 3},
    });
    expect(compile({d: DynamoConditionExpression.eq(4)})).toEqual({
        string: "d = :v1",
        variables: {":v1": 4},
    });
    expect(compile({d: DynamoConditionExpression.eq(null)})).toEqual({
        string: "d = :v1",
        variables: {":v1": null},
    });
    expect(compile({e: DynamoConditionExpression.eq(1)})).toEqual({
        string: "attribute_not_exists(e) and :v2 = :v1 or attribute_exists(e) and e = :v1",
        variables: {":v1": 1, ":v2": 0},
    });

    expect(
        compile({
            a: DynamoConditionExpression.eq(1),
            b: DynamoConditionExpression.eq(2),
            d: DynamoConditionExpression.eq(null),
        }),
    ).toEqual({
        string: "a = :v1 and b = :v2 and d = :v3",
        variables: {
            ":v1": 1,
            ":v2": 2,
            ":v3": null,
        },
    });

    expect(() =>
        compile({
            // @ts-expect-error: For optional properties you need to use
            // `DynamoConditionExpression.exists().not()`.
            c: DynamoConditionExpression.eq(undefined),
        }),
    ).toThrow("Expected integer");
    expect(() =>
        compile({
            // @ts-expect-error: For optional properties you need to use
            // `DynamoConditionExpression.exists().not()`.
            e: DynamoConditionExpression.eq(undefined),
        }),
    ).toThrow("Expected integer");
});

test("compiles not equals expressions", () => {
    expect(compile({a: DynamoConditionExpression.neq(42)})).toEqual({
        string: "a <> :v1",
        variables: {":v1": 42},
    });
    expect(compile({e: DynamoConditionExpression.neq(42)})).toEqual({
        string: "attribute_not_exists(e) and :v2 <> :v1 or attribute_exists(e) and e <> :v1",
        variables: {":v1": 42, ":v2": 0},
    });
});

test("compiles less than expressions", () => {
    expect(compile({a: DynamoConditionExpression.lt(42)})).toEqual({
        string: "a < :v1",
        variables: {":v1": 42},
    });
    expect(compile({e: DynamoConditionExpression.lt(42)})).toEqual({
        string: "attribute_not_exists(e) and :v2 < :v1 or attribute_exists(e) and e < :v1",
        variables: {":v1": 42, ":v2": 0},
    });
});

test("compiles greater than expressions", () => {
    expect(compile({a: DynamoConditionExpression.gt(42)})).toEqual({
        string: "a > :v1",
        variables: {":v1": 42},
    });
    expect(compile({e: DynamoConditionExpression.gt(42)})).toEqual({
        string: "attribute_not_exists(e) and :v2 > :v1 or attribute_exists(e) and e > :v1",
        variables: {":v1": 42, ":v2": 0},
    });
});

test("compiles less than or equals expressions", () => {
    expect(compile({a: DynamoConditionExpression.lte(42)})).toEqual({
        string: "a <= :v1",
        variables: {":v1": 42},
    });
    expect(compile({e: DynamoConditionExpression.lte(42)})).toEqual({
        string: "attribute_not_exists(e) and :v2 <= :v1 or attribute_exists(e) and e <= :v1",
        variables: {":v1": 42, ":v2": 0},
    });
});

test("compiles greater than or equals expressions", () => {
    expect(compile({a: DynamoConditionExpression.gte(42)})).toEqual({
        string: "a >= :v1",
        variables: {":v1": 42},
    });
    expect(compile({e: DynamoConditionExpression.gte(42)})).toEqual({
        string: "attribute_not_exists(e) and :v2 >= :v1 or attribute_exists(e) and e >= :v1",
        variables: {":v1": 42, ":v2": 0},
    });
});

test("compiles between expressions", () => {
    expect(compile({a: DynamoConditionExpression.between(5, 10)})).toEqual({
        string: "a between :v1 and :v2",
        variables: {":v1": 5, ":v2": 10},
    });
    expect(compile({e: DynamoConditionExpression.between(5, 10)})).toEqual({
        string: "attribute_not_exists(e) and :v3 between :v1 and :v2 or attribute_exists(e) and e between :v1 and :v2",
        variables: {":v1": 5, ":v2": 10, ":v3": 0},
    });
});

test("compiles in expressions", () => {
    expect(compile({a: DynamoConditionExpression.in([1])})).toEqual({
        string: "a in (:v1)",
        variables: {":v1": 1},
    });
    expect(compile({a: DynamoConditionExpression.in([1, 2, 3])})).toEqual({
        string: "a in (:v1, :v2, :v3)",
        variables: {":v1": 1, ":v2": 2, ":v3": 3},
    });
    expect(compile({e: DynamoConditionExpression.in([1, 2, 3])})).toEqual({
        string: "attribute_not_exists(e) and :v4 in (:v1, :v2, :v3) or attribute_exists(e) and e in (:v1, :v2, :v3)",
        variables: {":v1": 1, ":v2": 2, ":v3": 3, ":v4": 0},
    });
});

test("compiles exists expressions", () => {
    expect(
        compile({
            // @ts-expect-error: Attribute is required
            a: DynamoConditionExpression.exists(),
        }),
    ).toEqual({
        string: "attribute_exists(a)",
        variables: {},
    });
    expect(
        compile({
            // @ts-expect-error: Attribute is required
            b: DynamoConditionExpression.exists(),
        }),
    ).toEqual({
        string: "attribute_exists(b)",
        variables: {},
    });
    expect(compile({c: DynamoConditionExpression.exists()})).toEqual({
        string: "attribute_exists(c)",
        variables: {},
    });
    expect(compile({d: DynamoConditionExpression.exists()})).toEqual({
        string: "attribute_exists(d)",
        variables: {},
    });
    expect(compile({c: DynamoConditionExpression.exists().not()})).toEqual({
        string: "not attribute_exists(c)",
        variables: {},
    });
    expect(compile({d: DynamoConditionExpression.exists().not()})).toEqual({
        string: "not attribute_exists(d)",
        variables: {},
    });
    expect(
        compile({
            // @ts-expect-error: Attribute is required
            e: DynamoConditionExpression.exists(),
        }),
    ).toEqual({
        string: "attribute_exists(e)",
        variables: {},
    });
});

test("compiles to serialized schema keys", () => {
    expect(compile({f: 42})).toEqual({
        string: "x = :v1",
        variables: {":v1": 42},
    });
    expect(compile({f: DynamoConditionExpression.neq(42)})).toEqual({
        string: "x <> :v1",
        variables: {":v1": 42},
    });
});

test("compiles two “and”ed expressions", () => {
    expect(
        compile({a: DynamoConditionExpression.lte(5).and(DynamoConditionExpression.gte(10))}),
    ).toEqual({
        string: "a <= :v1 and a >= :v2",
        variables: {":v1": 5, ":v2": 10},
    });
});

test("compiles two “or”ed expressions", () => {
    expect(
        compile({a: DynamoConditionExpression.lte(5).or(DynamoConditionExpression.gte(10))}),
    ).toEqual({
        string: "a <= :v1 or a >= :v2",
        variables: {":v1": 5, ":v2": 10},
    });
});

test("compiles two “or”ed expressions and another expression", () => {
    expect(
        compile({a: DynamoConditionExpression.lte(5).or(DynamoConditionExpression.gte(10)), b: 42}),
    ).toEqual({
        string: "(a <= :v1 or a >= :v2) and b = :v3",
        variables: {":v1": 5, ":v2": 10, ":v3": 42},
    });
});

test("compiles an expression with a default with another expression", () => {
    expect(
        compile({e: DynamoConditionExpression.lte(5).and(DynamoConditionExpression.gte(10))}),
    ).toEqual({
        string: "(attribute_not_exists(e) and :v2 <= :v1 or attribute_exists(e) and e <= :v1) and (attribute_not_exists(e) and :v2 >= :v3 or attribute_exists(e) and e >= :v3)",
        variables: {":v1": 5, ":v2": 0, ":v3": 10},
    });
});

test("compiles with object nesting", () => {
    expect(compile({o: DynamoConditionExpression.object({a: 42})})).toEqual({
        string: "o.a = :v1",
        variables: {":v1": 42},
    });
    expect(compile({o: DynamoConditionExpression.object({e: 42})})).toEqual({
        string: "attribute_not_exists(o.e) and :v2 = :v1 or attribute_exists(o.e) and o.e = :v1",
        variables: {":v1": 42, ":v2": 0},
    });
    expect(compile({o: DynamoConditionExpression.object({f: 42})})).toEqual({
        string: "o.x = :v1",
        variables: {":v1": 42},
    });

    expect(
        compile({
            o: DynamoConditionExpression.object({o: DynamoConditionExpression.object({a: 42})}),
        }),
    ).toEqual({string: "o.o.a = :v1", variables: {":v1": 42}});
    expect(
        compile({
            o: DynamoConditionExpression.object({o: DynamoConditionExpression.object({e: 42})}),
        }),
    ).toEqual({
        string: "attribute_not_exists(o.o.e) and :v2 = :v1 or attribute_exists(o.o.e) and o.o.e = :v1",
        variables: {":v1": 42, ":v2": 0},
    });
    expect(
        compile({
            o: DynamoConditionExpression.object({o: DynamoConditionExpression.object({f: 42})}),
        }),
    ).toEqual({string: "o.o.x = :v1", variables: {":v1": 42}});

    expect(compile({a: 42, o: DynamoConditionExpression.object({a: 42})})).toEqual({
        string: "a = :v1 and o.a = :v1",
        variables: {":v1": 42},
    });
    expect(compile({a: 42, o: DynamoConditionExpression.object({e: 42})})).toEqual({
        string: "a = :v1 and (attribute_not_exists(o.e) and :v2 = :v1 or attribute_exists(o.e) and o.e = :v1)",
        variables: {":v1": 42, ":v2": 0},
    });
    expect(compile({a: 42, o: DynamoConditionExpression.object({f: 42})})).toEqual({
        string: "a = :v1 and o.x = :v1",
        variables: {":v1": 42},
    });
});

test("compiles raw expressions with parentheses by default", () => {
    expect(compile(DynamoConditionExpression._unsafeRaw("test"))).toEqual({
        string: "test",
        variables: {},
    });
    expect(compile({a: DynamoConditionExpression._unsafeRaw("test")})).toEqual({
        string: "test",
        variables: {},
    });
    expect(
        compile(
            DynamoConditionExpression._unsafeRaw("test").or(
                DynamoConditionExpression.object({a: DynamoConditionExpression.eq(1)}),
            ),
        ),
    ).toEqual({
        string: "(test) or a = :v1",
        variables: {":v1": 1},
    });
    expect(
        compile(
            DynamoConditionExpression._unsafeRaw("test").and(
                DynamoConditionExpression.object({a: DynamoConditionExpression.eq(1)}),
            ),
        ),
    ).toEqual({
        string: "(test) and a = :v1",
        variables: {":v1": 1},
    });
});
