import {isValid as isValidDate} from "date-fns/isValid";
import {parseISO} from "date-fns/parseISO";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {Optionalize} from "~/shared/helpers/types/optionalize.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {Id, isId} from "~/shared/id/id.js";
import {checkSchemaBackwardsCompatibility} from "~/shared/schema/check_schema_backwards_compatibility.js";
import {
    SchemaSerializedObjectValuePropertyDescription,
    SchemaSerializedValueDescription,
} from "~/shared/schema/types/schema_description_types.js";

/**
 * Get the underlying type of a schema object.
 */
export type SchemaType<
    T extends Schema<any> | ObjectPropertySchema<any, any> | UnionSchemaVariant<any>,
> =
    T extends Schema<infer U>
        ? U
        : T extends ObjectPropertySchema<infer U, any>
          ? U
          : T extends UnionSchemaVariant<infer U>
            ? U
            : never;

/**
 * A serialized value we can send across process boundaries.
 *
 * The same as a JSON value but with support for `Uint8Array`s. [DynamoDB supports
 * binary fields][1] (which we use for data storage) and [Ably also supports binary
 * fields][2] through MessagePack (which we use for realtime).
 *
 * Notably, we only allow `undefined` as an object property. Not as a general
 * scalar value. Just like JSON.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html#HowItWorks.DataTypes
 * [2]:
 *     https://faqs.ably.com/do-you-binary-encode-your-messages-for-greater-efficiency
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
 * [1]:
 *     https://en.wikipedia.org/wiki/Covariance_and_contravariance_(computer_science)
 */
export interface SchemaWithOnlySerialization<Value> {
    getDescription(): SchemaSerializedValueDescription;
    serialize(value: Value): SchemaSerializedValue;
}

/**
 * `Schema` but you can only deserialize.
 *
 * Useful if you want to be [covariant][1] on `Value`.
 *
 * [1]:
 *     https://en.wikipedia.org/wiki/Covariance_and_contravariance_(computer_science)
 */
export interface SchemaWithOnlyDeserialization<Value> {
    getDescription(): SchemaSerializedValueDescription;
    deserialize(serializedValue: SchemaSerializedValue): Value;
}

/**
 * `Schema` but you can't validate.
 *
 * Useful if you want a simpler schema type when TypeScript is being annoying.
 */
export interface SchemaWithoutValidation<Value>
    extends SchemaWithOnlySerialization<Value>, SchemaWithOnlyDeserialization<Value> {}

type SchemaDescriptionRecursionState =
    | {type: "Entered"}
    | {type: "Circular"; stubDescription: any}
    | null;

/**
 * The schema class is a type-safe combinator-style utility for validating and
 * migrating unknown JavaScript values. You may use it for reading values from a
 * dynamic JSON data store, messages from an untyped event stream, or for
 * validating client input.
 *
 * It is designed to support changing data formats over time. For example, objects
 * will silently discard unknown properties from a new application version.
 */
export class Schema<Value> implements SchemaWithOnlySerialization<Value> {
    /**
     * Serializes a value into a format we can send across process boundaries.
     *
     * Does not mutate the underlying value during serialization.
     */
    public readonly serialize: (value: Value) => SchemaSerializedValue;

    /**
     * Deserializes a value we received from a process boundary. If the value does not
     * match our schema then we throw an error.
     *
     * Does not mutate the underlying value during deserialization.
     */
    public readonly deserialize: (serializedValue: SchemaSerializedValue) => Value;

    /**
     * Validates that the provided value matches any constraints in the schema beyond
     * the TypeScript type. Throws an error if it doesn't. Valid values can be
     * serialized without throwing an error and will deserialize to exactly the same
     * value you serialized.
     *
     * Validation also doesn't recurse over the entire value. Only the parts of the
     * value which need validation. If nothing needs validation this property will be
     * null.
     *
     * Some examples:
     *
     * - The TypeScript type of both `Schema.float` and `Schema.integer` is `number`.
     *   We don't need to validate `Schema.float` because all TypeScript `number`s
     *   match this schema. We do need to validate `Schema.integer` since not all
     *   `number`s are `integer`s.
     *
     * - `Schema.string.trim()` will remove whitespace from a string while serializing.
     *   However, validation will fail if there is whitespace at the beginning or end
     *   of the string. Since that means `deserialize(serialize(value))` won't return
     *   exactly the same value.
     *
     * - Validating `Schema.array(Schema.float)` is a noop since we know recursively
     *   nothing needs validation. However, validating `Schema.array(Schema.integer)`
     *   will visit every item in the array.
     */
    public readonly validate: ((value: Value) => void) | null;

    // NOTE(calebmer): Some ideas on serialization/deserialization performance. Two
    // performance problems:
    //
    // 1. There's a lot of abstraction. To serialize an object you step through a
    //    pretty deep, recursive, function stack. We may bypass a lot of JavaScript
    //    engine optimizations around [hidden classes][1] through dynamic property
    //    access like `o[p]` instead of `o.p`.
    // 2. The serialization format is pretty general. What if instead we had multiple
    //    specialized serialization formats? (Like [serde][2] in Rust.) For example, we
    //    need another serialization pass for DynamoDB to convert into its value
    //    format. We also need a serialization pass to convert into MessagePack (for
    //    Ably) or JSON.
    //
    // We could solve both problems with codegen! Instead of the functional programming
    // style where we build up serialize and deserialize functions, we generate hyper
    // optimized non-recursive functions for different target formats. We generate a
    // function for DynamoDB, for MessagePack, and for JSON (both direct string
    // serialization but also object serialization).
    //
    // I suspect since we do serialization and deserialization SO MUCH that investing
    // in optimizing those code paths will prove to be a meaningful performance win.
    //
    // [1]: https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html
    // [2]: https://serde.rs

    protected constructor({
        getDescription,
        serialize,
        deserialize,
        validate,
    }: {
        getDescription: () => SchemaSerializedValueDescription;
        serialize: (value: Value) => SchemaSerializedValue;
        deserialize: (serializedValue: SchemaSerializedValue) => Value;
        validate: ((value: Value) => void) | null;
    }) {
        this._getDescription = getDescription;
        this.serialize = serialize;
        this.deserialize = deserialize;
        this.validate = validate;
    }

    private readonly _getDescription: () => SchemaSerializedValueDescription;
    private _description: SchemaSerializedValueDescription | null = null;
    private _descriptionRecursionState: SchemaDescriptionRecursionState = null;

    /**
     * Get the description of the serialized value returned by this schema.
     *
     * Computed lazily and then cached so you get the same value every time you call
     * this function. Lazily computed since we don't always know the description of a
     * schema during initialization.
     */
    public getDescription(): SchemaSerializedValueDescription {
        if (this._description === null) {
            // If we are calling this function recursively, return a stub that we will mutate
            // at the top of the stack to the right value. This will make the description
            // option circular so you have to take care when stringifying.
            if (this._descriptionRecursionState) {
                let stubDescription: any;
                if (this._descriptionRecursionState.type === "Circular") {
                    stubDescription = this._descriptionRecursionState.stubDescription;
                } else {
                    stubDescription = {};
                    Object.defineProperty(stubDescription, "type", {
                        configurable: true,
                        get: () => {
                            throw new InternalError(
                                "Can not access properties on uninitialized circular schema description",
                            );
                        },
                    });
                    this._descriptionRecursionState = {type: "Circular", stubDescription};
                }
                return stubDescription;
            }

            this._descriptionRecursionState = cast<SchemaDescriptionRecursionState>({
                type: "Entered",
            });

            try {
                const description = this._getDescription();

                if (this._descriptionRecursionState?.type !== "Circular") {
                    this._descriptionRecursionState = null;
                    this._description = description;
                } else {
                    const stubDescription = this._descriptionRecursionState.stubDescription;
                    this._descriptionRecursionState = null;
                    delete stubDescription.type;
                    Object.assign(stubDescription, description);
                    this._description = stubDescription as SchemaSerializedValueDescription;
                }
            } catch (error) {
                // Make sure to reset our recursion state.
                this._descriptionRecursionState = null;
                throw error;
            }
        }

        return this._description;
    }

    private static _unknown = new Schema<SchemaSerializedValue>({
        getDescription: () => ({type: "Unknown"}),
        serialize: value => value,
        deserialize: value => value,
        validate: null,
    });

    /**
     * Accept any value.
     *
     * An escape hatch if your type is complicated and you'd like to manage it
     * yourself.
     */
    public static unknown(): Schema<SchemaSerializedValue>;
    public static unknown<Value>(): Schema<Value>;
    public static unknown<Value>(): Schema<Value> {
        return this._unknown as any;
    }

    /**
     * Accept a boolean value.
     */
    public static boolean = new Schema<boolean>({
        getDescription: () => ({type: "Boolean"}),
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
    public static float: FloatSchema;

    /**
     * Accept any integer value.
     *
     * An integer is a JavaScript number that passes [`Number.isSafeInteger`][1]. So
     * integers between -(2^53 - 1) and 2^53 - 1.
     *
     * [1]:
     *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger
     */
    public static integer: IntegerSchema;

    /**
     * Accept any string value.
     */
    public static string: StringSchema;

    /**
     * Accept any `Id` value.
     *
     * A function so that you may pass in a nominal ID type.
     */
    public static id<Value extends Id>(): Schema<Value> {
        return this._id as any;
    }

    private static _id = new Schema<Id>({
        getDescription: () => ({type: "Id"}),
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
    public static bytes: BytesSchema;

    /**
     * Accept a valid `Date` object.
     *
     * Serializes to an [ISO 8601][1] string.
     *
     * [1]: https://en.wikipedia.org/wiki/ISO_8601
     */
    public static date = new Schema<Date>({
        getDescription: () => ({type: "Date"}),
        serialize: value => {
            assert(isValidDate(value));

            // `formatISO()` from `date-fns` truncates milliseconds by default. Use the native
            // `toISOString()` method for printing dates.
            return value.toISOString();
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
     * An unsigned 64-bit integer.
     */
    public static uint64 = new Schema<bigint>({
        getDescription: () => ({type: "Uint64"}),
        serialize: value => {
            assert(0n <= value && value <= 2n ** 64n - 1n);
            return String(value);
        },
        deserialize: serializedValue => {
            if (typeof serializedValue !== "string") {
                throw new SchemaDeserializationError("Expected a string");
            }

            const value = BigInt(serializedValue);

            if (value < 0n || 2n ** 64n - 1n < value) {
                throw new SchemaDeserializationError("Expected an integer in the uint64 range");
            }

            return value;
        },
        validate: null,
    });

    /**
     * Accept null in addition to any underlying value.
     */
    public nullable(): Schema<Value | null> {
        const {validate} = this;

        return new Schema({
            getDescription: () => ({
                type: "Nullable",
                schema: this.getDescription(),
            }),
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
    public static value<Value extends ValueSchemaValueBase>(value: Value): ValueSchema<Value> {
        return ValueSchema._new(value);
    }

    /**
     * Accept only values included in the enum array/object.
     */
    public static enum<const Value extends string | number | boolean>(
        values: ReadonlySet<Value> | ReadonlyArray<Value> | Readonly<Record<string, Value>>,
    ): Schema<Value> {
        let valueSet: ReadonlySet<Value>;
        if (values instanceof Set) {
            valueSet = values;
        } else if (Array.isArray(values)) {
            valueSet = new Set(values);
        } else {
            valueSet = new Set(Object.values(values));
        }

        return new Schema({
            getDescription: () => ({
                type: "Enum",
                values: Array.from(valueSet),
            }),
            serialize: value => value,
            deserialize: value => {
                if (valueSet.has(value as Value)) {
                    return value as Value;
                }
                throw new SchemaDeserializationError(
                    `Expected one of ${Array.from(valueSet, v => JSON.stringify(v)).join(", ")}`,
                );
            },
            validate: null,
        });
    }

    /**
     * Allows an object property to be optionally provided.
     *
     * Same as specifying `{p?: T}` in TypeScript. Only works for object properties.
     */
    public optional() {
        return ObjectPropertySchema.wrap(this).optional();
    }

    /**
     * Provide a default for an optional object property.
     *
     * When deserializing an object, if we don't see this property then we will use the
     * provided default value.
     */
    public default(
        defaultValue: Value | ((serializedValue: SchemaSerializedObjectValue) => Value),
    ) {
        return ObjectPropertySchema.wrap(this).default(defaultValue);
    }

    /**
     * If you want to rename an object property, use this combinator to provide the old
     * name. We will serialize and deserialize the object with this name instead of the
     * one in the `Schema.object()` definition.
     */
    public originalPropertyKey(originalKey: string) {
        return ObjectPropertySchema.wrap(this).originalPropertyKey(originalKey);
    }

    /**
     * Accept an array where every item matches the schema.
     */
    public static array<Value>(itemSchema: Schema<Value>): ArraySchema<Value> {
        return ArraySchema._new(itemSchema);
    }

    /**
     * Accept an object where the keys match the corresponding schema.
     *
     * Any extra keys in the object will be discarded. This allows schemas to be
     * compatible with future objects that may add properties. Also for security an
     * attacker can't sneak in unexpected properties that may change the system's
     * behavior.
     *
     * Only considers the object's own keys. We ignore any properties on the prototype
     * chain.
     *
     * If parsing a plain object we will mutate the object in-place. We will delete any
     * extra unknown keys. If parsing an object with a prototype chain then we will
     * create a new, plain, object.
     */
    public static object<Config extends ObjectSchemaConfigBase>(
        config: Config,
    ): ObjectSchema<ObjectSchemaConfigType<Config>> {
        return ObjectSchema._new(config);
    }

    /**
     * Accept an object where a sentinel `type` string matches an expected type. Allows
     * you to build algebraic data types into your data schema.
     *
     * In academic type theory terms: `Schema.object()` lets you create a product type
     * and `Schema.union()` lets you create a sum type.
     *
     * This is not a union on arbitrary types like in TypeScript, this union is
     * required to be an object with a sentinel `type` property. We force the existence
     * of a `type` property to quickly determine which guard to use for parsing.
     *
     * If we receive an object with an unknown `type` property then we throw. This is
     * one case where we aren't future compatible.
     */
    public static union<Config extends UnionSchemaObjectConfigBase<Config>>(
        config: Config,
    ): UnionSchema<UnionSchemaObjectConfigType<Config>> {
        return UnionSchema._new(config);
    }

    /**
     * Same as `Schema.union()` but you can provide a custom key to use for the union's
     * type instead of the identifier `type`.
     */
    public static unionWithKey<
        const TypeKey extends string,
        Config extends UnionSchemaObjectConfigWithKeyBase<TypeKey, Config>,
    >(
        typeKey: TypeKey,
        config: Config,
    ): UnionSchema<UnionSchemaObjectConfigWithKeyType<TypeKey, Config>> {
        return UnionSchema._new(config, {
            serializedTypeKey: typeKey,
            deserializedTypeKey: typeKey,
        });
    }

    /**
     * A simpler version of `Schema.union()` that supports switching on a boolean
     * property.
     *
     * The first schema is for `true` and the second schema is for `false`.
     */
    public static booleanUnion<
        const TypeKey extends string,
        TrueSchema extends Schema<any> & {
            // We need to put our `key` type constraint on `deserialize` instead of the type
            // parameter so the object type can be covariant instead of invariant.
            deserialize: (value: SchemaSerializedValue) => Record<TypeKey, true>;
        },
        FalseSchema extends Schema<any> & {
            // We need to put our `key` type constraint on `deserialize` instead of the type
            // parameter so the object type can be covariant instead of invariant.
            deserialize: (value: SchemaSerializedValue) => Record<TypeKey, false>;
        },
    >(
        typeKey: TypeKey,
        trueSchema: TrueSchema,
        falseSchema: FalseSchema,
    ): Schema<SchemaType<TrueSchema> | SchemaType<FalseSchema>> {
        assert(isIdentifier(typeKey));

        const {validate: validateTrue} = trueSchema;
        const {validate: validateFalse} = falseSchema;

        return new Schema<SchemaType<TrueSchema> | SchemaType<FalseSchema>>({
            getDescription: () => ({
                type: "BooleanUnion",
                typeKey,
                trueSchema: trueSchema.getDescription(),
                falseSchema: falseSchema.getDescription(),
            }),
            serialize: value => {
                if ((value as any)[typeKey]) {
                    return trueSchema.serialize(value);
                } else {
                    return falseSchema.serialize(value);
                }
            },
            deserialize: value => {
                if (typeof value !== "object" || value === null)
                    throw new SchemaDeserializationError("Expected an object");

                if (!hasOwnProperty(value, typeKey) || typeof value[typeKey] !== "boolean")
                    throw new SchemaDeserializationError(
                        `Required property \`${typeKey}\` not found`,
                    );

                if (value[typeKey]) {
                    return withSchemaDeserializationStackFrame(
                        {type: "UnionVariant", typeKey: typeKey, typeValue: true},
                        () => trueSchema.deserialize(value),
                    );
                } else {
                    return withSchemaDeserializationStackFrame(
                        {type: "UnionVariant", typeKey: typeKey, typeValue: false},
                        () => falseSchema.deserialize(value),
                    );
                }
            },
            validate:
                validateTrue || validateFalse
                    ? value => {
                          if ((value as any)[typeKey]) {
                              validateTrue?.(value);
                          } else {
                              validateFalse?.(value);
                          }
                      }
                    : null,
        });
    }

    /**
     * A simpler version of `Schema.union()` that supports `Result<T>` objects.
     *
     * The first schema is for `ok: true` and the second schema is for `ok: false`.
     */
    public static result<
        OkSchema extends Schema<any> & {
            // We need to put our `ok` type constraint on `deserialize` instead of the type
            // parameter so the object type can be covariant instead of invariant.
            deserialize: (value: SchemaSerializedValue) => {ok: true};
        },
        ErrorSchema extends Schema<any> & {
            // We need to put our `ok` type constraint on `deserialize` instead of the type
            // parameter so the object type can be covariant instead of invariant.
            deserialize: (value: SchemaSerializedValue) => {ok: false};
        },
    >(
        okSchema: OkSchema,
        errorSchema: ErrorSchema,
    ): Schema<SchemaType<OkSchema> | SchemaType<ErrorSchema>> {
        return this.booleanUnion("ok", okSchema, errorSchema);
    }

    /**
     * A unique set of values.
     *
     * Maintains the order items were inserted into the set during
     * serialization/deserialization just like the JavaScript `Set` class does.
     *
     * Keep in mind this uses JavaScript `Set` rules for value equality. It does not
     * test structural equality! So objects are only considered equal by the set if
     * they are referentially equal. This means you may end up with the serialized set
     * `[{p: 1}, {p: 1}]`. Those two objects are structurally equal but if they had the
     * same reference when you built the `Set` they will stay that way.
     */
    public static set<Value>(itemSchema: Schema<Value>): SetSchema<Value> {
        return SetSchema._new(itemSchema);
    }

    /**
     * A map of values. Each key may only be represented in the map once.
     *
     * Maintains the order entries were inserted into the map during
     * serialization/deserialization just like the JavaScript `Map` class does.
     *
     * To maintain order (and to allow arbitrary key values) we serialize to an array
     * of tuples instead of an object. So `[[1, "a"], [2, "b"], [3, "c"]]`.
     *
     * Keep in mind this uses JavaScript `Map` key rules for key equality. It does not
     * test structural equality! So objects are only considered equal by the map if
     * they are referentially equal. This means you may end up with the serialized map
     * `[[{p: 1}, "a"], [{p: 1}, "b"]]`. Those two objects are structurally equal but
     * if they had the same reference when you built the `Map` they will stay that way.
     */
    public static map<Key, Value>(
        keySchema: Schema<Key>,
        valueSchema: Schema<Value>,
    ): MapSchema<Key, Value> {
        return MapSchema._new(keySchema, valueSchema);
    }

    /**
     * A value tuple. Represented as an array of fixed length with values of different
     * types.
     */
    public static tuple<const Schemas extends ReadonlyArray<Schema<any>>>(
        elementSchemas: Schemas,
    ): Schema<{readonly [Key in keyof Schemas]: SchemaType<Schemas[Key]>}> {
        const hasValidations = elementSchemas.some(schema => schema.validate !== null);

        return new Schema<{readonly [Key in keyof Schemas]: SchemaType<Schemas[Key]>}>({
            getDescription: () => ({
                type: "Tuple",
                elementSchemas: elementSchemas.map(schema => schema.getDescription()),
            }),
            serialize: value => {
                return value.map((element, i) => elementSchemas[i]!.serialize(element));
            },
            deserialize: value => {
                if (!Array.isArray(value))
                    throw new SchemaDeserializationError("Expected an array");

                if (value.length !== elementSchemas.length)
                    throw new SchemaDeserializationError(
                        `Expected array to have a length equal to ${elementSchemas.length}`,
                    );

                return elementSchemas.map((elementSchema, i) => {
                    return elementSchema.deserialize(value[i]);
                }) as {
                    readonly [Key in keyof Schemas]: SchemaType<Schemas[Key]>;
                };
            },
            validate: hasValidations
                ? value => {
                      for (let i = 0; i < elementSchemas.length; i++) {
                          elementSchemas[i]!.validate?.(value[i]);
                      }
                  }
                : null,
        });
    }

    /**
     * Transform a schema's value at runtime into a different format.
     *
     * If you want to serialize a value in a format supported by our `Schema` but
     * manipulate the value at runtime as some custom object, you can use the transform
     * object to add extra serialization and deserialization steps.
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
            getDescription: () => this.getDescription(),
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

    /**
     * Migrates a serialized value into the format our schema expects. Use this to
     * perform more complicated data shape migrations.
     *
     * This runs in the opposite order of `transform()`. It runs before all other
     * deserialization and after all other serialization.
     *
     * You shouldn't mutate the underlying values in this function. Instead return new
     * values!
     */
    public migration({
        serialize,
        deserialize,
    }: {
        serialize: (value: SchemaSerializedValue) => SchemaSerializedValue;
        deserialize: (value: SchemaSerializedValue) => SchemaSerializedValue;
    }): Schema<Value> {
        return new Schema({
            getDescription: () => this.getDescription(),
            serialize: value => {
                const serializedValue = this.serialize(value);
                return serialize(serializedValue);
            },
            deserialize: serializedValue => {
                const migratedValue = deserialize(serializedValue);
                return this.deserialize(migratedValue);
            },
            validate: this.validate,
        });
    }

    /**
     * Add a validation to this schema. Validations make sure `Value` is correct beyond
     * just structural correctness based on the TypeScript type. For example if you
     * have a `{min: number, max: number}` object and want to make sure `min` is always
     * less than `max` you'd add a validation to make sure this is always the case.
     *
     * The validation is checked at serialization and deserialization time.
     */
    public validation<NewValue extends Value>(
        message: string,
        validate: (value: Value) => value is NewValue,
    ): Schema<NewValue>;
    public validation(message: string, validate: (value: Value) => boolean): Schema<Value>;
    public validation(message: string, validate: (value: Value) => boolean): Schema<Value> {
        return new Schema<Value>({
            getDescription: () => this.getDescription(),
            serialize: value => {
                if (!validate(value))
                    throw new InvalidArgumentError(`Validation failed: ${message}`);

                return this.serialize(value);
            },
            deserialize: unknownValue => {
                const value = this.deserialize(unknownValue);

                if (!validate(value))
                    throw new SchemaDeserializationError(`Validation failed: ${message}`);

                return value;
            },
            validate: value => {
                this.validate?.(value);

                if (!validate(value))
                    throw new InvalidArgumentError(`Validation failed: ${message}`);
            },
        });
    }

    /**
     * Declare a schema that you will define later. Trying to use the schema before
     * you've defined it will throw an error. You can only define schemas once.
     *
     * You use this schema combinator to build recursive schemas.
     */
    public static declare<Value>(): Schema<Value> & {define(schema: Schema<Value>): void} {
        let schema: Schema<Value> | null = null;

        const declaredSchema = new Schema<Value>({
            getDescription: () => {
                if (schema === null)
                    throw new InternalError("Declared schema has not been defined yet");

                return schema.getDescription();
            },
            serialize: value => {
                if (schema === null)
                    throw new InternalError("Declared schema has not been defined yet");

                return schema.serialize(value);
            },
            deserialize: value => {
                if (schema === null)
                    throw new InternalError("Declared schema has not been defined yet");

                return schema.deserialize(value);
            },
            validate: value => {
                if (schema === null)
                    throw new InternalError("Declared schema has not been defined yet");

                schema.validate?.(value);
            },
        });

        return Object.assign(declaredSchema, {
            define: (definedSchema: Schema<Value>) => {
                if (schema !== null)
                    throw new InternalError("Declared schema has already been defined");

                // Optimization: Set `validate` to null if it is null in the defined schema so we
                // won't have to recursively validate. Even though it is marked as `readonly`. This
                // shouldn't change semantics just performance so we're ok with breaking the
                // `readonly` contract.
                if (definedSchema.validate === null) {
                    cast<{validate: ((value: Value) => void) | null}>(declaredSchema).validate =
                        null;
                }

                schema = definedSchema;
            },
        });
    }

    /**
     * Schema for an open ended interface. Generally prefer using `union()` as its more
     * ergonomic. However, if you need to a union-like schema with implementations
     * spread across multiple packages then `interface()` is for you. We borrow the
     * language of TypeScript interfaces for this schema kind.
     *
     * You can think of `union()` as a "closed" type class where we know all variants
     * when the schema is constructed (e.g. a [Kotlin "sealed" class][1] or a [Haskell
     * algebraic data type][2] or a [Rust enum][3]). You can think of `interface()` as
     * an "open" type class where other implementations can be added later (e.g. a
     * [Kotlin "open" class][4] or a [Haskell type class][5] or a [Rust trait][6]).
     * Closed/open unions are both useful for expressing data types and have different
     * tradeoffs. Generally, in our codebase we prefer closed unions since you can
     * exhaustively switch on them.
     *
     * The way you use this is you declare an interface:
     *
     * ```ts
     * const Animal = Schema.interface({
     *     type: Schema.string,
     *     age: Schema.integer,
     * });
     *
     * // Recommended: `Animal` is a class so define `Animal` in type space as well
     * // as value space.
     * type Animal = InstanceType<Animal>;
     * ```
     *
     * ...then later you add implementors of the interface:
     *
     * ```ts
     * const CatSchema = Animal.implement({
     *     type: Schema.value("Cat"),
     *     breed: Schema.enum(["Calico", "Siamese", "Tabby", "Tuxedo"]),
     * });
     *
     * const DogSchema = Animal.implement({
     *     type: Schema.value("Dog"),
     *     breed: Schema.enum(["Bulldog", "Labrador", "Beagle", "Poodle"]),
     * });
     * ```
     *
     * The implementors can be in different files. This is the main advantage over
     * `union()`! You don't need to collect all types in your union together in one
     * package. You can instead distribute the schemas across multiple packages.
     *
     * The tradeoff is you must provide the schema when you initialize an interface and
     * when you deserialize an interface value. For example, to construct a dog that's
     * compatible with the `Animal` interface you must write the following:
     *
     * ```ts
     * const myDog = new Animal(DogSchema, {type: "Dog", breed: "Labrador"});
     * ```
     *
     * Notice how you had to use `new Animal()` and pass in `DogSchema`. If you get an
     * `Animal` back from the network you're responsible for figuring out what
     * implementation it uses and calling `deserialize()` on the animal with the
     * correct schema.
     *
     * For example, in the `Animal` case we include the animal's type in a `type`
     * property. However, `type` is not a required property (like it is for `union()`).
     * You can hint the type of your interface in any way you want. Here's how we use
     * the `type` property to figure out our animal is a cat then deserialize the cat:
     *
     * ```ts
     * if (animal.type === "Cat") {
     *     console.log(animal.deserialize(CatSchema).breed);
     * }
     * ```
     *
     * Once you've deserialized an interface instance with some schema you must always
     * use that schema if you call `deserialize()` again! Otherwise an error will be
     * thrown. In our above example, calling `animal.deserialize(DogSchema)` after
     * you've already called `animal.deserialize(CatSchema)` throws an error.
     *
     * The way this schema works is we associate interface instances with a specific
     * schema object that never changes. If you use your interface constructor to
     * create the instance (e.g. `new Animal()` in this example) the schema you pass in
     * is the one associated with the instance. If you're deserializing a value from
     * the network, we don't know which schema to use. So we construct an instance with
     * no associated schema. Once you call `instance.deserialize(schema)` we associate
     * the provided `schema` with the instance.
     *
     * [1]: https://kotlinlang.org/docs/sealed-classes.html
     * [2]:
     *     https://learnyouahaskell.com/making-our-own-types-and-typeclasses#algebraic-data-types
     * [3]: https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html
     * [4]: https://kotlinlang.org/docs/inheritance.html#overriding-methods
     * [5]:
     *     https://learnyouahaskell.com/making-our-own-types-and-typeclasses#typeclasses-102
     * [6]: https://doc.rust-lang.org/book/ch10-02-traits.html
     */
    public static interface<Config extends ObjectSchemaConfigBase>(
        config: Config,
    ): InterfaceSchemaInstanceClass<ObjectSchemaConfigType<Config>> {
        const schemaBase = Schema.object(config);

        class InterfaceSchemaInstance<
            Value extends InterfaceSchemaInstanceBase & Readonly<ObjectSchemaConfigType<Config>> =
                InterfaceSchemaInstanceBase & Readonly<ObjectSchemaConfigType<Config>>,
        > extends InterfaceSchemaInstanceBase {
            public static readonly schema = new Schema<
                InterfaceSchemaInstanceBase & Readonly<ObjectSchemaConfigType<Config>>
            >({
                // TODO(calebmer): This doesn't consider evolution of schemas implementing this
                // schema! Ideally we'd keep track of all implementor schemas too and track their
                // evolution.
                getDescription: schemaBase._getDescription,
                serialize: value => value.serialize(),
                deserialize: serializedValue => {
                    const valueBase = schemaBase.deserialize(serializedValue);

                    return Object.assign(
                        new InterfaceSchemaInstanceBase(null, serializedValue),
                        valueBase,
                    );
                },
                validate: schemaBase.validate,
            });

            public static implement<OtherConfig extends ObjectSchemaConfigBase>(
                config: OtherConfig,
            ): ObjectSchema<
                Replace<ObjectSchemaConfigType<Config>, ObjectSchemaConfigType<OtherConfig>>
            > {
                return Object.assign(schemaBase.merge(Schema.object(config)), {
                    _interfaceSchema: InterfaceSchemaInstance.schema,
                });
            }

            constructor(
                schema: ObjectSchema<Value> & {
                    readonly _interfaceSchema: Schema<
                        InterfaceSchemaInstanceBase & Readonly<ObjectSchemaConfigType<Config>>
                    >;
                },
                value: Value,
            ) {
                // Make sure the schema we're using is a valid implementor of our interface.
                if (schema._interfaceSchema !== InterfaceSchemaInstance.schema) {
                    throw new InternalError(
                        "The schema provided to `InterfaceSchemaInstance` is not an implementation (created with `implement()`) of the interface",
                    );
                }

                super(schema, value);

                // Serialize only the keys from `valueBase` but using the schemas from `schema`. In
                // case `schema` adds any `transform()`s that `valueBase` wouldn't recognize.
                //
                // This is guaranteed to be safe since the `schemaBase.merge()` operation we use to
                // create `schema` checks that share properties between `schemaBase` and `schema`
                // are backwards compatible with one another.
                {
                    const serializedValueBase: any = {};

                    for (const key of schemaBase.propertySchemaByKey.keys()) {
                        const propertySchema = assertExists(schema.propertySchemaByKey.get(key));
                        const serializedKey = propertySchema.serializedKey ?? key;
                        propertySchema.serializeProperty(
                            serializedValueBase,
                            serializedKey,
                            (value as any)[key],
                            key,
                        );
                    }

                    Object.assign(this, schemaBase.deserialize(serializedValueBase));
                }
            }
        }

        return InterfaceSchemaInstance as any;
    }
}

/**
 * A special `Uint8Array` that when passed into `JSON.stringify()` base64 encodes
 * its contents.
 *
 * This is a convenient class for working with an unknown serializer. If the
 * serializer has special support for `Uint8Array` then it will directly encode the
 * binary contents. If the serializer uses `JSON.stringify()` then we get a base64
 * string.
 */
export class JsonStringifiableUint8Array extends Uint8Array {
    public toJSON(): string {
        return encodeBase64(this);
    }
}

/**
 * Schema for an array value.
 *
 * You should only create this with `Schema.array()`.
 */
export class ArraySchema<Value> extends Schema<ReadonlyArray<Value>> {
    /**
     * Prefer `Schema.array()` which directly calls this method.
     */
    public static _new<Value>(itemSchema: Schema<Value>): ArraySchema<Value> {
        const {validate} = itemSchema;

        return new ArraySchema({
            getDescription: () => ({
                type: "Array",
                itemSchema: itemSchema.getDescription(),
            }),
            serialize: value => {
                // Optimization: Don't allocate an empty array object if we're serializing an empty
                // array.
                if (value.length === 0) return emptyArray;

                return value.map(item => itemSchema.serialize(item));
            },
            deserialize: value => {
                if (!Array.isArray(value))
                    throw new SchemaDeserializationError("Expected an array");

                // Optimization: Don't allocate an empty array object if we're deserializing an
                // empty array.
                if (value.length === 0) return emptyArray;

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

    private _transformArray({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: ReadonlyArray<Value>) => ReadonlyArray<Value>;
        deserialize: (value: ReadonlyArray<Value>) => ReadonlyArray<Value>;
        validate: ((value: ReadonlyArray<Value>) => void) | null;
    }): ArraySchema<Value> {
        const {validate: oldValidate} = this;

        return new ArraySchema({
            getDescription: () => this.getDescription(),
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
     * Verifies that the length of the array is greater than or equal to the provided
     * length.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public minLength(length: number): ArraySchema<Value> {
        return this._transformArray({
            serialize: value => {
                if (value.length < length)
                    throw new InvalidArgumentError(
                        `Expected array to have a length greater than or equal to ${length}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.length < length)
                    throw new SchemaDeserializationError(
                        `Expected array to have a length greater than or equal to ${length}`,
                    );

                return value;
            },
            validate: value => {
                if (value.length < length)
                    throw new InvalidArgumentError(
                        `Expected array to have a length greater than or equal to ${length}`,
                    );
            },
        });
    }

    /**
     * Verifies that the length of the string is less than or equal to the provided
     * length.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public maxLength(length: number): ArraySchema<Value> {
        return this._transformArray({
            serialize: value => {
                if (value.length > length)
                    throw new InvalidArgumentError(
                        `Expected array to have a length less than or equal to ${length}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.length > length)
                    throw new SchemaDeserializationError(
                        `Expected array to have a length less than or equal to ${length}`,
                    );

                return value;
            },
            validate: value => {
                if (value.length > length)
                    throw new InvalidArgumentError(
                        `Expected array to have a length less than or equal to ${length}`,
                    );
            },
        });
    }
}

export type ObjectSchemaConfigBase = {
    [key: string]: Schema<any> | ObjectPropertySchema<any, any>;
};

export type ObjectSchemaConfigType<Config extends ObjectSchemaConfigBase> = Optionalize<{
    readonly [Key in keyof Config]: SchemaType<Config[Key]>;
}>;

export const objectSchemaMissingPropertySymbol = Symbol("missing");

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
     * Validations to run on the object.
     */
    private readonly _validations: ReadonlyArray<{
        message: string;
        validate: (value: Value) => boolean;
    }> | null;

    /**
     * Serialize the value. Will always serialize into an object value.
     */
    declare public readonly serialize: (value: Value) => SchemaSerializedObjectValue;

    /**
     * Serialize by assigning object properties directly to the provided target instead
     * of creating a new object.
     */
    public readonly serializeInto: (
        value: Value,
        target: {[key: string]: SchemaSerializedValue},
    ) => void;

    /**
     * Deserialize by assigning object properties directly to the provided target
     * instead of the source value or creating a new value.
     */
    public readonly deserializeInto: (
        serializedValue: SchemaSerializedValue,
        target?: {[key: string]: SchemaSerializedValue},
    ) => Value;

    private constructor(
        propertySchemaByKey: ReadonlyMap<string, ObjectPropertySchema<unknown, unknown>>,
        validations: ReadonlyArray<{message: string; validate: (value: Value) => boolean}> | null,
    ) {
        const getDescription = (): SchemaSerializedValueDescription => {
            const propertySchemaDescriptionByKey: {
                [key: string]: SchemaSerializedObjectValuePropertyDescription;
            } = {};

            for (const [key, schema] of propertySchemaByKey) {
                const descriptions = schema.getDescription(schema.serializedKey ?? key, key);
                for (const [key, description] of descriptions) {
                    assert(
                        !hasOwnProperty(propertySchemaDescriptionByKey, key),
                        quote`Duplicate property key ${key}`,
                    );
                    // @ts-expect-error
                    propertySchemaDescriptionByKey[key] = description;
                }
            }

            return {
                type: "Object",
                propertySchemaByKey: propertySchemaDescriptionByKey,
            };
        };

        const serializeInto = (value: Value, target: {[key: string]: SchemaSerializedValue}) => {
            if (validations !== null) {
                for (const {message, validate} of validations) {
                    if (!validate(value))
                        throw new InvalidArgumentError(`Validation failed: ${message}`);
                }
            }

            for (const [key, schema] of propertySchemaByKey) {
                const serializedKey = schema.serializedKey ?? key;
                schema.serializeProperty(target, serializedKey, (value as any)[key], key);
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
                    key,
                );

                if (keyValue !== objectSchemaMissingPropertySymbol) {
                    newValue[key] = keyValue;
                }
            }

            if (validations !== null) {
                for (const {message, validate} of validations) {
                    if (!validate(newValue))
                        throw new SchemaDeserializationError(`Validation failed: ${message}`);
                }
            }

            return newValue;
        };

        const validatePropertyByKey = new Map<string, (value: unknown) => void>(
            filterMapIterable(propertySchemaByKey, ([key, propertySchema]) => {
                if (propertySchema.validateProperty === null) return;
                return [key, propertySchema.validateProperty];
            }),
        );

        super({
            getDescription,
            serialize: value => {
                const newValue: {[key: string]: SchemaSerializedValue} = {};
                serializeInto(value, newValue);
                return newValue;
            },
            deserialize: deserializeInto,
            validate:
                (validations !== null && validations.length > 0) || validatePropertyByKey.size > 0
                    ? value => {
                          for (const [key, validateProperty] of validatePropertyByKey) {
                              validateProperty((value as any)[key]);
                          }

                          if (validations !== null) {
                              for (const {message, validate} of validations) {
                                  if (!validate(value))
                                      throw new InvalidArgumentError(
                                          `Validation failed: ${message}`,
                                      );
                              }
                          }
                      }
                    : null,
        });
        this.propertySchemaByKey = propertySchemaByKey;
        this._validations = validations;
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
                assert(
                    isIdentifier(key),
                    quote`Object schema key ${key} is not a valid ASCII identifier`,
                );
                return [key, schema instanceof Schema ? ObjectPropertySchema.wrap(schema) : schema];
            }),
        );

        return new ObjectSchema<ObjectSchemaConfigType<Config>>(propertySchemaByKey, null);
    }

    /**
     * Add a validation to this schema. Validations make sure `Value` is correct beyond
     * just structural correctness based on the TypeScript type. For example if you
     * have a `{min: number, max: number}` object and want to make sure `min` is always
     * less than `max` you'd add a validation to make sure this is always the case.
     *
     * The validation is checked at serialization and deserialization time.
     */
    public override validation<NewValue extends Value>(
        message: string,
        validate: (value: Value) => value is NewValue,
    ): ObjectSchema<NewValue>;
    public override validation(
        message: string,
        validate: (value: Value) => boolean,
    ): ObjectSchema<Value>;
    public override validation(
        message: string,
        validate: (value: Value) => boolean,
    ): ObjectSchema<Value> {
        return new ObjectSchema<Value>(this.propertySchemaByKey, [
            ...(this._validations ?? []),
            {message, validate},
        ]);
    }

    /**
     * Takes two object schemas and creates a new object schema with both of their
     * properties.
     *
     * If you have the same key in both schemas, then we check that the old property is
     * backwards compatible with the new property. That way, you can use `this` schema
     * to deserialize values from the merged schema since `this` schema is a supertype
     * of the merged schema.
     */
    public merge<OtherValue>(
        otherSchema: ObjectSchema<OtherValue>,
    ): ObjectSchema<Replace<Value, OtherValue>> {
        const propertySchemaByKey = new Map(this.propertySchemaByKey);

        for (const [key, newPropertySchema] of otherSchema.propertySchemaByKey) {
            const oldPropertySchema = propertySchemaByKey.get(key);

            if (oldPropertySchema) {
                checkSchemaBackwardsCompatibility(
                    {
                        type: "Object",
                        propertySchemaByKey: Object.fromEntries(
                            newPropertySchema.getDescription(
                                newPropertySchema.serializedKey ?? key,
                                key,
                            ),
                        ),
                    },
                    {
                        type: "Object",
                        propertySchemaByKey: Object.fromEntries(
                            oldPropertySchema.getDescription(
                                oldPropertySchema.serializedKey ?? key,
                                key,
                            ),
                        ),
                    },
                );
            }

            propertySchemaByKey.set(key, newPropertySchema);
        }

        return new ObjectSchema(
            propertySchemaByKey,
            // Merging validations is safe since we check all the properties being overridden
            // by `otherSchema` are compatible with the old properties.
            this._validations !== null || otherSchema._validations !== null
                ? ([...(this._validations ?? []), ...(otherSchema._validations ?? [])] as any)
                : null,
        );
    }

    /**
     * Omit certain keys from the object schema. Like the `Omit<T, K>` TypeScript
     * utility.
     */
    public omit<const Keys extends ReadonlyArray<string>>(
        keys: Keys,
    ): ObjectSchema<Omit<Value, Keys[number]>> {
        // We don't know whether validations will access the omitted properties so we don't
        // allow using `omit()` on a schema with validations.
        if (this._validations !== null && this._validations.length > 0) {
            throw new InternalError("Can\u2019t use `omit()` on object schema with validations");
        }

        const omitKeys = new Set(keys);

        return new ObjectSchema(
            new Map(
                filterMapIterable(this.propertySchemaByKey, ([key, propertySchema]) => {
                    if (omitKeys.has(key)) return;
                    return [key, propertySchema];
                }),
            ),
            null,
        );
    }

    /**
     * Makes all properties of the object schema optional. Like the `Partial<T>`
     * TypeScript utility.
     */
    public partial(): ObjectSchema<Partial<Value>> {
        // We don't know whether validations will access the required properties that are
        // now optional so we don't allow using `partial()` on a schema with validations.
        if (this._validations !== null && this._validations.length > 0) {
            throw new InternalError("Can\u2019t use `partial()` on object schema with validations");
        }

        return new ObjectSchema(
            new Map(
                mapIterable(this.propertySchemaByKey, ([key, propertySchema]) => [
                    key,
                    propertySchema.optional(),
                ]),
            ),
            null,
        );
    }

    /**
     * Schema combinator for running a migration that turns a property value into an
     * object.
     *
     * So for example, you can turn the following schema:
     *
     * ```ts
     * Schema.object({
     *     foo: Schema.integer,
     * });
     * ```
     *
     * ...into an object where `foo` is now represented by the property `a`:
     *
     * ```ts
     * Schema.object({
     *     foo: Schema.object({
     *         a: Schema.integer,
     *         b: Schema.string.nullable(),
     *     }).wrapOriginalPropertyInObject("a", {b: null}),
     * });
     * ```
     *
     * Useful if you want to add more data alongside some other property in your
     * schema.
     *
     * The serialized object looks like this:
     *
     * ```json
     * {
     *     "foo": 42,
     *     "foo2": {"b": "hello"}
     * }
     * ```
     *
     * The property `a` stays at the old position `foo` (so old code can deserialize
     * the object) whereas the new property is added to a new object `foo2`.
     *
     * If you use `originalPropertyKey()` to rename the property at the same time like
     * this:
     *
     * ```ts
     * Schema.object({
     *     bar: Schema.object({
     *         a: Schema.integer,
     *         b: Schema.string.nullable(),
     *     })
     *         .wrapOriginalPropertyInObject("a", {b: null})
     *         .originalPropertyKey("foo"),
     * });
     * ```
     *
     * ...then the serialized object looks like this:
     *
     * ```json
     * {
     *     "foo": 42,
     *     "bar": {"b": "hello"}
     * }
     * ```
     *
     * The second object with new properties has the new property key whereas the old
     * object has the old property key.
     */
    public wrapOriginalPropertyInObject<const Key extends keyof Value & string>(
        key: Key,
        defaultObject: DistributiveOmit<Value, Key>,
    ) {
        return ObjectPropertySchema._wrapOriginalPropertyInObject(this, key, defaultObject);
    }
}

export class ObjectPropertySchema<Value, SchemaValue extends Value> {
    /**
     * The key this property is written to in the serialized object. If null then we
     * use the key provided in the object schema definition.
     *
     * Must be a valid identifier (according to `isIdentifier()`).
     */
    public readonly serializedKey: string | null;

    /**
     * Get the description of the serialized property written by this schema.
     */
    public readonly getDescription: (
        key: string,
        schemaKey: string,
    ) => ReadonlyArray<readonly [string, SchemaSerializedObjectValuePropertyDescription]>;

    /**
     * The schema for our underlying value. Useful for static analysis.
     */
    public readonly valueSchema: Schema<SchemaValue>;

    /**
     * Serialize the property. We expect this function to actually write the property
     * to the provided `object`.
     *
     * - `object` is the new object we're writing to
     * - `key` is the key we're writing to
     * - `value` is the value we need to write after serializing
     */
    public readonly serializeProperty: (
        object: {[key: string]: SchemaSerializedValue | undefined},
        key: string,
        value: Value,
        schemaKey: string,
    ) => void;

    /**
     * Deserialize the property and return it.
     *
     * - `object` is the object we are deserializing from
     * - `key` is the key in `object` to deserialize
     *
     * If `schemaDeserializationMissingObjectPropertySymbol` is returned then we will
     * throw a schema deserialization error.
     */
    public readonly deserializeProperty: (
        object: SchemaSerializedObjectValue,
        key: string,
        schemaKey: string,
    ) => Value | typeof objectSchemaMissingPropertySymbol;

    /**
     * If the property is determined to be missing by a missing property combinator
     * (`optional()` and `default()`) then they run this function to figure out what
     * value to use. If this function returns `objectSchemaMissingPropertySymbol` then
     * we use whatever behavior was defined by the missing property combinator.
     */
    private readonly _deserializeMissingProperty:
        | ((
              object: SchemaSerializedObjectValue,
              key: string,
              schemaKey: string,
          ) => Value | typeof objectSchemaMissingPropertySymbol)
        | null;

    /**
     * Validates that any constraints for the schema are met beyond the schema's
     * TypeScript type.
     *
     * If the TypeScript type is enough to validate the property then this is null.
     */
    public readonly validateProperty: ((value: Value) => void) | null;

    private constructor({
        serializedKey,
        valueSchema,
        getDescription,
        serializeProperty,
        deserializeProperty,
        deserializeMissingProperty,
        validateProperty,
    }: {
        serializedKey: string | null;
        valueSchema: Schema<SchemaValue>;
        getDescription: (
            key: string,
            schemaKey: string,
        ) => ReadonlyArray<readonly [string, SchemaSerializedObjectValuePropertyDescription]>;
        serializeProperty: (
            object: {[key: string]: SchemaSerializedValue | undefined},
            key: string,
            value: Value,
            schemaKey: string,
        ) => void;
        deserializeProperty: (
            object: SchemaSerializedObjectValue,
            key: string,
            schemaKey: string,
        ) => Value | typeof objectSchemaMissingPropertySymbol;
        deserializeMissingProperty:
            | ((
                  object: SchemaSerializedObjectValue,
                  key: string,
                  schemaKey: string,
              ) => Value | typeof objectSchemaMissingPropertySymbol)
            | null;
        validateProperty: ((value: Value) => void) | null;
    }) {
        this.serializedKey = serializedKey;
        this.valueSchema = valueSchema;
        this.getDescription = getDescription;
        this.serializeProperty = serializeProperty;
        this.deserializeProperty = deserializeProperty;
        this._deserializeMissingProperty = deserializeMissingProperty;
        this.validateProperty = validateProperty;
    }

    /**
     * Wrap a schema into a required object property.
     */
    public static wrap<Value>(schema: Schema<Value>): ObjectPropertySchema<Value, Value> {
        return new ObjectPropertySchema({
            serializedKey: null,
            valueSchema: schema,
            getDescription: key => [[key, {valueSchema: schema.getDescription(), optional: false}]],
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
            deserializeMissingProperty: null,
            validateProperty: schema.validate,
        });
    }

    /** @see Schema.optional */
    public optional(): ObjectPropertySchema<Value | undefined, SchemaValue> {
        const {validateProperty} = this;

        const deserializeMissingProperty = this._deserializeMissingProperty;

        return new ObjectPropertySchema<Value | undefined, SchemaValue>({
            serializedKey: this.serializedKey,
            valueSchema: this.valueSchema,
            getDescription: (key, schemaKey) => {
                const descriptions = this.getDescription(key, schemaKey);

                return descriptions.map(description => {
                    if (description[0] !== key) return description;
                    return [description[0], {...description[1], optional: true}];
                });
            },
            serializeProperty: (object, key, value, schemaKey) => {
                if (value === undefined) return;
                this.serializeProperty(object, key, value, schemaKey);
            },
            deserializeProperty:
                deserializeMissingProperty === null
                    ? (object, key, schemaKey) => {
                          if (!hasOwnProperty(object, key) || object[key] === undefined) {
                              return objectSchemaMissingPropertySymbol;
                          }

                          return this.deserializeProperty(object, key, schemaKey);
                      }
                    : (object, key, schemaKey) => {
                          if (!hasOwnProperty(object, key) || object[key] === undefined) {
                              const deserializedValue = deserializeMissingProperty(
                                  object,
                                  key,
                                  schemaKey,
                              );

                              return deserializedValue;
                          }

                          return this.deserializeProperty(object, key, schemaKey);
                      },
            deserializeMissingProperty: null,
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
    public default(
        defaultValue: Value | ((serializedValue: SchemaSerializedObjectValue) => Value),
    ): ObjectPropertySchema<Value, SchemaValue> {
        // Validate that the default value actually matches our schema.
        if (typeof defaultValue !== "function") {
            this.validateProperty?.(defaultValue);
        }

        const deserializeMissingProperty = this._deserializeMissingProperty;

        return new ObjectPropertySchema({
            serializedKey: this.serializedKey,
            valueSchema: this.valueSchema,
            getDescription: (key, schemaKey) => {
                const descriptions = this.getDescription(key, schemaKey);

                return descriptions.map(description => {
                    if (description[0] !== key) return description;
                    return [description[0], {...description[1], optional: true}];
                });
            },
            serializeProperty: (object, key, value, schemaKey) => {
                this.serializeProperty(object, key, value, schemaKey);
            },
            deserializeProperty:
                deserializeMissingProperty === null
                    ? (object, key, schemaKey) => {
                          if (!hasOwnProperty(object, key) || object[key] === undefined) {
                              if (typeof defaultValue !== "function") {
                                  return defaultValue;
                              } else {
                                  const actualDefaultValue = (defaultValue as any)(object);
                                  this.validateProperty?.(actualDefaultValue);
                                  return actualDefaultValue;
                              }
                          }

                          return this.deserializeProperty(object, key, schemaKey);
                      }
                    : (object, key, schemaKey) => {
                          if (!hasOwnProperty(object, key) || object[key] === undefined) {
                              const deserializedValue = deserializeMissingProperty(
                                  object,
                                  key,
                                  schemaKey,
                              );

                              if (deserializedValue !== objectSchemaMissingPropertySymbol)
                                  return deserializedValue;

                              if (typeof defaultValue !== "function") {
                                  return defaultValue;
                              } else {
                                  const actualDefaultValue = (defaultValue as any)(object);
                                  this.validateProperty?.(actualDefaultValue);
                                  return actualDefaultValue;
                              }
                          }

                          return this.deserializeProperty(object, key, schemaKey);
                      },
            deserializeMissingProperty: null,
            validateProperty: this.validateProperty,
        });
    }

    /**
     * Same behavior as `Schema.nullable()` but can be used with an
     * `ObjectPropertySchema`.
     */
    public nullable(): ObjectPropertySchema<Value | null, SchemaValue> {
        const {validateProperty} = this;

        return new ObjectPropertySchema<Value | null, SchemaValue>({
            serializedKey: this.serializedKey,
            valueSchema: this.valueSchema,
            getDescription: (key, schemaKey) => {
                const descriptions = this.getDescription(key, schemaKey);

                return descriptions.map(description => {
                    if (description[0] !== key) return description;
                    return [
                        description[0],
                        {
                            ...description[1],
                            valueSchema: {type: "Nullable", schema: description[1].valueSchema},
                        },
                    ];
                });
            },
            serializeProperty: (object, key, value, schemaKey) => {
                if (value === null) {
                    object[key] = null;
                    return;
                }
                this.serializeProperty(object, key, value, schemaKey);
            },
            deserializeProperty: (object, key, schemaKey) => {
                if (object[key] === null) {
                    return null;
                }

                return this.deserializeProperty(object, key, schemaKey);
            },
            deserializeMissingProperty: this._deserializeMissingProperty,
            validateProperty: validateProperty
                ? value => {
                      if (value !== null) {
                          validateProperty(value);
                      }
                  }
                : null,
        });
    }

    /** @see Schema.originalPropertyKey */
    public originalPropertyKey(originalKey: string): ObjectPropertySchema<Value, SchemaValue> {
        assert(isIdentifier(originalKey));

        return new ObjectPropertySchema({
            serializedKey: originalKey,
            valueSchema: this.valueSchema,
            getDescription: this.getDescription,
            serializeProperty: this.serializeProperty,
            deserializeProperty: this.deserializeProperty,
            deserializeMissingProperty: this._deserializeMissingProperty,
            validateProperty: this.validateProperty,
        });
    }

    /**
     * Should only be called by `ObjectSchema.wrapOriginalPropertyInObject()`.
     */
    public static _wrapOriginalPropertyInObject<Value, Key extends keyof Value & string>(
        objectSchema: ObjectSchema<Value>,
        key: Key,
        defaultObject: DistributiveOmit<Value, Key>,
    ): ObjectPropertySchema<Value, Value> {
        assert(!hasOwnProperty(defaultObject, key));

        const propertySchema = assertExists(objectSchema.propertySchemaByKey.get(key));
        const objectSchemaWithoutKey = objectSchema.omit([key]);

        return new ObjectPropertySchema({
            serializedKey: null,
            valueSchema: objectSchema,
            getDescription: (serializedKey, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                const descriptions = propertySchema.getDescription(serializedKey, schemaKey);

                return [
                    ...descriptions,
                    [
                        serializedKey2,
                        {
                            valueSchema: objectSchemaWithoutKey.getDescription(),
                            optional: true,
                        },
                    ],
                ];
            },
            serializeProperty: (wrapperObject, serializedKey, value, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                wrapperObject[serializedKey2] = objectSchemaWithoutKey.serialize(value);

                propertySchema.serializeProperty(
                    wrapperObject,
                    serializedKey,
                    (value as any)[key],
                    schemaKey,
                );
            },
            deserializeProperty: (serializedWrapperObject, serializedKey, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                const serializedObject = hasOwnProperty(serializedWrapperObject, serializedKey2)
                    ? serializedWrapperObject[serializedKey2]
                    : undefined;

                const value = propertySchema.deserializeProperty(
                    serializedWrapperObject,
                    serializedKey,
                    schemaKey,
                );

                if (serializedObject === undefined) {
                    if (value === objectSchemaMissingPropertySymbol) {
                        return defaultObject as Value;
                    } else {
                        return {...defaultObject, [key]: value} as Value;
                    }
                } else {
                    return withSchemaDeserializationStackFrame(
                        {type: "ObjectProperty", key: serializedKey2},
                        () => {
                            const object = objectSchemaWithoutKey.deserialize(serializedObject);
                            if (value === objectSchemaMissingPropertySymbol) {
                                return object as Value;
                            } else {
                                return {...object, [key]: value} as Value;
                            }
                        },
                    );
                }
            },
            deserializeMissingProperty: null,
            validateProperty: objectSchema.validate,
        });
    }

    /**
     * Should only be called by `UnionSchema.wrapOriginalPropertyInUnionVariant()`.
     */
    public static _wrapOriginalPropertyInUnionVariant<
        Value extends {readonly type: string},
        Type extends Value["type"],
        Key extends keyof Extract<Value, {readonly type: Type}> & string,
    >(
        unionSchema: UnionSchema<Value>,
        type: Type,
        key: Key,
        defaultObject: DistributiveOmit<Extract<Value, {readonly type: Type}>, Key | "type">,
    ): ObjectPropertySchema<Value, Value> {
        // We assume the variant type is on the `type` property for the serialized and
        // deserialized objects.
        assert(unionSchema.hasDefaultSerializedTypeKey);
        assert(unionSchema.hasDefaultDeserializedTypeKey);

        assert(!hasOwnProperty(defaultObject, key));
        assert(!hasOwnProperty(defaultObject, "type"));

        const variantSchema = assertExists(unionSchema.variantSchemaByType.get(type));
        const variantObjectSchema = variantSchema.schema;
        assert(variantObjectSchema instanceof ObjectSchema);
        const propertySchema = assertExists(variantObjectSchema.propertySchemaByKey.get(key));
        const variantObjectSchemaWithoutKey = variantObjectSchema.omit([key]);

        return new ObjectPropertySchema({
            serializedKey: null,
            valueSchema: unionSchema,
            getDescription: (serializedKey, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                // Both `serializedKey` and `serializedKey2` are optional properties but you must
                // have one or the other (and sometimes both) to correctly deserialize this schema.
                const descriptions = propertySchema
                    .getDescription(serializedKey, schemaKey)
                    .map(description => {
                        if (description[0] !== serializedKey) return description;
                        return [description[0], {...description[1], optional: true}] as const;
                    });

                return [
                    ...descriptions,
                    [
                        serializedKey2,
                        {
                            valueSchema: variantObjectSchemaWithoutKey.getDescription(),
                            optional: true,
                        },
                    ],
                ];
            },
            serializeProperty: (wrapperObject, serializedKey, value, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                if (value.type !== type) {
                    wrapperObject[serializedKey2] = unionSchema.serialize(value);
                } else {
                    wrapperObject[serializedKey2] = variantObjectSchemaWithoutKey.serialize(
                        value as any,
                    );

                    propertySchema.serializeProperty(
                        wrapperObject,
                        serializedKey,
                        (value as any)[key],
                        schemaKey,
                    );
                }
            },
            deserializeProperty: (serializedWrapperObject, serializedKey, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                const serializedObject = hasOwnProperty(serializedWrapperObject, serializedKey2)
                    ? serializedWrapperObject[serializedKey2]
                    : undefined;

                if (
                    serializedObject !== undefined &&
                    isObject(serializedObject) &&
                    serializedObject.type !== type
                ) {
                    return withSchemaDeserializationStackFrame(
                        {type: "ObjectProperty", key: serializedKey2},
                        () => unionSchema.deserialize(serializedObject),
                    );
                }

                const value = propertySchema.deserializeProperty(
                    serializedWrapperObject,
                    serializedKey,
                    schemaKey,
                );

                if (serializedObject === undefined) {
                    if (value === objectSchemaMissingPropertySymbol) {
                        return {...defaultObject, type} as any as Value;
                    } else {
                        return {...defaultObject, type, [key]: value} as any as Value;
                    }
                } else {
                    return withSchemaDeserializationStackFrame(
                        {type: "ObjectProperty", key: serializedKey2},
                        () => {
                            const object =
                                variantObjectSchemaWithoutKey.deserialize(serializedObject);
                            if (value === objectSchemaMissingPropertySymbol) {
                                return object as Value;
                            } else {
                                return {...object, [key]: value} as Value;
                            }
                        },
                    );
                }
            },
            deserializeMissingProperty: (serializedWrapperObject, serializedKey, schemaKey) => {
                const serializedKey2 =
                    schemaKey !== serializedKey ? schemaKey : `${serializedKey}2`;

                const serializedObject = hasOwnProperty(serializedWrapperObject, serializedKey2)
                    ? serializedWrapperObject[serializedKey2]
                    : undefined;

                // If the migrated property is missing but we have a secondary union object
                // property that's a different type then the one we're migrating to then
                // deserialize the secondary union object.
                if (
                    serializedObject !== undefined &&
                    isObject(serializedObject) &&
                    serializedObject.type !== type
                ) {
                    return withSchemaDeserializationStackFrame(
                        {type: "ObjectProperty", key: serializedKey2},
                        () => unionSchema.deserialize(serializedObject),
                    );
                }

                return objectSchemaMissingPropertySymbol;
            },
            validateProperty: unionSchema.validate,
        });
    }
}

type ValueSchemaValueBase = null | boolean | number | string | Date;

/**
 * Schema that only permits a single value.
 *
 * You should only create this with `Schema.value()`.
 */
export class ValueSchema<Value extends ValueSchemaValueBase> extends Schema<Value> {
    /**
     * The only value this schema permits. This is the value at runtime and may not be
     * the value that is serialized.
     *
     * Useful for static analysis.
     */
    public readonly value: Value;

    /**
     * The value that is serialized. May be the same as our runtime value or may be
     * different.
     */
    public readonly serializedValue: null | boolean | number | string;

    private constructor(value: Value, serializedValue: null | boolean | number | string) {
        super({
            getDescription: () => ({
                type: "Value",
                value: serializedValue,
            }),
            serialize: () => serializedValue,
            deserialize: actualValue => {
                if (!Object.is(actualValue, serializedValue)) {
                    throw new SchemaDeserializationError(
                        quote`Expected value to be ${serializedValue}`,
                    );
                }
                return value;
            },
            validate: null,
        });
        this.value = value;
        this.serializedValue = serializedValue;
    }

    /**
     * Prefer `Schema.value()` which directly calls this method.
     */
    public static _new<Value extends ValueSchemaValueBase>(value: Value) {
        return new ValueSchema(value, value instanceof Date ? serializeDateString(value) : value);
    }

    /**
     * The original value of this schema. We will use the original value in
     * serialization and deserialization to not break old types.
     */
    public originalValue(serializedValue: null | string | number | boolean): ValueSchema<Value> {
        return new ValueSchema(this.value, serializedValue);
    }
}

/**
 * You need to recursively pass this type into itself when declaring. So
 * `Config extends UnionSchemaObjectConfigBase<Config>`.
 */
export type UnionSchemaObjectConfigBase<Config> = {
    [Key in keyof Config]: Schema<any> & {
        // We need to put our `Key` type constraint on `deserialize` instead of the type
        // parameter so the object type can be covariant instead of invariant.
        deserialize: (value: SchemaSerializedValue) => {type: Key};
    };
};

export type UnionSchemaObjectConfigType<Config extends UnionSchemaObjectConfigBase<Config>> =
    SchemaType<Config[keyof Config]>;

export type UnionSchemaObjectConfigWithKeyBase<TypeKey extends string, Config> = {
    [Key in keyof Config]: Schema<any> & {
        // We need to put our `Key` type constraint on `deserialize` instead of the type
        // parameter so the object type can be covariant instead of invariant.
        deserialize: (value: SchemaSerializedValue) => Record<TypeKey, Key>;
    };
};

export type UnionSchemaObjectConfigWithKeyType<
    TypeKey extends string,
    Config extends UnionSchemaObjectConfigWithKeyBase<TypeKey, Config>,
> = SchemaType<Config[keyof Config]>;

/**
 * Schema for a union object value.
 *
 * You should only create this with `Schema.union()`.
 */
export class UnionSchema<Value> extends Schema<Value> {
    /**
     * The schema for every union variant in our object.
     *
     * Useful for static analysis.
     *
     * Types must be valid identifiers (according to `isIdentifier()`).
     */
    public readonly variantSchemaByType: ReadonlyMap<string, UnionSchemaVariant<Value>>;

    /**
     * The key for determining what union type we're looking at in the serialized
     * object. Defaults to `type`.
     */
    private readonly _serializedTypeKey: string;

    /**
     * Do we have the default `type` serialized key or something custom?
     */
    public get hasDefaultSerializedTypeKey(): boolean {
        return this._serializedTypeKey === "type";
    }

    /**
     * Do we have the default `type` deserialized key or something custom?
     */
    public readonly hasDefaultDeserializedTypeKey: boolean;

    /**
     * Serialize the value. Will always serialize into an object value.
     */
    declare public readonly serialize: (value: Value) => SchemaSerializedObjectValue;

    private constructor({
        variantSchemaByType,
        serializedTypeKey,
        hasDefaultDeserializedTypeKey,
        getDescription,
        serialize,
        deserialize,
        validate,
    }: {
        variantSchemaByType: ReadonlyMap<string, UnionSchemaVariant<Value>>;
        serializedTypeKey: string;
        hasDefaultDeserializedTypeKey: boolean;
        getDescription: () => SchemaSerializedValueDescription;
        serialize: (value: Value) => SchemaSerializedValue;
        deserialize: (serializedValue: SchemaSerializedValue) => Value;
        validate: ((value: Value) => void) | null;
    }) {
        super({
            getDescription,
            serialize,
            deserialize,
            validate,
        });
        this.variantSchemaByType = variantSchemaByType;
        this._serializedTypeKey = serializedTypeKey;
        this.hasDefaultDeserializedTypeKey = hasDefaultDeserializedTypeKey;
    }

    /**
     * Prefer `Schema.union()` which directly calls this method.
     *
     * By convention `Schema.union()` only supports `ObjectSchema`s which we can
     * introspect. If you want to build a union with non-`ObjectSchema`s then you may
     * use this method which allows you to customize how the is type is found on
     * arbitrary values.
     */
    public static _new<Config extends UnionSchemaObjectConfigBase<Config>>(
        config: Config,
        options?: {
            getType?: undefined;
            serializedTypeKey?: string;
            deserializedTypeKey?: string;
        },
    ): UnionSchema<UnionSchemaObjectConfigType<Config>>;
    public static _new<Config extends {[key: string]: Schema<any> | UnionSchemaVariant<any>}>(
        config: Config,
        options: {
            getType: (value: SchemaType<Config[keyof Config]>) => keyof Config;
            serializedTypeKey?: string;
            deserializedTypeKey?: string;
        },
    ): UnionSchema<SchemaType<Config[keyof Config]>>;
    public static _new<Config extends {[key: string]: Schema<any> | UnionSchemaVariant<any>}>(
        config: Config,
        {
            getType,
            serializedTypeKey = "type",
            deserializedTypeKey = "type",
        }: {
            getType?: (value: SchemaType<Config[keyof Config]>) => keyof Config;
            serializedTypeKey?: string;
            deserializedTypeKey?: string;
        } = {},
    ): UnionSchema<SchemaType<Config[keyof Config]>> {
        const schemaEntries = Object.entries(config);

        const schemaByType = new Map<string, UnionSchemaVariant<SchemaType<Config[keyof Config]>>>(
            schemaEntries.map(([type, schema]) => {
                assert(isIdentifier(type));

                let serializedTypeValue: string | number | boolean | null = type;
                if (getType === undefined && schema instanceof ObjectSchema) {
                    const typePropertySchema = schema.propertySchemaByKey.get(deserializedTypeKey);
                    assert(
                        typePropertySchema?.valueSchema instanceof ValueSchema,
                        quote`Expected value schema for union variant\u2019s ${deserializedTypeKey} property`,
                    );

                    const actualType = typePropertySchema.valueSchema.value;
                    serializedTypeValue = typePropertySchema.valueSchema.serializedValue;
                    assert(
                        typeof actualType === "string" && isIdentifier(actualType),
                        "Expected type to be an identifier string",
                    );
                    assert(
                        typeof serializedTypeValue === "string" &&
                            isIdentifier(serializedTypeValue),
                        "Expected serialized type to be an identifier string",
                    );
                    assert(
                        actualType === type,
                        quote`Expected value schema for union variant\u2019s ${deserializedTypeKey} property to be ${type}`,
                    );
                }

                const variantSchema =
                    schema instanceof UnionSchemaVariant
                        ? schema
                        : new UnionSchemaVariant({
                              schema,
                              type,
                              serializedTypeKey,
                              serializedTypeValue,
                              deserializedTypeKey,
                          });

                assert(variantSchema.serializedTypeKey === serializedTypeKey);
                assert(variantSchema.deserializedTypeKey === deserializedTypeKey);

                return [type, variantSchema];
            }),
        );

        const schemaBySerializedTypeValue = new Map<
            string,
            UnionSchemaVariant<SchemaType<Config[keyof Config]>>
        >(Array.from(schemaByType.values(), schema => [schema.serializedTypeValue, schema]));

        const validateByType = new Map<string, (value: SchemaType<Config[keyof Config]>) => void>(
            filterMapIterable(schemaByType, ([type, {schema}]) => {
                if (schema.validate === null) return;
                return [type, schema.validate];
            }),
        );

        return new UnionSchema<SchemaType<Config[keyof Config]>>({
            variantSchemaByType: schemaByType,
            serializedTypeKey,
            hasDefaultDeserializedTypeKey: getType === undefined && deserializedTypeKey === "type",
            getDescription: () => ({
                type: "Union",
                typeKey: serializedTypeKey,
                variantSchemaByTypeValue: Object.fromEntries(
                    Array.from(schemaByType.values(), ({schema, serializedTypeValue}) => [
                        serializedTypeValue,
                        schema.getDescription(),
                    ]),
                ),
            }),
            serialize: value => {
                const type =
                    getType !== undefined ? getType(value) : (value as any)[deserializedTypeKey];
                const schema = schemaByType.get(type);
                assert(schema);
                return schema.serialize(value);
            },
            deserialize: value => {
                if (
                    typeof value !== "object" ||
                    value === null ||
                    isReadonlyArray(value) ||
                    value instanceof Uint8Array
                ) {
                    throw new SchemaDeserializationError("Expected an object");
                }

                if (
                    !hasOwnProperty(value, serializedTypeKey) ||
                    typeof value[serializedTypeKey] !== "string"
                ) {
                    throw new SchemaDeserializationError(
                        `Required property \`${serializedTypeKey}\` not found`,
                    );
                }

                // Use the type to select the schema we'll use to parse the value.
                const serializedTypeValue = value[serializedTypeKey];

                // Always use the serialized type name, never use the current type name in code. We
                // don't have code that will serialize using the current type name.
                //
                // This makes static analysis on the schema a bit easier. Since we don't need to
                // consider two possible types.
                //
                // We may want to consider a migration path in the future where both types are
                // temporarily allowed until one type fully replaces the other.
                const schema = schemaBySerializedTypeValue.get(serializedTypeValue);
                if (schema === undefined) throw new SchemaDeserializationError("Unknown type");

                return schema.deserialize(value) as any;
            },
            validate:
                validateByType.size > 0
                    ? value => {
                          const type =
                              getType !== undefined
                                  ? getType(value)
                                  : (value as any)[deserializedTypeKey];
                          const validate = validateByType.get(type);
                          validate?.(value);
                      }
                    : null,
        });
    }

    /**
     * Set the default variant for the union. You use this when you're converting an
     * object schema (`Schema.object()`) to a union schema (`Schema.union()`). Any old
     * objects we're deserializing that don't have a type property will be interpreted
     * as a union variant with the provided type.
     */
    public defaultVariant(type: string): UnionSchema<Value> {
        assert(this.variantSchemaByType.has(type));

        return new UnionSchema<Value>({
            variantSchemaByType: this.variantSchemaByType,
            serializedTypeKey: this._serializedTypeKey,
            hasDefaultDeserializedTypeKey: this.hasDefaultDeserializedTypeKey,
            getDescription: () => ({
                ...this.getDescription(),
                defaultTypeValue: type,
            }),
            serialize: this.serialize,
            deserialize: value => {
                if (
                    typeof value !== "object" ||
                    value === null ||
                    isReadonlyArray(value) ||
                    value instanceof Uint8Array
                ) {
                    throw new SchemaDeserializationError("Expected an object");
                }

                // If the serialized object doesn't have a type property then create a new object
                // with the default type and continue deserialization.
                if (
                    !hasOwnProperty(value, this._serializedTypeKey) ||
                    typeof value[this._serializedTypeKey] !== "string"
                ) {
                    return this.deserialize({...value, [this._serializedTypeKey]: type});
                }

                return this.deserialize(value);
            },
            validate: this.validate,
        });
    }

    /**
     * Same as `ObjectSchema.wrapOriginalPropertyInObject()` but for unions. See the
     * documentation on `ObjectSchema.wrapOriginalPropertyInObject()`.
     */
    public wrapOriginalPropertyInUnionVariant<
        Value extends {readonly type: string},
        const Type extends Value["type"],
        const Key extends keyof Extract<Value, {readonly type: Type}> & string,
    >(
        this: UnionSchema<Value>,
        type: Type,
        key: Key,
        defaultObject: DistributiveOmit<Extract<Value, {readonly type: Type}>, Key | "type">,
    ) {
        return ObjectPropertySchema._wrapOriginalPropertyInUnionVariant(
            this,
            type,
            key,
            defaultObject,
        );
    }
}

/**
 * An intermediate object we use for renaming union schema variants.
 */
export class UnionSchemaVariant<Value> {
    /**
     * The underlying schema for the union variant.
     */
    public readonly schema: Schema<Value>;

    /**
     * The value we use when at runtime for the `type` property.
     */
    public readonly type: string;

    /**
     * The key we use for the serialized type property.
     */
    public readonly serializedTypeKey: string;

    /**
     * The value we use when we serialize the type property.
     */
    public readonly serializedTypeValue: string;

    /**
     * The key we use for the deserialized type property. Defaults to "type". If a
     * `getType()` function is provided in union schema initialization then this is
     * only used for debugging.
     */
    public readonly deserializedTypeKey: string;

    constructor({
        schema,
        type,
        serializedTypeKey,
        serializedTypeValue,
        deserializedTypeKey,
    }: {
        schema: Schema<Value>;
        type: string;
        serializedTypeKey: string;
        serializedTypeValue: string;
        deserializedTypeKey: string;
    }) {
        assert(isIdentifier(type));
        assert(!serializedTypeValue || isIdentifier(serializedTypeValue));

        this.schema = schema;
        this.type = type;
        this.serializedTypeKey = serializedTypeKey;
        this.serializedTypeValue = serializedTypeValue;
        this.deserializedTypeKey = deserializedTypeKey;
    }

    public serialize(value: Value): SchemaSerializedObjectValue {
        const serializedValue = this.schema.serialize(value) as SchemaSerializedObjectValue;
        (serializedValue as any)[this.serializedTypeKey] = this.serializedTypeValue;
        return serializedValue;
    }

    public deserialize(value: SchemaSerializedValue): Value {
        if (typeof value !== "object" || value === null)
            throw new SchemaDeserializationError("Expected an object");

        if (!hasOwnProperty(value, this.serializedTypeKey))
            throw new SchemaDeserializationError(
                `Required property \`${this.serializedTypeKey}\` not found`,
            );

        if (value[this.serializedTypeKey] !== this.serializedTypeValue)
            throw new SchemaDeserializationError(
                `Expected \`${this.serializedTypeKey}\` property to equal ${JSON.stringify(
                    this.serializedTypeValue,
                )}`,
            );

        return withSchemaDeserializationStackFrame(
            {
                type: "UnionVariant",
                typeKey: this.deserializedTypeKey,
                typeValue: this.type,
            },
            () => this.schema.deserialize(value) as any,
        );
    }
}

// Needs to be exported so `.d.ts` generation can find it.
export class StringSchema extends Schema<string> {
    public static override string = new StringSchema({
        getDescription: () => ({type: "String"}),
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "string") throw new SchemaDeserializationError("Expected string");
            return value;
        },
        validate: null,
    });

    public override readonly validate:
        | ((value: string, options?: {errorDisplayMessagePrefix?: ErrorDisplayMessage}) => void)
        | null;

    protected constructor({
        getDescription,
        serialize,
        deserialize,
        validate,
    }: {
        getDescription: () => SchemaSerializedValueDescription;
        serialize: (value: string) => SchemaSerializedValue;
        deserialize: (serializedValue: SchemaSerializedValue) => string;
        validate:
            | ((value: string, options?: {errorDisplayMessagePrefix?: ErrorDisplayMessage}) => void)
            | null;
    }) {
        super({getDescription, serialize, deserialize, validate});
        this.validate = validate;
    }

    public _transformString({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: string) => string;
        deserialize: (value: string) => string;
        validate:
            | ((value: string, options?: {errorDisplayMessagePrefix?: ErrorDisplayMessage}) => void)
            | null;
    }): StringSchema {
        const {validate: oldValidate} = this;

        return new StringSchema({
            getDescription: () => this.getDescription(),
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
                    ? (value, options) => {
                          oldValidate?.(value, options);
                          newValidate?.(value, options);
                      }
                    : null,
        });
    }

    /**
     * Verifies that the length of the string is greater than or equal to the provided
     * length.
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
            validate: (value, {errorDisplayMessagePrefix} = {}) => {
                if (value.length < length)
                    throw new InvalidArgumentError(
                        `Expected string to have a length greater than or equal to ${length}`,
                        {
                            displayMessage: errorDisplayMessagePrefix
                                ? value.length === 0
                                    ? errorDisplayMessage`${errorDisplayMessagePrefix} is empty.`
                                    : errorDisplayMessage`${errorDisplayMessagePrefix} is too short.`
                                : undefined,
                        },
                    );
            },
        });
    }

    /**
     * Verifies that the length of the string is less than or equal to the provided
     * length.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public maxLength(length: number): StringSchema {
        return this._transformString({
            serialize: value => {
                if (value.length > length) {
                    throw new InvalidArgumentError(
                        `Expected string to have a length less than or equal to ${length}`,
                    );
                }

                return value;
            },
            deserialize: value => {
                if (value.length > length) {
                    throw new SchemaDeserializationError(
                        `Expected string to have a length less than or equal to ${length}`,
                    );
                }

                return value;
            },
            validate: (value, {errorDisplayMessagePrefix} = {}) => {
                if (value.length > length) {
                    throw new InvalidArgumentError(
                        `Expected string to have a length less than or equal to ${length}`,
                        {
                            displayMessage: errorDisplayMessagePrefix
                                ? errorDisplayMessage`${errorDisplayMessagePrefix} is too long.`
                                : undefined,
                        },
                    );
                }
            },
        });
    }

    /**
     * Verifies that an string is greater than or equal to the provided value.
     */
    public min(string: string): StringSchema {
        return this._transformString({
            serialize: value => {
                if (value < string)
                    throw new InvalidArgumentError(
                        `Expected string to be greater than or equal to ${JSON.stringify(string)}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value < string)
                    throw new SchemaDeserializationError(
                        `Expected string to be greater than or equal to ${JSON.stringify(string)}`,
                    );

                return value;
            },
            validate: value => {
                if (value < string)
                    throw new InvalidArgumentError(
                        `Expected string to be greater than or equal to ${JSON.stringify(string)}`,
                    );
            },
        });
    }

    /**
     * Verifies that a string is less than or equal to the provided value.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public max(string: string): StringSchema {
        return this._transformString({
            serialize: value => {
                if (value > string)
                    throw new InvalidArgumentError(
                        `Expected string to be less than or equal to ${JSON.stringify(string)}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value > string)
                    throw new SchemaDeserializationError(
                        `Expected string to be less than or equal to ${JSON.stringify(string)}`,
                    );

                return value;
            },
            validate: value => {
                if (value > string)
                    throw new InvalidArgumentError(
                        `Expected string to be less than or equal to ${JSON.stringify(string)}`,
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
            validate: (value, {errorDisplayMessagePrefix} = {}) => {
                if (/[\n\r]/g.test(value))
                    throw new InvalidArgumentError("Expected single line string", {
                        displayMessage: errorDisplayMessagePrefix
                            ? errorDisplayMessage`${errorDisplayMessagePrefix} should be a single line.`
                            : undefined,
                    });
            },
        });
    }

    /**
     * Transforms a value by removing the whitespace from the start and end of the
     * string.
     */
    // NOTE(calebmer): It's important that this runs before length validations since it
    // may change the length of the string. Right now users need to manually order
    // their combinators correctly. Can we do this automatically?
    public trim(): StringSchema {
        return this._transformString({
            serialize: value => value.trim(),
            deserialize: value => value.trim(),
            validate: (value, {errorDisplayMessagePrefix} = {}) => {
                if (value !== value.trim())
                    throw new InvalidArgumentError(
                        "Expected string to not have whitespace at the start or end",
                        {
                            displayMessage: errorDisplayMessagePrefix
                                ? errorDisplayMessage`${errorDisplayMessagePrefix} should not start or end with whitespaces.`
                                : undefined,
                        },
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
            validate: (value, {errorDisplayMessagePrefix} = {}) => {
                if (value !== value.toLowerCase())
                    throw new InvalidArgumentError("Expected string to be lower case", {
                        displayMessage: errorDisplayMessagePrefix
                            ? errorDisplayMessage`${errorDisplayMessagePrefix} should only use lower case characters.`
                            : undefined,
                    });
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

// Needs to be exported so `.d.ts` generation can find it.
export class FloatSchema extends Schema<number> {
    public static override float = new FloatSchema({
        getDescription: () => ({type: "Float"}),
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "number") throw new SchemaDeserializationError("Expected number");
            return value;
        },
        validate: null,
    });

    private _transformNumber({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: number) => number;
        deserialize: (value: number) => number;
        validate: ((value: number) => void) | null;
    }): FloatSchema {
        const {validate: oldValidate} = this;

        return new FloatSchema({
            getDescription: () => this.getDescription(),
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
     * Verifies that a float is greater than or equal to the provided value.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public min(number: number): FloatSchema {
        return this._transformNumber({
            serialize: value => {
                if (value < number)
                    throw new InvalidArgumentError(
                        `Expected float to be greater than or equal to ${number}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value < number)
                    throw new SchemaDeserializationError(
                        `Expected float to be greater than or equal to ${number}`,
                    );

                return value;
            },
            validate: value => {
                if (value < number)
                    throw new InvalidArgumentError(
                        `Expected float to be greater than or equal to ${number}`,
                    );
            },
        });
    }

    /**
     * Verifies that a float is less than or equal to the provided value.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public max(number: number): FloatSchema {
        return this._transformNumber({
            serialize: value => {
                if (value > number)
                    throw new InvalidArgumentError(
                        `Expected float to be less than or equal to ${number}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value > number)
                    throw new SchemaDeserializationError(
                        `Expected float to be less than or equal to ${number}`,
                    );

                return value;
            },
            validate: value => {
                if (value > number)
                    throw new InvalidArgumentError(
                        `Expected float to be less than or equal to ${number}`,
                    );
            },
        });
    }
}

// Avoid circular dependency between `Schema` and `FloatSchema`.
Schema.float = FloatSchema.float;

// Needs to be exported so `.d.ts` generation can find it.
export class IntegerSchema extends Schema<number> {
    public static override integer = new IntegerSchema({
        getDescription: () => ({type: "Integer"}),
        serialize: value => {
            if (!Number.isSafeInteger(value)) {
                throw new InvalidArgumentError("Expected integer");
            }

            return value;
        },
        deserialize: value => {
            if (typeof value !== "number") throw new SchemaDeserializationError("Expected number");

            if (!Number.isSafeInteger(value)) {
                throw new SchemaDeserializationError("Expected integer");
            }

            return value;
        },
        validate: value => {
            if (!Number.isSafeInteger(value)) {
                throw new InvalidArgumentError("Expected integer");
            }
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
            getDescription: () => this.getDescription(),
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

// Needs to be exported so `.d.ts` generation can find it.
export class BytesSchema extends Schema<Uint8Array> {
    public static override bytes = new BytesSchema({
        getDescription: () => ({type: "Bytes"}),
        serialize: value => {
            if (value instanceof JsonStringifiableUint8Array) return value;
            return new JsonStringifiableUint8Array(
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now.
                // @ts-expect-error
                value.buffer,
                value.byteOffset,
                value.byteLength,
            );
        },
        deserialize: value => {
            if (value instanceof Uint8Array) return value;

            if (typeof value !== "string")
                throw new SchemaDeserializationError("Expected a `Uint8Array` or base64 string");

            try {
                return decodeBase64(value);
            } catch {
                throw new SchemaDeserializationError("Unable to parse base64 string");
            }
        },
        validate: null,
    });

    private _transformBytes({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: Uint8Array) => Uint8Array;
        deserialize: (value: Uint8Array) => Uint8Array;
        validate: ((value: Uint8Array) => void) | null;
    }): BytesSchema {
        const {validate: oldValidate} = this;

        return new BytesSchema({
            getDescription: () => this.getDescription(),
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
     * Verifies that binary data has at least this many bytes.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public minLength(byteLength: number): BytesSchema {
        return this._transformBytes({
            serialize: value => {
                if (value.byteLength > byteLength)
                    throw new InvalidArgumentError(
                        `Expected bytes to have a byte length less than or equal to ${byteLength}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.byteLength > byteLength)
                    throw new SchemaDeserializationError(
                        `Expected bytes to have a byte length less than or equal to ${byteLength}`,
                    );

                return value;
            },
            validate: value => {
                if (value.byteLength > byteLength)
                    throw new InvalidArgumentError(
                        `Expected bytes to have a byte length less than or equal to ${byteLength}`,
                    );
            },
        });
    }

    /**
     * Verifies that binary data has at most this many bytes.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public maxLength(byteLength: number): BytesSchema {
        return this._transformBytes({
            serialize: value => {
                if (value.byteLength < byteLength)
                    throw new InvalidArgumentError(
                        `Expected bytes to have a byte length greater than or equal to ${byteLength}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.byteLength < byteLength)
                    throw new SchemaDeserializationError(
                        `Expected bytes to have a byte length greater than or equal to ${byteLength}`,
                    );

                return value;
            },
            validate: value => {
                if (value.byteLength < byteLength)
                    throw new InvalidArgumentError(
                        `Expected bytes to have a byte length greater than or equal to ${byteLength}`,
                    );
            },
        });
    }

    /**
     * Verifies that binary data has exactly this many bytes.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public fixedLength(byteLength: number): BytesSchema {
        return this._transformBytes({
            serialize: value => {
                if (value.byteLength !== byteLength)
                    throw new InvalidArgumentError(
                        `Expected bytes to have a byte length equal to ${byteLength}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.byteLength !== byteLength)
                    throw new SchemaDeserializationError(
                        `Expected bytes to have a byte length equal to ${byteLength}`,
                    );

                return value;
            },
            validate: value => {
                if (value.byteLength !== byteLength)
                    throw new InvalidArgumentError(
                        `Expected bytes to have a byte length equal to ${byteLength}`,
                    );
            },
        });
    }
}

// Avoid circular dependency between `Schema` and `IntegerSchema`.
Schema.bytes = BytesSchema.bytes;

/**
 * Schema for a set value.
 *
 * You should only create this with `Schema.set()`.
 */
export class SetSchema<Value> extends Schema<ReadonlySet<Value>> {
    /**
     * Prefer `Schema.set()` which directly calls this method.
     */
    public static _new<Value>(itemSchema: Schema<Value>): SetSchema<Value> {
        const {validate} = itemSchema;

        return new SetSchema<Value>({
            getDescription: () => ({
                type: "Set",
                valueSchema: itemSchema.getDescription(),
            }),
            serialize: value => {
                // Optimization: Don't allocate an empty array object if we're serializing an empty
                // array.
                if (value.size === 0) return emptyArray;

                return Array.from(value, item => itemSchema.serialize(item));
            },
            deserialize: value => {
                if (!Array.isArray(value))
                    throw new SchemaDeserializationError("Expected an array");

                // Optimization: Don't allocate an empty set object if we're deserializing an empty
                // array.
                if (value.length === 0) return emptySet;

                return new Set(value.map(item => itemSchema.deserialize(item)));
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

    private _transformSet({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: ReadonlySet<Value>) => ReadonlySet<Value>;
        deserialize: (value: ReadonlySet<Value>) => ReadonlySet<Value>;
        validate: ((value: ReadonlySet<Value>) => void) | null;
    }): SetSchema<Value> {
        const {validate: oldValidate} = this;

        return new SetSchema({
            getDescription: () => this.getDescription(),
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
     * Verifies that the size of the set is greater than or equal to the provided size.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public minSize(size: number): SetSchema<Value> {
        return this._transformSet({
            serialize: value => {
                if (value.size < size)
                    throw new InvalidArgumentError(
                        `Expected set to have a size greater than or equal to ${size}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.size < size)
                    throw new SchemaDeserializationError(
                        `Expected set to have a size greater than or equal to ${size}`,
                    );

                return value;
            },
            validate: value => {
                if (value.size < size)
                    throw new InvalidArgumentError(
                        `Expected set to have a size greater than or equal to ${size}`,
                    );
            },
        });
    }

    /**
     * Verifies that the size of the set is less than or equal to the provided size.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public maxSize(size: number): SetSchema<Value> {
        return this._transformSet({
            serialize: value => {
                if (value.size > size)
                    throw new InvalidArgumentError(
                        `Expected set to have a size less than or equal to ${size}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.size > size)
                    throw new SchemaDeserializationError(
                        `Expected set to have a size less than or equal to ${size}`,
                    );

                return value;
            },
            validate: value => {
                if (value.size > size)
                    throw new InvalidArgumentError(
                        `Expected set to have a size less than or equal to ${size}`,
                    );
            },
        });
    }
}

/**
 * Schema for a map value.
 *
 * You should only create this with `Schema.map()`.
 */
export class MapSchema<Key, Value> extends Schema<ReadonlyMap<Key, Value>> {
    /**
     * Prefer `Schema.map()` which directly calls this method.
     */
    public static _new<Key, Value>(
        keySchema: Schema<Key>,
        valueSchema: Schema<Value>,
    ): MapSchema<Key, Value> {
        const {validate: validateKey} = keySchema;
        const {validate: validateValue} = valueSchema;

        return new MapSchema<Key, Value>({
            getDescription: () => ({
                type: "Map",
                keySchema: keySchema.getDescription(),
                valueSchema: valueSchema.getDescription(),
            }),
            serialize: value => {
                // Optimization: Don't allocate an empty array object if we're serializing an empty
                // array.
                if (value.size === 0) return emptyArray;

                return Array.from(value, ([key, keyValue]) => [
                    keySchema.serialize(key),
                    valueSchema.serialize(keyValue),
                ]);
            },
            deserialize: value => {
                if (!Array.isArray(value))
                    throw new SchemaDeserializationError("Expected an array");

                // Optimization: Don't allocate an empty map object if we're deserializing an empty
                // array.
                if (value.length === 0) return emptyMap;

                return new Map(
                    value.map((item): [Key, Value] => {
                        if (!Array.isArray(item) || item.length !== 2)
                            throw new SchemaDeserializationError(
                                "Expected an array with two items",
                            );

                        return [keySchema.deserialize(item[0]), valueSchema.deserialize(item[1])];
                    }),
                );
            },
            validate:
                validateKey || validateValue
                    ? value => {
                          for (const [key, keyValue] of value) {
                              validateKey?.(key);
                              validateValue?.(keyValue);
                          }
                      }
                    : null,
        });
    }

    private _transformMap({
        serialize,
        deserialize,
        validate: newValidate,
    }: {
        serialize: (value: ReadonlyMap<Key, Value>) => ReadonlyMap<Key, Value>;
        deserialize: (value: ReadonlyMap<Key, Value>) => ReadonlyMap<Key, Value>;
        validate: ((value: ReadonlyMap<Key, Value>) => void) | null;
    }): MapSchema<Key, Value> {
        const {validate: oldValidate} = this;

        return new MapSchema({
            getDescription: () => this.getDescription(),
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
     * Verifies that the size of the map is greater than or equal to the provided size.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public minSize(size: number): MapSchema<Key, Value> {
        return this._transformMap({
            serialize: value => {
                if (value.size < size)
                    throw new InvalidArgumentError(
                        `Expected map to have a size greater than or equal to ${size}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.size < size)
                    throw new SchemaDeserializationError(
                        `Expected map to have a size greater than or equal to ${size}`,
                    );

                return value;
            },
            validate: value => {
                if (value.size < size)
                    throw new InvalidArgumentError(
                        `Expected map to have a size greater than or equal to ${size}`,
                    );
            },
        });
    }

    /**
     * Verifies that the size of the map is less than or equal to the provided size.
     */
    // TODO(calebmer): Backwards compatibility validation?
    public maxSize(size: number): MapSchema<Key, Value> {
        return this._transformMap({
            serialize: value => {
                if (value.size > size)
                    throw new InvalidArgumentError(
                        `Expected map to have a size less than or equal to ${size}`,
                    );

                return value;
            },
            deserialize: value => {
                if (value.size > size)
                    throw new SchemaDeserializationError(
                        `Expected map to have a size less than or equal to ${size}`,
                    );

                return value;
            },
            validate: value => {
                if (value.size > size)
                    throw new InvalidArgumentError(
                        `Expected map to have a size less than or equal to ${size}`,
                    );
            },
        });
    }
}

type InterfaceSchemaInstanceClass<ValueBase> = {
    /**
     * The interface schema. This schema lazily deserializes. It returns an interface
     * instance you must later call `deserialize()` on.
     */
    readonly schema: Schema<InterfaceSchemaInstance<ValueBase>>;

    /**
     * Add a new implementation of the interface.
     */
    implement<Config extends ObjectSchemaConfigBase>(
        config: Config,
    ): ObjectSchema<ValueBase & ObjectSchemaConfigType<Config>> & {
        readonly _interfaceSchema: Schema<InterfaceSchemaInstance<ValueBase>>;
    };

    /**
     * Construct a new interface instance with an associated schema. Shared properties
     * are made available on the interface.
     */
    new <Value extends ValueBase>(
        schema: Schema<Value>,
        value: Value,
    ): InterfaceSchemaInstance<ValueBase>;
};

type InterfaceSchemaInstance<ValueBase> = {
    serialize(): SchemaSerializedValue;
    deserialize<Value>(schema: Schema<Value>): Value;
} & Readonly<ValueBase>;

class InterfaceSchemaInstanceBase {
    private _schema: Schema<any> | null;
    private _value: any;

    constructor(schema: Schema<any> | null, value: any) {
        this._schema = schema;
        this._value = value;
    }

    /**
     * Serialize the interface instance using the associated schema. If there's no
     * associated schema (when we've deserialized this instance from the network) then
     * we never deserialized the value so return the serialized value we got from the
     * network.
     */
    public serialize(): SchemaSerializedValue {
        if (this._schema === null) {
            return this._value;
        } else {
            return this._schema.serialize(this._value);
        }
    }

    /**
     * Deserialize the interface instance using the associated schema. If there's no
     * associated schema then we set the provided schema as the associated schema (but
     * only if there's no deserialization errors). If there's already an associated
     * schema and it's different from the schema you provide then this function will
     * throw an error.
     */
    public deserialize<Value>(schema: Schema<Value>): Value {
        if (this._schema === null) {
            const value = schema.deserialize(this._value);

            // Don't update `this._schema` until after we deserialize in case there's a
            // deserialization error.
            this._schema = schema;
            this._value = value;

            return this._value;
        }

        if (schema !== this._schema) {
            throw new InternalError(
                "Can\u2019t deserialize `InterfaceSchemaInstance` with different schemas",
            );
        }

        return this._value;
    }
}

/**
 * An error thrown while deserializing a schema.
 */
// TODO(calebmer): Should we make this `InternalError` as a default instead of
// `InvalidArgumentError`? Probably better to reclassify down in severity instead
// of reclassifying up in severity.
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
