import {base64ToBytes, bytesToBase64} from "byte-base64";
import {formatISO, isValid as isValidDate, parseISO} from "date-fns";
import {InternalError, InvalidArgumentError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {Optionalize} from "~/shared/helpers/types/optionalize";
import {Id, isId} from "~/shared/id/id";
import {
    SchemaSerializedObjectValuePropertyDescription,
    SchemaSerializedValueDescription,
} from "~/shared/schema/types/schema_description_types";

/**
 * Get the underlying type of a schema object.
 */
export type SchemaType<
    T extends Schema<any> | ObjectPropertySchema<any, any> | UnionSchemaVariant<any>,
> = T extends Schema<infer U>
    ? U
    : T extends ObjectPropertySchema<infer U, any>
    ? U
    : T extends UnionSchemaVariant<infer U>
    ? U
    : never;

/**
 * A serialized value we can send across process boundaries.
 *
 * The same as a JSON value but with support for `Uint8Array`s. [DynamoDB
 * supports binary fields][1] (which we use for data storage) and [Ably also
 * supports binary fields][2] through MessagePack (which we use for realtime).
 *
 * Notably, we only allow `undefined` as an object property. Not as a general
 * scalar value. Just like JSON.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html#HowItWorks.DataTypes
 * [2]: https://faqs.ably.com/do-you-binary-encode-your-messages-for-greater-efficiency
 */
export type SchemaSerializedValue =
    | SchemaSerializedScalarValue
    | SchemaSerializedObjectValue
    | SchemaSerializedArrayValue;

/**
 * A serialized value which doesn't contain other values.
 */
export type SchemaSerializedScalarValue =
    | null
    | boolean
    | number
    | string
    | JsonStringifiableUint8Array;

/**
 * A serialized object value.
 */
export type SchemaSerializedObjectValue = {
    readonly [key: string]: SchemaSerializedValue | undefined;
};

/**
 * A serialized array value.
 */
export type SchemaSerializedArrayValue = ReadonlyArray<SchemaSerializedValue>;

/**
 * `Schema` but you can only serialize.
 *
 * Useful if you want to be [contravariant][1] on `Value`.
 *
 * [1]: https://en.wikipedia.org/wiki/Covariance_and_contravariance_(computer_science)
 */
export interface SchemaWithOnlySerialization<Value> {
    readonly description: SchemaSerializedValueDescription;
    serialize(value: Value): SchemaSerializedValue;
}

/**
 * `Schema` but you can only deserialize.
 *
 * Useful if you want to be [covariant][1] on `Value`.
 *
 * [1]: https://en.wikipedia.org/wiki/Covariance_and_contravariance_(computer_science)
 */
export interface SchemaWithOnlyDeserialization<Value> {
    readonly description: SchemaSerializedValueDescription;
    deserialize(serializedValue: SchemaSerializedValue): Value;
}

/**
 * The schema class is a type-safe combinator-style utility for validating and
 * migrating unknown JavaScript values. You may use it for reading values from
 * a dynamic JSON data store, messages from an untyped event stream, or for
 * validating client input.
 *
 * It is designed to support changing data formats over time. For example,
 * objects will silently discard unknown properties from a new application
 * version.
 */
export class Schema<Value> implements SchemaWithOnlySerialization<Value> {
    /**
     * The description of the serialized value returned by this schema.
     */
    public readonly description: SchemaSerializedValueDescription;

    /**
     * Serializes a value into a format we can send across process boundaries.
     *
     * Does not mutate the underlying value during serialization.
     */
    public readonly serialize: (value: Value) => SchemaSerializedValue;

    /**
     * Deserializes a value we received from a process boundary. If the value does
     * not match our schema then we throw an error.
     *
     * Does not mutate the underlying value during deserialization.
     */
    public readonly deserialize: (serializedValue: SchemaSerializedValue) => Value;

    /**
     * Validates that the provided value matches any constraints in the schema
     * beyond the TypeScript type. Throws an error if it doesn't. Valid values
     * can be serialized without throwing an error and will deserialize to
     * exactly the same value you serialized.
     *
     * Validation also doesn't recurse over the entire value. Only the parts of
     * the value which need validation. If nothing needs validation this
     * property will be null.
     *
     * Some examples:
     *
     * - The TypeScript type of both `Schema.float` and `Schema.integer` is
     *   `number`. We don't need to validate `Schema.float` because all
     *   TypeScript `number`s match this schema. We do need to validate
     *   `Schema.integer` since not all `number`s are `integer`s.
     *
     * - `Schema.string.trim()` will remove whitespace from a string while
     *   serializing. However, validation will fail if there is whitespace at
     *   the beginning or end of the string. Since that means
     *   `deserialize(serialize(value))` won't return exactly the same value.
     *
     * - Validating `Schema.array(Schema.float)` is a noop since we know
     *   recursively nothing needs validation. However, validating
     *   `Schema.array(Schema.integer)` will visit every item in the array.
     */
    public readonly validate: ((value: Value) => void) | null;

    // NOTE(calebmer): Some ideas on serialization/deserialization performance.
    // Two performance problems:
    //
    // 1. There's a lot of abstraction. To serialize an object you step through
    //    a pretty deep, recursive, function stack. We may bypass a lot of
    //    JavaScript engine optimizations around [hidden classes][1] through
    //    dynamic property access like `o[p]` instead of `o.p`.
    // 2. The serialization format is pretty general. What if instead we had
    //    multiple specialized serialization formats? (Like [serde][2] in Rust.)
    //    For example, we need another serialization pass for DynamoDB to convert
    //    into its value format. We also need a serialization pass to convert into
    //    MessagePack (for Ably) or JSON.
    //
    // We could solve both problems with codegen! Instead of the functional
    // programming style where we build up serialize and deserialize functions, we
    // generate hyper optimized non-recursive functions for different target
    // formats. We generate a function for DynamoDB, for MessagePack, and for JSON
    // (both direct string serialization but also object serialization).
    //
    // I suspect since we do serialization and deserialization SO MUCH that
    // investing in optimizing those code paths will prove to be a meaningful
    // performance win.
    //
    // [1]: https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html
    // [2]: https://serde.rs

    protected constructor({
        description,
        serialize,
        deserialize,
        validate,
    }: {
        description: SchemaSerializedValueDescription;
        serialize: (value: Value) => SchemaSerializedValue;
        deserialize: (serializedValue: SchemaSerializedValue) => Value;
        validate: ((value: Value) => void) | null;
    }) {
        this.description = description;
        this.serialize = serialize;
        this.deserialize = deserialize;
        this.validate = validate;
    }

    /**
     * Accept any value.
     *
     * An escape hatch if your type is complicated and you'd like to manage it
     * yourself.
     */
    public static unknown = new Schema<SchemaSerializedValue>({
        description: {type: "Unknown"},
        serialize: value => value,
        deserialize: value => value,
        validate: null,
    });

    /**
     * Accept a boolean value.
     */
    public static boolean = new Schema<boolean>({
        description: {type: "Boolean"},
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "boolean")
                throw new SchemaDeserializationError("Expected boolean");
            return value;
        },
        validate: null,
    });

    /**
     * Accept any number value.
     *
     * A JavaScript number is a [IEEE 754 floating point][1] number.
     *
     * [1]: https://en.wikipedia.org/wiki/IEEE_754
     */
    public static float = new Schema<number>({
        description: {type: "Float"},
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "number") throw new SchemaDeserializationError("Expected number");
            return value;
        },
        validate: null,
    });

    /**
     * Accept any integer value.
     *
     * An integer is a JavaScript number that passes [`Number.isSafeInteger`][1].
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger
     */
    public static integer: IntegerSchema;

    /**
     * Accept any string value.
     */
    public static string: StringSchema;

    /**
     * Accept any `Id` value.
     */
    public static id = new Schema<Id>({
        description: {type: "Id"},
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "string") throw new SchemaDeserializationError("Expected string");
            if (!isId(value)) throw new SchemaDeserializationError("Expected id");
            return value;
        },
        validate: null,
    });

    /**
     * Accept binary data.
     *
     * Serializes to a `Uint8Array` with a special `toJSON()` function that will
     * convert the binary data into a base64 string for serializers that don't have
     * custom support for `Uint8Array`. If we try to deserialize a string, we will
     * treat the string as base64 binary encoded data.
     */
    public static bytes = new Schema<Uint8Array>({
        description: {type: "Bytes"},
        serialize: value => {
            return new JsonStringifiableUint8Array(value);
        },
        deserialize: value => {
            if (value instanceof Uint8Array) return value;

            if (typeof value !== "string")
                throw new SchemaDeserializationError("Expected a `Uint8Array` or base64 string");

            try {
                return base64ToBytes(value);
            } catch {
                throw new SchemaDeserializationError("Unable to parse base64 string");
            }
        },
        validate: null,
    });

    /**
     * Accept a valid `Date` object.
     *
     * Serializes to an [ISO 8601][1] string.
     *
     * [1]: https://en.wikipedia.org/wiki/ISO_8601
     */
    public static date = new Schema<Date>({
        description: {type: "Date"},
        serialize: value => {
            assert(isValidDate(value));
            return formatISO(value);
        },
        deserialize: value => {
            if (typeof value !== "string")
                throw new SchemaDeserializationError("Expected a string");

            const date = parseISO(value);

            if (!isValidDate(date))
                throw new SchemaDeserializationError("Expected an ISO 8601 date string");

            return date;
        },
        validate: null,
    });

    /**
     * Accept null in addition to any underlying value.
     */
    public nullable(): Schema<Value | null> {
        const {validate} = this;

        return new Schema({
            description: {
                type: "Nullable",
                schema: this.description,
            },
            serialize: value => {
                if (value === null) return null;
                return this.serialize(value);
            },
            deserialize: value => {
                if (value === null) return null;
                return this.deserialize(value);
            },
            validate: validate
                ? value => {
                      if (value !== null) {
                          validate(value);
                      }
                  }
                : null,
        });
    }

    /**
     * Accept only values exactly equal to the provided value.
     */
    public static value<Value extends number | boolean | string>(value: Value): ValueSchema<Value> {
        return ValueSchema._new(value);
    }

    /**
     * Accept only values included in the enum array/object.
     */
    public static enum<Value extends string | number>(
        values: ReadonlyArray<Value> | Readonly<Record<string, Value>>,
    ): Schema<Value> {
        let valueSet: ReadonlySet<Value>;
        if (Array.isArray(values)) {
            valueSet = new Set(values);
        } else {
            valueSet = new Set(Object.values(values));
        }

        return Schema.unknown.transform({
            serialize: (value: Value): SchemaSerializedValue => value,
            deserialize: (value): Value => {
                if (valueSet.has(value as Value)) {
                    return value as Value;
                }
                throw new SchemaDeserializationError(
                    `Expected one of ${Array.from(valueSet, v => JSON.stringify(v)).join(", ")}`,
                );
            },
        });
    }

    /**
     * Allows an object property to be optionally provided.
     *
     * Same as specifying `{p?: T}` in TypeScript. Only works for object
     * properties.
     */
    public optional() {
        return ObjectPropertySchema.wrap(this).optional();
    }

    /**
     * Provide a default for an optional object property.
     *
     * When deserializing an object, if we don't see this property then we will use
     * the provided default value.
     */
    public default(defaultValue: Value) {
        return ObjectPropertySchema.wrap(this).default(defaultValue);
    }

    /**
     * If you want to rename an object property, use this combinator to provide the
     * old name. We will serialize and deserialize the object with this name
     * instead of the one in the `Schema.object()` definition.
     */
    public originalPropertyKey(originalKey: string) {
        return ObjectPropertySchema.wrap(this).originalPropertyKey(originalKey);
    }

    /**
     * Accept an array where every item matches the schema.
     *
     * Mutates the array in-place when parsing if the item schema changes values.
     */
    public static array<Value>(itemSchema: Schema<Value>): Schema<ReadonlyArray<Value>> {
        const {validate} = itemSchema;

        return new Schema({
            description: {
                type: "Array",
                itemSchema: itemSchema.description,
            },
            serialize: value => value.map(item => itemSchema.serialize(item)),
            deserialize: value => {
                if (!Array.isArray(value))
                    throw new SchemaDeserializationError("Expected an array");

                return value.map((item, index) => {
                    return withSchemaDeserializationStackFrame({type: "ArrayIndex", index}, () => {
                        return itemSchema.deserialize(item);
                    });
                });
            },
            validate: validate
                ? value => {
                      for (const item of value) {
                          validate(item);
                      }
                  }
                : null,
        });
    }

    /**
     * Accept an object where the keys match the corresponding schema.
     *
     * Any extra keys in the object will be discarded. This allows schemas to be
     * compatible with future objects that may add properties. Also for security
     * an attacker can’t sneak in unexpected properties that may change the
     * system's behavior.
     *
     * Only considers the object's own keys. We ignore any properties on the
     * prototype chain.
     *
     * If parsing a plain object we will mutate the object in-place. We will
     * delete any extra unknown keys. If parsing an object with a prototype chain
     * then we will create a new, plain, object.
     */
    public static object<Config extends ObjectSchemaConfigBase>(
        config: Config,
    ): ObjectSchema<ObjectSchemaConfigType<Config>> {
        return ObjectSchema._new(config);
    }

    /**
     * Accept an object where a sentinel `type` string matches an expected type.
     * Allows you to build algebraic data types into your data schema.
     *
     * In academic type theory terms: `Schema.object()` lets you create a product
     * type and `Schema.union()` lets you create a sum type.
     *
     * This is not a union on arbitrary types like in TypeScript, this union is
     * required to be an object with a sentinel `type` property. We force the
     * existence of a `type` property to quickly determine which guard to use for
     * parsing.
     *
     * If we receive an object with an unknown `type` property then we throw. This
     * is one case where we aren't future compatible.
     */
    public static union<Config extends UnionSchemaConfigBase<Config>>(
        config: Config,
    ): UnionSchema<UnionSchemaConfigType<Config>> {
        return UnionSchema._new(config);
    }

    /**
     * A simpler version of `Schema.union()` that supports `Result<T>` objects.
     *
     * The first schema is for `ok: true` and the second schema is for `ok: false`.
     */
    public static result<
        OkSchema extends ObjectSchema<any> & {
            // We need to put our `ok` type constraint on `deserialize` instead of the
            // type parameter so the object type can be covariant instead of invariant.
            deserialize: (value: SchemaSerializedValue) => {ok: true};
        },
        ErrorSchema extends ObjectSchema<any> & {
            // We need to put our `ok` type constraint on `deserialize` instead of the
            // type parameter so the object type can be covariant instead of invariant.
            deserialize: (value: SchemaSerializedValue) => {ok: false};
        },
    >(
        okSchema: OkSchema,
        errorSchema: ErrorSchema,
    ): Schema<SchemaType<OkSchema> | SchemaType<ErrorSchema>> {
        const {validate: validateOk} = okSchema;
        const {validate: validateError} = errorSchema;

        return new Schema<SchemaType<OkSchema> | SchemaType<ErrorSchema>>({
            description: {
                type: "Result",
                okSchema: okSchema.description,
                errorSchema: errorSchema.description,
            },
            serialize: value => {
                if ((value as any).ok) {
                    return okSchema.serialize(value);
                } else {
                    return errorSchema.serialize(value);
                }
            },
            deserialize: value => {
                if (typeof value !== "object" || value === null)
                    throw new SchemaDeserializationError("Expected an object");

                if (!hasOwnProperty(value, "ok") || typeof value.ok !== "boolean")
                    throw new SchemaDeserializationError("Required property `ok` not found");

                if (value.ok) {
                    return withSchemaDeserializationStackFrame(
                        {type: "UnionVariant", typeKey: "ok", typeValue: true},
                        () => okSchema.deserialize(value),
                    );
                } else {
                    return withSchemaDeserializationStackFrame(
                        {type: "UnionVariant", typeKey: "ok", typeValue: false},
                        () => errorSchema.deserialize(value),
                    );
                }
            },
            validate:
                validateOk || validateError
                    ? value => {
                          if ((value as any).ok) {
                              validateOk?.(value);
                          } else {
                              validateError?.(value);
                          }
                      }
                    : null,
        });
    }

    /**
     * Transform a schema's value at runtime into a different format.
     *
     * If you want to serialize a value in a format supported by our `Schema` but
     * manipulate the value at runtime as some custom object, you can use the
     * transform object to add extra serialization and deserialization steps.
     */
    public transform<NewValue>({
        serialize,
        deserialize,
    }: {
        serialize: (value: NewValue) => Value;
        deserialize: (value: Value) => NewValue;
    }): Schema<NewValue> {
        const {validate} = this;

        return new Schema({
            description: this.description,
            serialize: newValue => {
                const value = serialize(newValue);
                return this.serialize(value);
            },
            deserialize: unknownValue => {
                const value = this.deserialize(unknownValue);
                return deserialize(value);
            },
            validate: validate
                ? newValue => {
                      const value = serialize(newValue);
                      validate(value);
                  }
                : null,
        });
    }
}

/**
 * A special `Uint8Array` that when passed into `JSON.stringify()` base64
 * encodes its contents.
 *
 * This is a convenient class for working with an unknown serializer. If the
 * serializer has special support for `Uint8Array` then it will directly encode
 * the binary contents. If the serializer uses `JSON.stringify()` then we get
 * a base64 string.
 */
export class JsonStringifiableUint8Array extends Uint8Array {
    constructor(array: Uint8Array) {
        // Important that we don't copy the array and instead reference the same
        // underlying buffer as the array we are provided.
        super(array.buffer, array.byteOffset, array.length);
    }

    public toJSON(): string {
        return bytesToBase64(this);
    }
}

export type ObjectSchemaConfigBase = {
    [key: string]: Schema<any> | ObjectPropertySchema<any, any>;
};

export type ObjectSchemaConfigType<Config extends ObjectSchemaConfigBase> = Optionalize<{
    readonly [Key in keyof Config]: SchemaType<Config[Key]>;
}>;

/**
 * Schema for an object value.
 *
 * You should only create this with `Schema.object()`.
 */
export class ObjectSchema<Value> extends Schema<Value> {
    /**
     * The schema for every property in our object.
     *
     * Useful for static analysis.
     *
     * Keys must be valid identifiers (according to `isIdentifier()`).
     */
    public readonly propertySchemaByKey: ReadonlyMap<
        string,
        ObjectPropertySchema<unknown, unknown>
    >;

    /**
     * Serialize the value. Will always serialize into an object value.
     */
    public declare readonly serialize: (value: Value) => SchemaSerializedObjectValue;

    /**
     * Serialize by assigning object properties directly to the provided
     * target instead of creating a new object.
     */
    public readonly serializeInto: (
        value: Value,
        target: {[key: string]: SchemaSerializedValue},
    ) => void;

    /**
     * Deserialize by assigning object properties directly to the provided
     * target instead of the source value or creating a new value.
     */
    public readonly deserializeInto: (
        serializedValue: SchemaSerializedValue,
        target?: {[key: string]: SchemaSerializedValue},
    ) => Value;

    private constructor(
        propertySchemaByKey: ReadonlyMap<string, ObjectPropertySchema<unknown, unknown>>,
    ) {
        const description: SchemaSerializedValueDescription = {
            type: "Object",
            propertySchemaByKey: Object.fromEntries(
                Array.from(propertySchemaByKey, ([key, schema]) => [
                    schema.serializedKey ?? key,
                    schema.description,
                ]),
            ),
        };

        const serializeInto = (value: Value, target: {[key: string]: SchemaSerializedValue}) => {
            for (const [key, schema] of propertySchemaByKey) {
                const serializedKey = schema.serializedKey ?? key;
                schema.serializeProperty(target, serializedKey, (value as any)[key]);
            }
        };

        const deserializeInto = (
            value: SchemaSerializedValue,
            target?: {[key: string]: SchemaSerializedValue},
        ) => {
            if (typeof value !== "object" || value === null)
                throw new SchemaDeserializationError("Expected an object");

            const newValue: any = target ?? {};

            for (const [key, schema] of propertySchemaByKey) {
                const serializedKey = schema.serializedKey ?? key;

                const keyValue = schema.deserializeProperty(
                    value as any as SchemaSerializedObjectValue,
                    serializedKey,
                );

                newValue[key] = keyValue;
            }

            return newValue;
        };

        const validatePropertyByKey = new Map<string, (value: unknown) => void>(
            filterMapIterable(propertySchemaByKey, ([key, propertySchema]) => {
                if (propertySchema.validateProperty === null) return null;
                return [key, propertySchema.validateProperty];
            }),
        );

        super({
            description,
            serialize: value => {
                const newValue: {[key: string]: SchemaSerializedValue} = {};
                serializeInto(value, newValue);
                return newValue;
            },
            deserialize: deserializeInto,
            validate:
                validatePropertyByKey.size > 0
                    ? value => {
                          for (const [key, validateProperty] of validatePropertyByKey) {
                              validateProperty((value as any)[key]);
                          }
                      }
                    : null,
        });
        this.propertySchemaByKey = propertySchemaByKey;
        this.serializeInto = serializeInto;
        this.deserializeInto = deserializeInto;
    }

    /**
     * Prefer `Schema.object()` which directly calls this method.
     */
    public static _new<Config extends ObjectSchemaConfigBase>(
        config: Config,
    ): ObjectSchema<ObjectSchemaConfigType<Config>> {
        const propertySchemaByKey = new Map<string, ObjectPropertySchema<unknown, unknown>>(
            Object.entries(config).map(([key, schema]) => {
                assert(isIdentifier(key));
                return [key, schema instanceof Schema ? ObjectPropertySchema.wrap(schema) : schema];
            }),
        );

        return new ObjectSchema<ObjectSchemaConfigType<Config>>(propertySchemaByKey);
    }

    /**
     * Takes two object schemas and creates a new object schema with both of their
     * properties. Keys in both schemas must be unique. Will throw an error if both
     * schemas contain the same key.
     */
    public merge<OtherValue>(
        otherSchema: ObjectSchema<OtherValue>,
    ): ObjectSchema<Value & OtherValue> {
        const propertySchemaByKey = new Map(this.propertySchemaByKey);

        for (const [key, propertySchema] of otherSchema.propertySchemaByKey) {
            if (propertySchemaByKey.has(key))
                throw new InternalError(
                    quote`Can not merge object schemas which both contain key ${key}`,
                );

            propertySchemaByKey.set(key, propertySchema);
        }

        return new ObjectSchema(propertySchemaByKey);
    }

    /**
     * If you want to rename a union variant's type name, use this combinator to
     * provide the old name. We will serialize and deserialize the object with this
     * name instead of the one in the `Schema.union()` definition.
     */
    public originalUnionType<Value extends {readonly type: string}>(
        this: ObjectSchema<Value>,
        serializedType: string,
    ): UnionSchemaVariant<Value> {
        return new UnionSchemaVariant({schema: this, serializedType});
    }
}

export class ObjectPropertySchema<Value, SchemaValue extends Value> {
    /**
     * The key this property is written to in the serialized object. If null then
     * we use the key provided in the object schema definition.
     *
     * Must be a valid identifier (according to `isIdentifier()`).
     */
    public readonly serializedKey: string | null;

    /**
     * The description of the serialized property written by this schema.
     */
    readonly description: SchemaSerializedObjectValuePropertyDescription;

    /**
     * The schema for our underlying value. Useful for static analysis.
     */
    public readonly valueSchema: Schema<SchemaValue>;

    /**
     * Serialize the property. We expect this function to actually write the
     * property to the provided `object`.
     *
     * - `object` is the new object we're writing to
     * - `key` is the key we're writing to
     * - `value` is the value we need to write after serializing
     */
    public readonly serializeProperty: (
        object: {[key: string]: SchemaSerializedValue | undefined},
        key: string,
        value: Value,
    ) => void;

    /**
     * Deserialize the property and return it.
     *
     * - `object` is the object we are deserializing from
     * - `key` is the key in `object` to deserialize
     *
     * If `schemaDeserializationMissingObjectPropertySymbol` is returned then we
     * will throw a schema deserialization error.
     */
    public readonly deserializeProperty: (
        object: SchemaSerializedObjectValue,
        key: string,
    ) => Value;

    /**
     * Validates that any constraints for the schema are met beyond the
     * schema's TypeScript type.
     *
     * If the TypeScript type is enough to validate the property then this
     * is null.
     */
    public readonly validateProperty: ((value: Value) => void) | null;

    private constructor({
        serializedKey,
        valueSchema,
        description,
        serializeProperty,
        deserializeProperty,
        validateProperty,
    }: {
        serializedKey: string | null;
        valueSchema: Schema<SchemaValue>;
        description: SchemaSerializedObjectValuePropertyDescription;
        serializeProperty: (
            object: {[key: string]: SchemaSerializedValue | undefined},
            key: string,
            value: Value,
        ) => void;
        deserializeProperty: (object: SchemaSerializedObjectValue, key: string) => Value;
        validateProperty: ((value: Value) => void) | null;
    }) {
        this.serializedKey = serializedKey;
        this.valueSchema = valueSchema;
        this.description = description;
        this.serializeProperty = serializeProperty;
        this.deserializeProperty = deserializeProperty;
        this.validateProperty = validateProperty;
    }

    /**
     * Wrap a schema into a required object property.
     */
    public static wrap<Value>(schema: Schema<Value>): ObjectPropertySchema<Value, Value> {
        return new ObjectPropertySchema({
            serializedKey: null,
            valueSchema: schema,
            description: {
                valueSchema: schema.description,
                optional: false,
            },
            serializeProperty: (object, key, value) => {
                object[key] = schema.serialize(value);
            },
            deserializeProperty: (object, key) => {
                const value = hasOwnProperty(object, key) ? object[key] : undefined;

                if (value === undefined)
                    throw new SchemaDeserializationError(`Required property \`${key}\` not found`);

                return withSchemaDeserializationStackFrame({type: "ObjectProperty", key}, () =>
                    schema.deserialize(value),
                );
            },
            validateProperty: schema.validate,
        });
    }

    /** @see Schema.optional */
    public optional(): ObjectPropertySchema<Value | undefined, SchemaValue> {
        const {validateProperty} = this;

        return new ObjectPropertySchema({
            serializedKey: this.serializedKey,
            valueSchema: this.valueSchema,
            description: {
                ...this.description,
                optional: true,
            },
            serializeProperty: (object, key, value) => {
                if (value === undefined) return;
                this.serializeProperty(object, key, value);
            },
            deserializeProperty: (object, key) => {
                if (!hasOwnProperty(object, key) || object[key] === undefined) return undefined;
                return this.deserializeProperty(object, key);
            },
            validateProperty: validateProperty
                ? value => {
                      if (value !== undefined) {
                          validateProperty(value);
                      }
                  }
                : null,
        });
    }

    /** @see Schema.default */
    public default(defaultValue: Value): ObjectPropertySchema<Value, SchemaValue> {
        return new ObjectPropertySchema({
            serializedKey: this.serializedKey,
            valueSchema: this.valueSchema,
            description: {
                ...this.description,
                optional: true,
            },
            serializeProperty: (object, key, value) => {
                this.serializeProperty(object, key, value);
            },
            deserializeProperty: (object, key) => {
                if (!hasOwnProperty(object, key) || object[key] === undefined) return defaultValue;
                return this.deserializeProperty(object, key);
            },
            validateProperty: this.validateProperty,
        });
    }

    /** @see Schema.originalPropertyKey */
    public originalPropertyKey(originalKey: string): ObjectPropertySchema<Value, SchemaValue> {
        assert(isIdentifier(originalKey));

        return new ObjectPropertySchema({
            serializedKey: originalKey,
            valueSchema: this.valueSchema,
            description: this.description,
            serializeProperty: this.serializeProperty,
            deserializeProperty: this.deserializeProperty,
            validateProperty: this.validateProperty,
        });
    }
}

/**
 * Schema that only permits a single value.
 *
 * You should only create this with `Schema.value()`.
 */
export class ValueSchema<Value extends string | number | boolean> extends Schema<Value> {
    /**
     * The only value this schema permits.
     *
     * Useful for static analysis.
     */
    public readonly value: Value;

    private constructor(value: Value) {
        super({
            description: {type: "Value", value},
            serialize: value => value,
            deserialize: actualValue => {
                if (!Object.is(value, actualValue))
                    throw new SchemaDeserializationError(
                        `Expected value to be ${JSON.stringify(value)}`,
                    );
                return actualValue as Value;
            },
            validate: null,
        });
        this.value = value;
    }

    /**
     * Prefer `Schema.value()` which directly calls this method.
     */
    public static _new<Value extends string | number | boolean>(value: Value) {
        return new ValueSchema(value);
    }
}

/**
 * You need to recursively pass this type into itself when declaring. So
 * `Config extends UnionSchemaConfigBase<Config>`.
 */
export type UnionSchemaConfigBase<Config> = {
    [Key in keyof Config]:
        | (ObjectSchema<any> & {
              // We need to put our `Key` type constraint on `deserialize` instead of the
              // type parameter so the object type can be covariant instead of invariant.
              deserialize: (value: SchemaSerializedValue) => {type: Key};
          })
        | (UnionSchemaVariant<any> & {
              schema: {
                  // We need to put our `Key` type constraint on `deserialize` instead of the
                  // type parameter so the object type can be covariant instead of invariant.
                  deserialize: (value: SchemaSerializedValue) => {type: Key};
              };
          });
};

export type UnionSchemaConfigType<Config extends UnionSchemaConfigBase<Config>> = SchemaType<
    Config[keyof Config]
>;

/**
 * Schema for a union object value.
 *
 * You should only create this with `Schema.union()`.
 */
export class UnionSchema<Value extends {readonly type: string}> extends Schema<Value> {
    /**
     * The schema for every union variant in our object.
     *
     * Useful for static analysis.
     *
     * Types must be valid identifiers (according to `isIdentifier()`).
     */
    public readonly variantSchemaByType: ReadonlyMap<
        string,
        UnionSchemaVariant<{readonly type: string}>
    >;

    private constructor({
        variantSchemaByType,
        description,
        serialize,
        deserialize,
        validate,
    }: {
        variantSchemaByType: ReadonlyMap<string, UnionSchemaVariant<{readonly type: string}>>;
        description: SchemaSerializedValueDescription;
        serialize: (value: Value) => SchemaSerializedValue;
        deserialize: (serializedValue: SchemaSerializedValue) => Value;
        validate: ((value: Value) => void) | null;
    }) {
        super({
            description,
            serialize,
            deserialize,
            validate,
        });
        this.variantSchemaByType = variantSchemaByType;
    }

    /**
     * Prefer `Schema.union()` which directly calls this method.
     */
    public static _new<Config extends UnionSchemaConfigBase<Config>>(
        config: Config,
    ): UnionSchema<UnionSchemaConfigType<Config>> {
        const schemaEntries = Object.entries(config) as Array<
            [string, ObjectSchema<{type: string}> | UnionSchemaVariant<{type: string}>]
        >;

        const schemaByType = new Map<string, UnionSchemaVariant<{type: string}>>(
            schemaEntries.map(([type, schema]) => {
                assert(isIdentifier(type));
                return [
                    type,
                    schema instanceof UnionSchemaVariant
                        ? schema
                        : new UnionSchemaVariant({schema, serializedType: null}),
                ];
            }),
        );

        const schemaBySerializedType = new Map<string, UnionSchemaVariant<{type: string}>>(
            Array.from(schemaByType, ([type, schema]) => [schema.serializedType, schema]),
        );

        const validateByType = new Map<string, (value: {type: string}) => void>(
            filterMapIterable(schemaByType, ([type, {schema}]) => {
                if (schema.validate === null) return null;
                return [type, schema.validate];
            }),
        );

        return new UnionSchema<UnionSchemaConfigType<Config>>({
            variantSchemaByType: schemaByType,
            description: {
                type: "Union",
                variantSchemaByType: Object.fromEntries(
                    Array.from(schemaByType, ([type, {schema, serializedType}]) => [
                        serializedType,
                        // If the serialized type is different then the type at runtime, make sure to
                        // update the schema description for this union with the correct type name.
                        serializedType !== type &&
                        schema.description.type === "Object" &&
                        schema.description.propertySchemaByKey.type &&
                        schema.description.propertySchemaByKey.type.valueSchema.type === "Value" &&
                        schema.description.propertySchemaByKey.type.valueSchema.value === type
                            ? {
                                  ...schema.description,
                                  propertySchemaByKey: {
                                      ...schema.description.propertySchemaByKey,
                                      type: {
                                          valueSchema: {type: "Value", value: serializedType},
                                          optional:
                                              schema.description.propertySchemaByKey.type.optional,
                                      },
                                  },
                              }
                            : schema.description,
                    ]),
                ),
            },
            serialize: value => {
                const schema = schemaByType.get(value.type);
                assert(schema);
                const serializedValue = schema.schema.serialize(value);
                (serializedValue as any).type = schema.serializedType;
                return serializedValue;
            },
            deserialize: value => {
                if (typeof value !== "object" || value === null)
                    throw new SchemaDeserializationError("Expected an object");

                if (!hasOwnProperty(value, "type") || typeof value.type !== "string")
                    throw new SchemaDeserializationError("Required property `type` not found");

                // Use the type to select the schema we'll use to parse the value.
                const serializedType: string = value.type;

                // Always use the serialized type name, never use the current type name in
                // code. We don't have code that will serialize using the current type name.
                //
                // This makes static analysis on the schema a bit easier. Since we don't need
                // to consider two possible types.
                //
                // We may want to consider a migration path in the future where both types are
                // temporarily allowed until one type fully replaces the other.
                const schema = schemaBySerializedType.get(serializedType);
                if (schema === undefined) throw new SchemaDeserializationError("Unknown type");

                return schema.deserialize(value) as any;
            },
            validate:
                validateByType.size > 0
                    ? value => {
                          const validate = validateByType.get(value.type);
                          validate?.(value);
                      }
                    : null,
        });
    }
}

/**
 * An intermediate object we use for renaming union schema variants.
 */
export class UnionSchemaVariant<Value extends {readonly type: string}> {
    /**
     * The underlying schema for the union variant.
     */
    public readonly schema: ObjectSchema<Value>;

    /**
     * The value we use when at runtime for the `type` property.
     */
    public readonly type: string;

    /**
     * The value we use when we serialize the `type` property.
     */
    public readonly serializedType: string;

    constructor({
        schema,
        serializedType,
    }: {
        schema: ObjectSchema<Value>;
        serializedType: string | null;
    }) {
        assert(!serializedType || isIdentifier(serializedType));

        const typePropertySchema = schema.propertySchemaByKey.get("type");
        assert(
            typePropertySchema?.valueSchema instanceof ValueSchema,
            'Expected value schema for union variant\'s "type" property',
        );

        const type = typePropertySchema.valueSchema.value;
        assert(
            typeof type === "string" && isIdentifier(type),
            "Expected type to be an identifier string",
        );

        this.schema = schema;
        this.type = type;
        this.serializedType = serializedType ?? type;
    }

    public serialize(value: Value): SchemaSerializedValue {
        const serializedValue = this.schema.serialize(value);
        (serializedValue as any).type = this.serializedType;
        return serializedValue;
    }

    public deserialize(value: SchemaSerializedValue): Value {
        if (typeof value !== "object" || value === null)
            throw new SchemaDeserializationError("Expected an object");

        if (!hasOwnProperty(value, "type") || typeof value.type !== "string")
            throw new SchemaDeserializationError("Required property `type` not found");

        if (value.type !== this.serializedType)
            throw new SchemaDeserializationError(
                `Expected \`type\` property to equal ${JSON.stringify(this.serializedType)}`,
            );

        return withSchemaDeserializationStackFrame(
            {type: "UnionVariant", typeKey: "type", typeValue: this.type},
            () => {
                return this.schema.deserialize(
                    value.type !== this.type ? ({...value, type: this.type} as any) : value,
                ) as any;
            },
        );
    }

    /** @see Schema.originalUnionType */
    public originalUnionType(serializedType: string) {
        return new UnionSchemaVariant({
            schema: this.schema,
            serializedType,
        });
    }
}

class StringSchema extends Schema<string> {
    public static override string = new StringSchema({
        description: {type: "String"},
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "string") throw new SchemaDeserializationError("Expected string");
            return value;
        },
        validate: null,
    });

    public _transformString({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: string) => string;
        deserialize: (value: string) => string;
        validate: ((value: string) => void) | null;
    }): StringSchema {
        const {validate: oldValidate} = this;

        return new StringSchema({
            description: this.description,
            serialize: newValue => {
                const value = serialize(newValue);
                return this.serialize(value);
            },
            deserialize: unknownValue => {
                const value = this.deserialize(unknownValue);
                return deserialize(value);
            },
            validate:
                newValidate || oldValidate
                    ? value => {
                          oldValidate?.(value);
                          newValidate?.(value);
                      }
                    : null,
        });
    }

    /**
     * Verifies that the length of the string is greater than or equal to the
     * provided length.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public minLength(length: number): StringSchema {
        return this._transformString({
            serialize: value => {
                if (value.length < length)
                    throw new InvalidArgumentError(
                        `Expected string to have a length greater than or equal to ${length}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.length < length)
                    throw new SchemaDeserializationError(
                        `Expected string to have a length greater than or equal to ${length}`,
                    );

                return value;
            },
            validate: value => {
                if (value.length < length)
                    throw new InvalidArgumentError(
                        `Expected string to have a length greater than or equal to ${length}`,
                    );
            },
        });
    }

    /**
     * Verifies that the length of the string is less than or equal to the
     * provided length.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public maxLength(length: number): StringSchema {
        return this._transformString({
            serialize: value => {
                if (value.length > length)
                    throw new InvalidArgumentError(
                        `Expected string to have a length less than or equal to ${length}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.length > length)
                    throw new SchemaDeserializationError(
                        `Expected string to have a length less than or equal to ${length}`,
                    );

                return value;
            },
            validate: value => {
                if (value.length > length)
                    throw new InvalidArgumentError(
                        `Expected string to have a length less than or equal to ${length}`,
                    );
            },
        });
    }

    /**
     * Verifies that a string only occupies a single line.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public singleLine(): StringSchema {
        return this._transformString({
            serialize: value => {
                if (/[\n\r]/g.test(value))
                    throw new InvalidArgumentError("Expected single line string");

                return value;
            },
            deserialize: value => {
                if (/[\n\r]/g.test(value))
                    throw new SchemaDeserializationError("Expected single line string");

                return value;
            },
            validate: value => {
                if (/[\n\r]/g.test(value))
                    throw new InvalidArgumentError("Expected single line string");
            },
        });
    }

    /**
     * Transforms a value by removing the whitespace from the start and end of the
     * string.
     */
    public trim(): StringSchema {
        return this._transformString({
            serialize: value => value.trim(),
            deserialize: value => value.trim(),
            validate: value => {
                if (value !== value.trim())
                    throw new InvalidArgumentError(
                        "Expected string to not have whitespace at the start or end",
                    );
            },
        });
    }

    /**
     * Transforms a value by converting all characters to lower case.
     */
    public lowerCase(): StringSchema {
        return this._transformString({
            serialize: value => value.toLowerCase(),
            deserialize: value => value.toLowerCase(),
            validate: value => {
                if (value !== value.toLowerCase())
                    throw new InvalidArgumentError("Expected string to be lower case");
            },
        });
    }

    /**
     * Checks that a string matches the provided regular expression.
     */
    public matches(regExp: RegExp): StringSchema {
        return this._transformString({
            serialize: value => {
                if (!regExp.test(value))
                    throw new InvalidArgumentError(
                        `Expected string to match regular expression ${regExp.toString()}`,
                    );

                return value;
            },
            deserialize: value => {
                if (!regExp.test(value))
                    throw new SchemaDeserializationError(
                        `Expected string to match regular expression ${regExp.toString()}`,
                    );

                return value;
            },
            validate: value => {
                if (!regExp.test(value))
                    throw new InvalidArgumentError(
                        `Expected string to match regular expression ${regExp.toString()}`,
                    );
            },
        });
    }
}

// Avoid circular dependency between `Schema` and `StringSchema`.
Schema.string = StringSchema.string;

class IntegerSchema extends Schema<number> {
    public static override integer = new IntegerSchema({
        description: {type: "Integer"},
        serialize: value => {
            if (!Number.isSafeInteger(value)) throw new InvalidArgumentError("Expected integer");

            return value;
        },
        deserialize: value => {
            if (typeof value !== "number") throw new SchemaDeserializationError("Expected number");

            if (!Number.isSafeInteger(value))
                throw new SchemaDeserializationError("Expected integer");

            return value;
        },
        validate: value => {
            if (!Number.isSafeInteger(value)) throw new InvalidArgumentError("Expected integer");
        },
    });

    private _transformNumber({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: number) => number;
        deserialize: (value: number) => number;
        validate: ((value: number) => void) | null;
    }): IntegerSchema {
        const {validate: oldValidate} = this;

        return new IntegerSchema({
            description: this.description,
            serialize: newValue => {
                const value = serialize(newValue);
                return this.serialize(value);
            },
            deserialize: unknownValue => {
                const value = this.deserialize(unknownValue);
                return deserialize(value);
            },
            validate:
                newValidate || oldValidate
                    ? value => {
                          oldValidate?.(value);
                          newValidate?.(value);
                      }
                    : null,
        });
    }

    /**
     * Verifies that an integer is greater than or equal to the provided value.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public min(number: number): IntegerSchema {
        assert(Number.isSafeInteger(number));

        return this._transformNumber({
            serialize: value => {
                if (value < number)
                    throw new InvalidArgumentError(
                        `Expected integer to be greater than or equal to ${number}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value < number)
                    throw new SchemaDeserializationError(
                        `Expected integer to be greater than or equal to ${number}`,
                    );

                return value;
            },
            validate: value => {
                if (value < number)
                    throw new InvalidArgumentError(
                        `Expected integer to be greater than or equal to ${number}`,
                    );
            },
        });
    }

    /**
     * Verifies that an integer is less than or equal to the provided value.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public max(number: number): IntegerSchema {
        assert(Number.isSafeInteger(number));

        return this._transformNumber({
            serialize: value => {
                if (value > number)
                    throw new InvalidArgumentError(
                        `Expected integer to be less than or equal to ${number}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value > number)
                    throw new SchemaDeserializationError(
                        `Expected integer to be less than or equal to ${number}`,
                    );

                return value;
            },
            validate: value => {
                if (value > number)
                    throw new InvalidArgumentError(
                        `Expected integer to be less than or equal to ${number}`,
                    );
            },
        });
    }
}

// Avoid circular dependency between `Schema` and `IntegerSchema`.
Schema.integer = IntegerSchema.integer;

/**
 * An error thrown while deserializing a schema.
 */
// TODO(calebmer): Should we make this `InternalError` as a default instead of
// `InvalidArgumentError`? Probably better to reclassify down in severity
// instead of reclassifying up in severity.
//
// Actually, I think the real move is to have two `deserialize()` functions and
// make it an explicit choice at every call-site.
export class SchemaDeserializationError extends InvalidArgumentError {
    constructor(message: string, {cause}: {cause?: unknown} = {}) {
        const stackString = getSchemaDeserializationStackString();

        super(message, {cause});
        this.name = "SchemaDeserializationError";
        this.message = stackString ? `${message} in \`${stackString}\`` : message;
    }
}

type SchemaDeserializationStackFrame =
    | {
          readonly type: "ObjectProperty";
          readonly key: string;
      }
    | {
          readonly type: "ArrayIndex";
          readonly index: number;
      }
    | {
          readonly type: "UnionVariant";
          readonly typeKey: string;
          readonly typeValue: string | boolean;
      };

const schemaDeserializationStack: Array<SchemaDeserializationStackFrame> = [];

export function withSchemaDeserializationStackFrame<Value>(
    frame: SchemaDeserializationStackFrame,
    action: () => Value,
): Value {
    try {
        schemaDeserializationStack.push(frame);
        const value = action();
        return value;
    } finally {
        schemaDeserializationStack.pop();
    }
}

function getSchemaDeserializationStackString(): string | null {
    if (!schemaDeserializationStack.length) return null;

    let string = "";

    for (const frame of schemaDeserializationStack) {
        switch (frame.type) {
            case "ObjectProperty":
                string += `.${frame.key}`;
                break;
            case "ArrayIndex":
                string += `[${frame.index}]`;
                break;
            case "UnionVariant":
                string += `(${frame.typeKey}=${frame.typeValue})`;
                break;
            default:
                throw exhaustive(frame);
        }
    }

    return string;
}
