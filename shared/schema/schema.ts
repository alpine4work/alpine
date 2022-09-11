import {base64ToBytes, bytesToBase64} from "byte-base64";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {hasOwnProperty} from "~/shared/helpers/object/has-own-property";
import {isPlainObject} from "~/shared/helpers/object/is-plain-object";
import {Optionalize} from "~/shared/helpers/types/optionalize";
import {
    SchemaDescription,
    SchemaObjectPropertyDescription,
} from "~/shared/schema/types/schema-description-types";

/**
 * Get the underlying type of a schema object.
 */
export type SchemaType<
    T extends Schema<any> | SchemaObjectProperty<any> | SchemaUnionVariant<any>,
> = T extends Schema<infer U>
    ? U
    : T extends SchemaObjectProperty<infer U>
    ? U
    : T extends SchemaUnionVariant<infer U>
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
 * The schema class is a type-safe combinator-style utility for validating and
 * migrating unknown JavaScript values. You may use it for reading values from
 * a dynamic JSON data store, messages from an untyped event stream, or for
 * validating client input.
 *
 * It is designed to support changing data formats over time. For example,
 * objects will silently discard unknown properties from a new application
 * version.
 */
export class Schema<Value> {
    /**
     * The description of the serialized value returned by this schema.
     */
    public readonly description: SchemaDescription;

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
     * May mutate the underlying value during deserialization.
     */
    public readonly deserialize: (serializedValue: SchemaSerializedValue) => Value;

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
    }: {
        description: SchemaDescription;
        serialize: (value: Value) => SchemaSerializedValue;
        deserialize: (serializedValue: SchemaSerializedValue) => Value;
    }) {
        this.description = description;
        this.serialize = serialize;
        this.deserialize = deserialize;
    }

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
    });

    /**
     * Accept any integer value.
     *
     * An integer is a JavaScript number that passes [`Number.isSafeInteger`][1].
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger
     */
    public static integer = new Schema<number>({
        description: {type: "Integer"},
        serialize: value => {
            assert(Number.isSafeInteger(value));
            return value;
        },
        deserialize: value => {
            if (typeof value !== "number") throw new SchemaDeserializationError("Expected number");

            if (!Number.isSafeInteger(value))
                throw new SchemaDeserializationError("Expected number");

            return value;
        },
    });

    /**
     * Accept any string value.
     */
    public static string = new Schema<string>({
        description: {type: "String"},
        serialize: value => value,
        deserialize: value => {
            if (typeof value !== "string") throw new SchemaDeserializationError("Expected string");
            return value;
        },
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
    });

    /**
     * Accept null in addition to any underlying value.
     */
    public nullable(): Schema<Value | null> {
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
        });
    }

    /**
     * Accept only values exactly equal to the provided value.
     */
    public static value<Value extends number | boolean | string>(
        expectedValue: Value,
    ): Schema<Value> {
        return new Schema({
            description: {
                type: "Value",
                value: expectedValue,
            },
            serialize: value => value,
            deserialize: value => {
                if (!Object.is(expectedValue, value))
                    throw new SchemaDeserializationError(
                        `Expected value to be ${JSON.stringify(expectedValue)}`,
                    );
                return value as Value;
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
        return SchemaObjectProperty.wrap(this).optional();
    }

    /**
     * Provide a default for an optional object property.
     *
     * When deserializing an object, if we don't see this property then we will use
     * the provided default value.
     */
    public default(defaultValue: Value) {
        return SchemaObjectProperty.wrap(this).default(defaultValue);
    }

    /**
     * If you want to rename an object property, use this combinator to provide the
     * old name. We will serialize and deserialize the object with this name
     * instead of the one in the `Schema.object()` definition.
     */
    public originalPropertyKey(originalKey: string) {
        return SchemaObjectProperty.wrap(this).originalPropertyKey(originalKey);
    }

    /**
     * If you want to rename a union variant's type name, use this combinator to
     * provide the old name. We will serialize and deserialize the object with this
     * name instead of the one in the `Schema.union()` definition.
     */
    public originalTypeName(originalName: string) {
        return new SchemaUnionVariant(this, originalName);
    }

    /**
     * Accept an array where every item matches the schema.
     *
     * Mutates the array in-place when parsing if the item schema changes values.
     */
    public static array<Value>(itemSchema: Schema<Value>): Schema<ReadonlyArray<Value>> {
        return new Schema({
            description: {
                type: "Array",
                itemSchema: itemSchema.description,
            },
            serialize: value => value.map(item => itemSchema.serialize(item)),
            deserialize: value => {
                if (!Array.isArray(value))
                    throw new SchemaDeserializationError("Expected an array");

                for (let index = 0; index < value.length; index++) {
                    withSchemaDeserializationStackFrame({type: "ArrayIndex", index}, () => {
                        value[index] = itemSchema.deserialize(value[index]);
                    });
                }

                return value;
            },
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
    public static object<Schemas extends {[key: string]: Schema<any> | SchemaObjectProperty<any>}>(
        schemas: Schemas,
    ): ObjectSchema<Optionalize<{readonly [Key in keyof Schemas]: SchemaType<Schemas[Key]>}>> {
        const schemaByKey = new Map<string, SchemaObjectProperty<unknown>>(
            Object.entries(schemas).map(([key, schema]) => [
                key,
                schema instanceof Schema ? SchemaObjectProperty.wrap(schema) : schema,
            ]),
        );

        const config: ObjectSchemaConfig<
            Optionalize<{[Key in keyof Schemas]: SchemaType<Schemas[Key]>}>
        > = {
            description: {
                type: "Object",
                propertySchemaByKey: Object.fromEntries(
                    Array.from(schemaByKey, ([key, schema]) => [
                        schema.description.originalKey ?? key,
                        schema.description.propertyDescription,
                    ]),
                ),
            },
            serializeInto: (value, target) => {
                for (const [key, schema] of schemaByKey) {
                    schema.serializeProperty(target, key, (value as any)[key]);
                }
            },
            deserializeInto: (value, target) => {
                if (typeof value !== "object" || value === null)
                    throw new SchemaDeserializationError("Expected an object");

                if (target !== undefined) {
                    for (const [key, schema] of schemaByKey) {
                        const keyValue = withSchemaDeserializationStackFrame(
                            {type: "ObjectProperty", key},
                            () =>
                                schema.deserializeProperty(
                                    value as any as SchemaSerializedObjectValue,
                                    key,
                                ),
                        );

                        if (keyValue === schemaDeserializationMissingObjectPropertySymbol)
                            throw new SchemaDeserializationError(
                                `Required property \`${key}\` not found`,
                            );

                        (target as any)[key] = keyValue;
                    }

                    return target as any;
                } else if (isPlainObject(value)) {
                    const unknownKeys = new Set(Object.keys(value));

                    for (const [key, schema] of schemaByKey) {
                        unknownKeys.delete(key);

                        const keyValue = withSchemaDeserializationStackFrame(
                            {type: "ObjectProperty", key},
                            () => schema.deserializeProperty(value, key),
                        );

                        if (keyValue === schemaDeserializationMissingObjectPropertySymbol)
                            throw new SchemaDeserializationError(
                                `Required property \`${key}\` not found`,
                            );

                        (value as any)[key] = keyValue;
                    }

                    // Silently discard keys our schema doesn't know about instead of erring. By
                    // not erring we are future compatible with new schemas.
                    //
                    // We need to delete properties, though, so an attacker doesn't try setting
                    // `__proto__` or other intrinsic properties.
                    for (const key of unknownKeys) {
                        delete (value as any)[key];
                    }

                    return value as any;
                } else {
                    const newValue: {[key: string]: unknown} = {};

                    for (const [key, schema] of schemaByKey) {
                        const keyValue = withSchemaDeserializationStackFrame(
                            {type: "ObjectProperty", key},
                            () =>
                                schema.deserializeProperty(
                                    value as any as SchemaSerializedObjectValue,
                                    key,
                                ),
                        );

                        if (keyValue === schemaDeserializationMissingObjectPropertySymbol)
                            throw new SchemaDeserializationError(
                                `Required property \`${key}\` not found`,
                            );

                        newValue[key] = keyValue;
                    }

                    return newValue as any;
                }
            },
        };

        // @ts-expect-error: Constructor is marked private so code outside of this file
        // can't construct it. But we want to construct an object schema here.
        return new ObjectSchema(config);
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
    public static union<
        Schemas extends {
            [Key in keyof Schemas]:
                | (Schema<any> & {
                      // We need to put our `Key` type constraint on `deserialize` instead of the
                      // type parameter so the object type can be covariant instead of invariant.
                      deserialize: (value: SchemaSerializedValue) => {type: Key};
                  })
                | (SchemaUnionVariant<any> & {
                      schema: {
                          // We need to put our `Key` type constraint on `deserialize` instead of the
                          // type parameter so the object type can be covariant instead of invariant.
                          deserialize: (value: SchemaSerializedValue) => {type: Key};
                      };
                  });
        },
    >(schemas: Schemas): Schema<SchemaType<Schemas[keyof Schemas]>> {
        const schemaEntries = Object.entries(schemas) as Array<
            [string, Schema<{type: string}> | SchemaUnionVariant<{type: string}>]
        >;

        const schemaByTypeName = new Map<
            string,
            {schema: Schema<{type: string}>; serializedTypeName: string}
        >(
            schemaEntries.map(([typeName, schema]) => [
                typeName,
                schema instanceof SchemaUnionVariant
                    ? {schema: schema.schema, serializedTypeName: schema.originalTypeName}
                    : {schema, serializedTypeName: typeName},
            ]),
        );

        const schemaByOriginalTypeName = new Map<
            string,
            {schema: Schema<{type: string}>; typeName: string}
        >();
        for (const [typeName, schema] of schemaEntries) {
            if (schema instanceof SchemaUnionVariant) {
                schemaByOriginalTypeName.set(schema.originalTypeName, {
                    schema: schema.schema,
                    typeName,
                });
            }
        }

        return new Schema<SchemaType<Schemas[keyof Schemas]>>({
            description: {
                type: "Union",
                variantSchemaByType: Object.fromEntries(
                    Array.from(schemaByTypeName, ([typeName, {schema, serializedTypeName}]) => [
                        serializedTypeName,
                        // If the serialized type name is different then the type name at runtime, make
                        // sure to update the schema description for this union with the correct type
                        // name.
                        serializedTypeName !== typeName &&
                        schema.description.type === "Object" &&
                        schema.description.propertySchemaByKey.type &&
                        schema.description.propertySchemaByKey.type.valueSchema.type === "Value" &&
                        schema.description.propertySchemaByKey.type.valueSchema.value === typeName
                            ? {
                                  ...schema.description,
                                  propertySchemaByKey: {
                                      ...schema.description.propertySchemaByKey,
                                      type: {
                                          valueSchema: {type: "Value", value: serializedTypeName},
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
                const schema = schemaByTypeName.get(value.type);
                assert(schema);
                const serializedValue = schema.schema.serialize(value);
                (serializedValue as any).type = schema.serializedTypeName;
                return serializedValue;
            },
            deserialize: value => {
                if (typeof value !== "object" || value === null)
                    throw new SchemaDeserializationError("Expected an object");

                if (!hasOwnProperty(value, "type") || typeof value.type !== "string")
                    throw new SchemaDeserializationError("Required property `type` not found");

                // Use the type to select the schema we'll use to parse the value.
                const type: string = value.type;

                const deserializedValue = withSchemaDeserializationStackFrame(
                    {type: "UnionVariant", typeKey: "type", typeValue: type},
                    () => {
                        // First we try the current type name for the schema...
                        {
                            const schema = schemaByTypeName.get(type);
                            if (schema !== undefined) {
                                return schema.schema.deserialize(value) as any;
                            }
                        }

                        // Then we try the original type name for the schema...
                        {
                            const schema = schemaByOriginalTypeName.get(type);
                            if (schema !== undefined) {
                                value.type = schema.typeName;
                                return schema.schema.deserialize(value as any);
                            }
                        }

                        return null;
                    },
                );

                if (deserializedValue === null)
                    throw new SchemaDeserializationError("Unknown type");

                return deserializedValue;
            },
        });
    }
}

type ObjectSchemaConfig<Value> = {
    description: SchemaDescription;
    serializeInto: (value: Value, target: {[key: string]: SchemaSerializedValue}) => void;
    deserializeInto: (
        serializedValue: SchemaSerializedValue,
        target?: {[key: string]: SchemaSerializedValue},
    ) => Value;
};

/**
 * Schema for an object value.
 *
 * You should only create this with `Schema.object()`.
 */
export class ObjectSchema<Value> extends Schema<Value> {
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

    private constructor({description, serializeInto, deserializeInto}: ObjectSchemaConfig<Value>) {
        super({
            description,
            serialize: value => {
                const newValue: {[key: string]: SchemaSerializedValue} = {};
                serializeInto(value, newValue);
                return newValue;
            },
            deserialize: deserializeInto,
        });
        this.serializeInto = serializeInto;
        this.deserializeInto = deserializeInto;
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

const schemaDeserializationMissingObjectPropertySymbol = Symbol(
    "schemaDeserializationMissingObjectProperty",
);

export class SchemaObjectProperty<Value> {
    /**
     * The description of the serialized property written by this schema.
     */
    public readonly description: {
        readonly originalKey: string | null;
        readonly propertyDescription: SchemaObjectPropertyDescription;
    };

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
    ) => Value | typeof schemaDeserializationMissingObjectPropertySymbol;

    private constructor({
        description,
        serializeProperty,
        deserializeProperty,
    }: {
        description: {
            readonly originalKey: string | null;
            readonly propertyDescription: SchemaObjectPropertyDescription;
        };
        serializeProperty: (
            object: {[key: string]: SchemaSerializedValue | undefined},
            key: string,
            value: Value,
        ) => void;
        deserializeProperty: (
            object: SchemaSerializedObjectValue,
            key: string,
        ) => Value | typeof schemaDeserializationMissingObjectPropertySymbol;
    }) {
        this.description = description;
        this.serializeProperty = serializeProperty;
        this.deserializeProperty = deserializeProperty;
    }

    /**
     * Wrap a schema into a required object property.
     */
    public static wrap<Value>(schema: Schema<Value>): SchemaObjectProperty<Value> {
        return new SchemaObjectProperty({
            description: {
                originalKey: null,
                propertyDescription: {
                    valueSchema: schema.description,
                    optional: false,
                },
            },
            serializeProperty: (object, key, value) => {
                object[key] = schema.serialize(value);
            },
            deserializeProperty: (object, key) => {
                const value = hasOwnProperty(object, key) ? object[key] : undefined;
                if (value === undefined) return schemaDeserializationMissingObjectPropertySymbol;
                return schema.deserialize(value);
            },
        });
    }

    /** @see Schema.optional */
    public optional(): SchemaObjectProperty<Value | undefined> {
        return new SchemaObjectProperty({
            description: {
                ...this.description,
                propertyDescription: {
                    ...this.description.propertyDescription,
                    optional: true,
                },
            },
            serializeProperty: (object, key, value) => {
                if (value === undefined) return;
                this.serializeProperty(object, key, value);
            },
            deserializeProperty: (object, key) => {
                const value = this.deserializeProperty(object, key);
                if (value === schemaDeserializationMissingObjectPropertySymbol) return undefined;
                return value;
            },
        });
    }

    /** @see Schema.default */
    public default(defaultValue: Value): SchemaObjectProperty<Value> {
        return new SchemaObjectProperty({
            description: {
                ...this.description,
                propertyDescription: {
                    ...this.description.propertyDescription,
                    optional: true,
                },
            },
            serializeProperty: (object, key, value) => {
                this.serializeProperty(object, key, value);
            },
            deserializeProperty: (object, key) => {
                const value = this.deserializeProperty(object, key);
                if (value === schemaDeserializationMissingObjectPropertySymbol) return defaultValue;
                return value;
            },
        });
    }

    /** @see Schema.originalPropertyKey */
    public originalPropertyKey(originalKey: string): SchemaObjectProperty<Value> {
        return new SchemaObjectProperty({
            description: {
                ...this.description,
                originalKey,
            },
            serializeProperty: (object, key, value) => {
                this.serializeProperty(object, originalKey, value);
            },
            deserializeProperty: (object, key) => {
                return this.deserializeProperty(
                    object,
                    // If the provided key exists on the object then use that for deserializing.
                    // Otherwise we're using the original key.
                    hasOwnProperty(object, key) && object[key] !== undefined ? key : originalKey,
                );
            },
        });
    }
}

/**
 * An intermediate object we use for renaming union schema variants.
 */
export class SchemaUnionVariant<Value> {
    constructor(public readonly schema: Schema<Value>, public readonly originalTypeName: string) {}
}

/**
 * An error thrown while deserializing a schema.
 */
export class SchemaDeserializationError extends Error {
    constructor(message: string) {
        const stackString = getSchemaDeserializationStackString();

        super(message);
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
          readonly typeValue: string;
      };

let schemaDeserializationStack: Array<SchemaDeserializationStackFrame> = [];

function withSchemaDeserializationStackFrame<Value>(
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
