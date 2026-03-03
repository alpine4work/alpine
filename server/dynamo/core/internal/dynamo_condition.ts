import {dynamoReservedWords} from "~/server/dynamo/core/internal/dynamo_reserved_words.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {NonUndefined} from "~/shared/helpers/types/non_undefined.js";
import {
    ObjectSchema,
    SchemaDeserializationError,
    SchemaSerializedValue,
    SchemaWithOnlySerialization,
    objectSchemaMissingPropertySymbol,
} from "~/shared/schema/schema.js";

/**
 * An abstract, type-safe, representation of a [DynamoDB condition expression][1]
 * in a convenient to define format.
 *
 * Convert into a `DynamoConditionExpression` with
 * `DynamoConditionExpression.from()` to compile to a string.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html
 */
export type DynamoCondition<Item extends {[key: string]: any}> =
    | DynamoConditionObject<Item>
    | DynamoConditionExpression<Item>;

export type DynamoConditionObject<Item extends {[key: string]: any}> = {
    [Key in keyof Item]?: Item[Key] | DynamoConditionExpression<Item[Key]>;
};

/**
 * An abstract, type-safe, representation of a [DynamoDB condition expression][1].
 *
 * Conditions assume the underlying item exists. If the underlying item does not
 * exist then the condition may not work as expected. We try to add an
 * `attribute_exists(partitionKey) and ...` before any compiled condition to make
 * sure the item exists.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html
 */
export abstract class DynamoConditionExpression<Value> {
    /**
     * Converts a condition into an expression.
     */
    public static from<Value extends {[key: string]: any}>(
        condition: DynamoCondition<Value>,
    ): DynamoConditionExpression<Value> {
        if (condition instanceof DynamoConditionExpression) return condition;
        return DynamoConditionExpression.object(condition);
    }

    /**
     * Constructs a condition against an object. Each property condition is "and"ed
     * together. If the value is not a condition expression then that's the same as
     * `DynamoConditionExpression.eq()`.
     */
    public static object<Value extends {[key: string]: any}>(
        condition: DynamoConditionObject<Value>,
    ): DynamoConditionExpression<Value> {
        const [firstEntry, ...otherEntries] = Object.entries(condition).filter(
            // Remove conditions where the value was set to undefined.
            ([, value]) => value !== undefined,
        );
        assert(firstEntry, "Condition object must be non-empty");

        let expression: DynamoConditionExpression<Value> = new DynamoConditionAttributeExpression(
            firstEntry[0],
            firstEntry[1] instanceof DynamoConditionExpression
                ? firstEntry[1]
                : DynamoConditionExpression.eq(firstEntry[1]),
        );

        for (const otherEntry of otherEntries) {
            expression = expression.and(
                new DynamoConditionAttributeExpression(
                    otherEntry[0],
                    otherEntry[1] instanceof DynamoConditionExpression
                        ? otherEntry[1]
                        : DynamoConditionExpression.eq(otherEntry[1]),
                ),
            );
        }

        return expression;
    }

    /**
     * Passes if the value is equal to the provided value.
     *
     * For optional properties you need to use
     * `DynamoConditionExpression.exists().not()` and not
     * `DynamoConditionExpression.eq(undefined)`.
     */
    public static eq<Value>(value: NonUndefined<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionEqualsExpression(value);
    }

    /**
     * Passes if the value is not equal to the provided value.
     */
    public static neq<Value>(value: NonUndefined<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionNotEqualsExpression(value);
    }

    /**
     * Passes if the value is greater than the provided value.
     */
    public static gt<Value>(value: NonUndefined<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionGreaterThanExpression(value);
    }

    /**
     * Passes if the value is greater than or equal to the provided value.
     */
    public static gte<Value>(value: NonUndefined<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionGreaterThanOrEqualExpression(value);
    }

    /**
     * Passes if the value is less than the provided value.
     */
    public static lt<Value>(value: NonUndefined<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionLessThanExpression(value);
    }

    /**
     * Passes if the value is less than or equal to the provided value.
     */
    public static lte<Value>(value: NonUndefined<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionLessThanOrEqualExpression(value);
    }

    /**
     * Passes if the value is between the first and second value or equal to the first
     * or second value.
     */
    public static between<Value>(
        value1: NonUndefined<Value>,
        value2: NonUndefined<Value>,
    ): DynamoConditionExpression<Value> {
        return new DynamoConditionBetweenExpression(value1, value2);
    }

    /**
     * Passes if the value is equal to one of the values in the provided set. The set
     * of values must be non-empty.
     */
    public static in<Value>(
        values: ReadonlyArray<NonUndefined<Value>>,
    ): DynamoConditionExpression<Value> {
        return new DynamoConditionInExpression(values);
    }

    /**
     * Passes if the attribute exists.
     *
     * This is different from `DynamoConditionExpression.eq(null)` which checks if the
     * attribute value is null. In JavaScript, a property that doesn't exist is
     * represented by `undefined`.
     */
    public static exists<Value extends undefined>(): DynamoConditionExpression<Value> {
        return new DynamoConditionAttributeExistsExpression();
    }

    /**
     * True if both expressions are true.
     */
    public and(
        otherExpression: DynamoConditionExpression<Value>,
    ): DynamoConditionExpression<Value> {
        return new DynamoConditionAndExpression(this, otherExpression);
    }

    /**
     * True if either expression is true.
     */
    public or(otherExpression: DynamoConditionExpression<Value>): DynamoConditionExpression<Value> {
        return new DynamoConditionOrExpression(this, otherExpression);
    }

    /**
     * True if the underlying condition is false and false if the underlying condition
     * is true.
     */
    public not(): DynamoConditionExpression<Value> {
        return new DynamoConditionNotExpression(this);
    }

    /**
     * Unsafely create a condition expression directly from a string if you don't want
     * to deal with the type-safe intermediate layer.
     *
     * Only use this as a last resort when the condition you want is not expressible in
     * the type system.
     *
     * May optionally provide a `precedence` to avoid unnecessary parentheses.
     *
     * You can break the meaning of an expression pretty spectacularly by misusing this
     * combinator. For instance adding extra parentheses where they are not supposed to
     * go. The name is prefixed with `_unsafe` to discourage use for this reason.
     */
    public static _unsafeRaw(
        string: string,
        precedence: DynamoConditionExpressionPrecedence = DynamoConditionExpressionPrecedence.Top,
    ): DynamoConditionExpression<unknown> {
        return new DynamoConditionUnsafeRawExpression(precedence, string);
    }

    /**
     * Compile our condition expression into a string. Driven by the underlying schema
     * to serialize values.
     *
     * Returns the precedence of the compiled string in case you need to compose
     * expressions.
     */
    public abstract compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ): {
        precedence: DynamoConditionExpressionPrecedence;
        string: string;
    };
}

/**
 * Precedence levels for a DynamoDB condition expression. See the [precedence in
 * conditions][1] section.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html
 */
export enum DynamoConditionExpressionPrecedence {
    Comparator = 1,
    In = 2,
    Between = 3,
    Function = 4,
    Not = 5,
    And = 6,
    Or = 7,
    // The highest level of precedence which doesn't correspond to any actual
    // expressions. Used when you want to force parentheses around an expression in all
    // cases.
    Top = 8,
}

type DynamoConditionExpressionCompilationDefault =
    | {readonly hasDefault: false}
    | {readonly hasDefault: true; readonly value: SchemaSerializedValue};

/**
 * An object that maintains some state during condition compilation.
 */
export class DynamoConditionExpressionCompilationContext {
    private constructor(
        private readonly _attributeKeyPath: ReadonlyArray<string>,
        private readonly _attributeDefault: DynamoConditionExpressionCompilationDefault,
        private readonly _variableNameByValue: Map<SchemaSerializedValue, string>,
        private readonly _attributeNameByKey: Map<string, string>,
    ) {}

    public static new() {
        return new DynamoConditionExpressionCompilationContext(
            [],
            {hasDefault: false},
            new Map(),
            new Map(),
        );
    }

    /**
     * Create a new context object with the provided key appended to the path.
     *
     * Variables will be be shared with the context this was created from.
     */
    public appendAttributeKeyPath(
        key: string,
        defaultValue: DynamoConditionExpressionCompilationDefault,
    ) {
        return new DynamoConditionExpressionCompilationContext(
            [...this._attributeKeyPath, key],
            defaultValue,
            this._variableNameByValue,
            this._attributeNameByKey,
        );
    }

    /**
     * Get the string pointing to the attribute we are comparing against. Referencing
     * this attribute will ignore the fact that our schema may have a default value.
     * Prefer `compileAttributeCheck()` when possible to support defaults.
     *
     * Will throw if this is the root compilation context since we can't compare
     * against the root document.
     */
    public getAttributeIgnoringDefault(): string {
        assert(
            this._attributeKeyPath.length > 0,
            "Can not create a condition against a top-level document",
        );
        return this._attributeKeyPath.map(key => this.referenceAttribute(key)).join(".");
    }

    /**
     * Reference an attribute in a DynamoDB condition string.
     *
     * We need to escape the name if it is not an identifier or it is a reserved word.
     */
    public referenceAttribute(key: string): string {
        if (isIdentifier(key) && !dynamoReservedWords.has(key.toUpperCase())) return key;

        return getOrSetDefaultMapValue(
            this._attributeNameByKey,
            key,
            () => `#n${this._attributeNameByKey.size + 1}`,
        );
    }

    /**
     * Get a map of expression attribute name aliases in this context.
     */
    public iterateAttributeNames(): Iterable<[string, string]> {
        return mapIterable(this._attributeNameByKey, ([key, aliasedName]) => [aliasedName, key]);
    }

    /**
     * Compiles a check against an attribute. We ask for a function input because we
     * may actually compile two checks. One against the actual attribute (when it
     * exists) and one against the default value (if the attribute doesn't exist).
     */
    public compileAttributeCheck(
        compile: (attributeString: string) => {
            precedence: DynamoConditionExpressionPrecedence;
            string: string;
        },
    ): {
        precedence: DynamoConditionExpressionPrecedence;
        string: string;
    } {
        const attributeString = this.getAttributeIgnoringDefault();

        if (!this._attributeDefault.hasDefault) return compile(attributeString);

        const check1String = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.And,
            compile(this.addVariable(this._attributeDefault.value)),
        );
        const check2String = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.And,
            compile(attributeString),
        );

        return {
            precedence: DynamoConditionExpressionPrecedence.Or,
            string: `attribute_not_exists(${attributeString}) and ${check1String} or attribute_exists(${attributeString}) and ${check2String}`,
        };
    }

    /**
     * To insert a value into a condition expression we need a variable reference. This
     * function creates a fresh variable identifier and stores an assignment to that
     * variable.
     */
    public addVariable(value: SchemaSerializedValue): string {
        return getOrSetDefaultMapValue(
            this._variableNameByValue,
            value,
            () => `:v${this._variableNameByValue.size + 1}`,
        );
    }

    /**
     * Get a map of all variables assignments in this context.
     */
    public iterateVariables(): Iterable<[string, SchemaSerializedValue]> {
        return mapIterable(this._variableNameByValue, ([value, name]) => [name, value]);
    }
}

class DynamoConditionAttributeExpression<
    ObjectValue extends {[_Key in Key]: Value},
    Key extends string,
    Value,
> extends DynamoConditionExpression<ObjectValue> {
    private readonly _key: Key;
    private readonly _valueExpression: DynamoConditionExpression<Value>;

    constructor(key: Key, valueExpression: DynamoConditionExpression<Value>) {
        super();
        this._key = key;
        this._valueExpression = valueExpression;
    }

    public compile(
        schema: SchemaWithOnlySerialization<ObjectValue>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        assert(schema instanceof ObjectSchema, "Expected a schema created by `Schema.object()`");

        const propertySchema = schema.propertySchemaByKey.get(this._key);
        if (!propertySchema)
            throw new InternalError(
                quote`Property ${this._key} not found. Is this a partition key or sort range key property? We don\u2019t currently support conditions on those properties`,
            );

        const serializedKey = propertySchema.serializedKey ?? this._key;

        // Attempt to get the default value for a property by sniffing the schema. If the
        // schema has a default value, then we want our conditions to run against the
        // default value when the attribute doesn't exist.
        let defaultValue: DynamoConditionExpressionCompilationDefault;
        try {
            const value = propertySchema.deserializeProperty({}, serializedKey, this._key);
            if (value === objectSchemaMissingPropertySymbol) {
                defaultValue = {hasDefault: false};
            } else {
                defaultValue = {
                    hasDefault: true,
                    value: propertySchema.valueSchema.serialize(value),
                };
            }
        } catch (error) {
            if (!(error instanceof SchemaDeserializationError)) throw error;
            defaultValue = {hasDefault: false};
        }

        return this._valueExpression.compile(
            propertySchema.valueSchema as any,
            context.appendAttributeKeyPath(serializedKey, defaultValue),
        );
    }
}

class DynamoConditionEqualsExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueString = context.addVariable(schema.serialize(this._value));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Comparator,
            string: `${attributeString} = ${valueString}`,
        }));
    }
}

class DynamoConditionNotEqualsExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueString = context.addVariable(schema.serialize(this._value));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Comparator,
            string: `${attributeString} <> ${valueString}`,
        }));
    }
}

class DynamoConditionGreaterThanExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueString = context.addVariable(schema.serialize(this._value));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Comparator,
            string: `${attributeString} > ${valueString}`,
        }));
    }
}

class DynamoConditionGreaterThanOrEqualExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueString = context.addVariable(schema.serialize(this._value));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Comparator,
            string: `${attributeString} >= ${valueString}`,
        }));
    }
}

class DynamoConditionLessThanExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueString = context.addVariable(schema.serialize(this._value));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Comparator,
            string: `${attributeString} < ${valueString}`,
        }));
    }
}

class DynamoConditionLessThanOrEqualExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueString = context.addVariable(schema.serialize(this._value));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Comparator,
            string: `${attributeString} <= ${valueString}`,
        }));
    }
}

class DynamoConditionBetweenExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _value1: Value;
    private readonly _value2: Value;

    constructor(value1: Value, value2: Value) {
        super();
        this._value1 = value1;
        this._value2 = value2;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const value1String = context.addVariable(schema.serialize(this._value1));
        const value2String = context.addVariable(schema.serialize(this._value2));

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.Between,
            string: `${attributeString} between ${value1String} and ${value2String}`,
        }));
    }
}

class DynamoConditionInExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _values: ReadonlyArray<Value>;

    constructor(values: ReadonlyArray<Value>) {
        assert(values.length > 0);
        super();
        this._values = values;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const valueStrings = this._values.map(value =>
            context.addVariable(schema.serialize(value)),
        );

        return context.compileAttributeCheck(attributeString => ({
            precedence: DynamoConditionExpressionPrecedence.In,
            string: `${attributeString} in (${valueStrings.join(", ")})`,
        }));
    }
}

class DynamoConditionAttributeExistsExpression<Value> extends DynamoConditionExpression<Value> {
    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        return {
            precedence: DynamoConditionExpressionPrecedence.Function,
            string: `attribute_exists(${context.getAttributeIgnoringDefault()})`,
        };
    }
}

class DynamoConditionAndExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _expression1: DynamoConditionExpression<Value>;
    private readonly _expression2: DynamoConditionExpression<Value>;

    constructor(
        expression1: DynamoConditionExpression<Value>,
        expression2: DynamoConditionExpression<Value>,
    ) {
        super();
        this._expression1 = expression1;
        this._expression2 = expression2;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const expression1String = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.And,
            this._expression1.compile(schema, context),
        );
        const expression2String = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.And,
            this._expression2.compile(schema, context),
        );
        return {
            precedence: DynamoConditionExpressionPrecedence.And,
            string: `${expression1String} and ${expression2String}`,
        };
    }
}

class DynamoConditionOrExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _expression1: DynamoConditionExpression<Value>;
    private readonly _expression2: DynamoConditionExpression<Value>;

    constructor(
        expression1: DynamoConditionExpression<Value>,
        expression2: DynamoConditionExpression<Value>,
    ) {
        super();
        this._expression1 = expression1;
        this._expression2 = expression2;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const expression1String = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.Or,
            this._expression1.compile(schema, context),
        );
        const expression2String = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.Or,
            this._expression2.compile(schema, context),
        );
        return {
            precedence: DynamoConditionExpressionPrecedence.Or,
            string: `${expression1String} or ${expression2String}`,
        };
    }
}

class DynamoConditionNotExpression<Value> extends DynamoConditionExpression<Value> {
    private readonly _expression: DynamoConditionExpression<Value>;

    constructor(expression: DynamoConditionExpression<Value>) {
        super();
        this._expression = expression;
    }

    public compile(
        schema: SchemaWithOnlySerialization<Value>,
        context: DynamoConditionExpressionCompilationContext,
    ) {
        const expressionString = wrapIfPrecedenceHigherThan(
            DynamoConditionExpressionPrecedence.Not,
            this._expression.compile(schema, context),
        );
        return {
            precedence: DynamoConditionExpressionPrecedence.Or,
            string: `not ${expressionString}`,
        };
    }
}

function wrapIfPrecedenceHigherThan(
    precedence: DynamoConditionExpressionPrecedence,
    compilationResult: {precedence: DynamoConditionExpressionPrecedence; string: string},
): string {
    if (compilationResult.precedence > precedence) return `(${compilationResult.string})`;
    return compilationResult.string;
}

class DynamoConditionUnsafeRawExpression extends DynamoConditionExpression<unknown> {
    private readonly _precedence: DynamoConditionExpressionPrecedence;
    private readonly _string: string;

    constructor(precedence: DynamoConditionExpressionPrecedence, string: string) {
        super();
        this._precedence = precedence;
        this._string = string;
    }

    public compile() {
        return {
            precedence: this._precedence,
            string: this._string,
        };
    }
}
