import {DynamoEmailAddressSchema} from "~/server/dynamo/core/internal/dynamo_email_address_schema.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {
    ScheduleDateTime,
    deserializeScheduleDateTimeString,
    isScheduleDateTimeString,
    serializeScheduleDateTime,
    serializeScheduleDateTimeString,
} from "~/server/notifications/core/schedule_date_time.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {
    DateString,
    deserializeDateString,
    isDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string.js";
import {
    maxIsoLexicographicallySortableDate,
    minIsoLexicographicallySortableDate,
} from "~/shared/helpers/date/max_date.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {
    ElenFloat,
    decodeElenFloatIfPossible,
    encodeElenFloat,
} from "~/shared/helpers/number/elen_float.js";
import {
    ElenInteger,
    decodeElenIntegerIfPossible,
    encodeElenInteger,
} from "~/shared/helpers/number/elen_integer.js";
import {
    OrderKey,
    isOrderKey,
    maxOrderKey,
    minOrderKey,
    orderKeyDigits,
} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {Id, decodeIdInto, encodeId, getMaxId, getMinId, isId} from "~/shared/id/id.js";
import {
    LabelStringSchema,
    maxLabelString,
    minLabelString,
} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * An attribute of a DynamoDB key is an ASCII string excluding the `#`
 * character and any characters with a smaller character code.
 *
 * To form a DynamoDB key, we concatenate attributes together with the `#`
 * character. So we don't allow it in key attributes since we use it as a
 * separator.
 */
export type DynamoKeyAttribute =
    | (string & {readonly _DynamoKeyAttribute: never})

    // We include some opaque types we know to be safe DynamoDB key attributes.
    // This allows us to safely skip a validation call for these types.

    // An ID in our system is comprised of numbers and letters. This makes it a
    // valid DynamoDB key attribute.
    | Id

    // An [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) string is comprised of
    // characters that are safe for a DynamoDB key attribute.
    | DateString

    // An `ElenInteger` is only digits and the `-` and `=` characters. Both of
    // which are larger than `#`. This makes the type a valid DynamoDB key
    // attribute.
    | ElenInteger

    // An `ElenFloat` is only digits and the `-` and `=` characters. Both of
    // which are larger than `#`. This makes the type a valid DynamoDB key
    // attribute.
    | ElenFloat

    // An `OrderKey` is only alphanumeric characters. This makes the type a valid
    // DynamoDB key attribute.
    | OrderKey;

/**
 * The separator character between attributes in a DynamoDB key.
 *
 * We chose the `#` character because it is the smallest ASCII character that
 * looks like a separator. And because it is uncommon in string formats. `_` is
 * not a good choice because it has a greater character code than uppercase
 * letters and numbers. `-` is not a good choice because it is a part of common
 * string formats like the date format [ISO 8601][1].
 *
 * The separator needs a small character code so that DynamoDB keys with
 * multiple attributes have the correct [lexicographic order][2].
 *
 * Say we have two compound keys. One is `["AB", "F"]` and the other is
 * `["ABC", "E"]`. We want `["AB", "F"]` to be sorted before `["ABC", "E"]`
 * because the first attribute is smaller (`"AB" < "ABC"`).
 *
 * If we concatenate with no separator then `"ABCE" < "ABF"` which is wrong. If
 * we concatenate with the `_` separator we also get `"ABC_E" < "AB_F"`. This
 * is because `"C" < "_"` since `_` has a higher character code than uppercase
 * letters. With `#` we get `"AB#F" < "ABC#E"` which is the result we want
 * because `"#" < "C"`.
 *
 * All characters in a key attribute must have a greater character code than
 * our separator (`#`) so that when one key attribute is shorter than the other
 * we're comparing, the shorter attribute is ordered first.
 *
 * [1]: https://en.wikipedia.org/wiki/ISO_8601
 * [2]: https://en.wikipedia.org/wiki/Lexicographic_order
 * [3]: https://observablehq.com/@dgreensp/implementing-fractional-indexing
 */
export const dynamoKeySeparator = "#";

/**
 * The minimum character code is one more than our key separator (`#`).
 */
export const dynamoKeyAttributeMinCharCode = dynamoKeySeparator.charCodeAt(0) + 1;

/**
 * The maximum character code is the maximum [ASCII character][1] `~`.
 *
 * [1]: https://en.wikipedia.org/wiki/ASCII
 */
export const dynamoKeyAttributeMaxCharCode = "~".charCodeAt(0);

/**
 * Is our string a valid DynamoDB key attribute?
 */
export function isDynamoKeyAttribute(string: string): string is DynamoKeyAttribute {
    // Require key attributes to be non-empty. This restriction may not be
    // necessary and can be removed in the future.
    //
    // It is nice aesthetically so you never get DynamoDB keys that look
    // like `a##b#`.
    if (string.length === 0) return false;

    for (let index = 0; index < string.length; index++) {
        const charCode = string.charCodeAt(index);

        if (charCode < dynamoKeyAttributeMinCharCode || charCode > dynamoKeyAttributeMaxCharCode)
            return false;
    }

    return true;
}

/**
 * Extract the value type from a `DynamoKeyAttributeSchema`.
 */
export type DynamoKeyAttributeSchemaType<Schema extends DynamoKeyAttributeSchema<any>> =
    Schema extends DynamoKeyAttributeSchema<infer Value> ? Value : never;

/**
 * A description of the attribute schema for backwards compatibility checking
 * purposes.
 */
export type DynamoKeyAttributeSchemaDescription =
    | {readonly type: "Id"}
    | {readonly type: "Date"}
    | {readonly type: "ScheduleDateTime"}
    | {readonly type: "Boolean"}
    | {readonly type: "BooleanReversed"}
    | {readonly type: "Integer"}
    | {readonly type: "Float"}
    | {readonly type: "Bytes"; readonly byteLength: number}
    | {readonly type: "OrderKey"}
    | {readonly type: "LabelString"}
    | {readonly type: "EmailAddress"}
    | {readonly type: "Reverse"; readonly schema: DynamoKeyAttributeSchemaDescription}
    | {
          readonly type: "Nullable";
          readonly nullsOrder: "First" | "Last";
          readonly schema: DynamoKeyAttributeSchemaDescription;
      };

const orderKeyDigitIndexByChar = new Map<string, number>(
    orderKeyDigits.split("").map((char, index) => [char, index]),
);

/**
 * An attribute of a DynamoDB key.
 *
 * All DynamoDB key attributes must have a string encoding with a lexicographic
 * order that's the same as their underlying value. That's because all key
 * attributes will be concatenated together into one key string that DynamoDB
 * will use to sort records.
 */
export class DynamoKeyAttributeSchema<Value> {
    /**
     * IDs are fully random and have no useful order.
     */
    public static readonly id = Object.assign(
        <Value extends Id>(): DynamoKeyAttributeSchema<Value> => this._id as any,
        {
            getMinValue: getMinId,
            getMaxValue: getMaxId,
        },
    );

    private static _id = new DynamoKeyAttributeSchema<Id>({
        description: {type: "Id"},

        minValue: getMinId(),
        maxValue: getMaxId(),

        serialize: value => value,
        deserialize: keyAttribute => {
            assert(isId(keyAttribute));
            return keyAttribute;
        },

        binary: {
            getByteCount: () => 16, // 128 bits / 8
            serializeBytes: (value, bytes, byteOffset) => decodeIdInto(value, bytes, byteOffset),
            deserializeBytes: (bytes, byteOffset) => encodeId(bytes, byteOffset),
        },
    });

    /**
     * Dates are serialized to [ISO 8601][1].
     *
     * [1]: https://en.wikipedia.org/wiki/ISO_8601
     */
    public static date = new DynamoKeyAttributeSchema<Date>({
        description: {type: "Date"},

        minValue: minIsoLexicographicallySortableDate,
        maxValue: maxIsoLexicographicallySortableDate,

        serialize: serializeDateString,
        deserialize: keyAttribute => {
            assert(isDateString(keyAttribute));
            return deserializeDateString(keyAttribute);
        },

        binary: {
            getByteCount: () => 8,
            serializeBytes: (value, bytes, byteOffset) => {
                const view = new DataView(bytes.buffer);
                view.setBigInt64(
                    byteOffset,
                    // We use a bigint since safe JavaScript integers can go up to 2^53.
                    BigInt(value.getTime()),
                    // It is important that we store in big endian format so that when comparing
                    // bytes without knowledge of the type we get the correct order.
                    false,
                );

                // Flip the first bit so the negative sign is 0 instead of 1 putting negative
                // numbers first.
                bytes[byteOffset] ^= 0b10000000;
            },
            deserializeBytes: (bytes, byteOffset) => {
                // Clone the bytes before manipulating them so we don't mess up the bytes we
                // are deserializing from...
                const clonedBuffer = new ArrayBuffer(8);
                const clonedBytes = new Uint8Array(clonedBuffer);
                clonedBytes.set(bytes.slice(byteOffset, byteOffset + 8));
                clonedBytes[0] ^= 0b10000000;

                const view = new DataView(clonedBytes.buffer);
                const bigintValue = view.getBigInt64(0, false);
                return new Date(Number(bigintValue));
            },
        },
    });

    /**
     * ScheduleDateTime acts just like Date, but enforces that the time is truncated to the nearest
     * minute and its string representation is in the format "YYYY-MM-DDTHH:mm:ss.SSSZ".
     */
    public static ScheduleDateTime = new DynamoKeyAttributeSchema<ScheduleDateTime>({
        description: {type: "ScheduleDateTime"},

        minValue: minIsoLexicographicallySortableDate as ScheduleDateTime,
        maxValue: maxIsoLexicographicallySortableDate as ScheduleDateTime,

        serialize: serializeScheduleDateTimeString,
        deserialize: keyAttribute => {
            assert(isScheduleDateTimeString(keyAttribute));
            return deserializeScheduleDateTimeString(keyAttribute);
        },

        binary: {
            getByteCount: () => 8,
            serializeBytes: (value, bytes, byteOffset) => {
                const view = new DataView(bytes.buffer);
                view.setBigInt64(
                    byteOffset,
                    // We use a bigint since safe JavaScript integers can go up to 2^53.

                    BigInt(serializeScheduleDateTime(value).getTime()),
                    // It is important that we store in big endian format so that when comparing
                    // bytes without knowledge of the type we get the correct order.
                    false,
                );

                // Flip the first bit so the negative sign is 0 instead of 1 putting negative
                // numbers first.
                bytes[byteOffset] ^= 0b10000000;
            },
            deserializeBytes: (bytes, byteOffset) => {
                // Clone the bytes before manipulating them so we don't mess up the bytes we
                // are deserializing from...
                const clonedBuffer = new ArrayBuffer(8);
                const clonedBytes = new Uint8Array(clonedBuffer);
                clonedBytes.set(bytes.slice(byteOffset, byteOffset + 8));
                clonedBytes[0] ^= 0b10000000;

                const view = new DataView(clonedBytes.buffer);
                const bigintValue = view.getBigInt64(0, false);
                return serializeScheduleDateTime(new Date(Number(bigintValue)));
            },
        },
    });

    /**
     * Booleans are serialized to either the `true` or `false` string.
     *
     * `false` is  ordered first and `true` is ordered second. Conveniently that's
     * how the strings `true` and `false` order themselves.
     */
    public static boolean = new DynamoKeyAttributeSchema<boolean>({
        description: {type: "Boolean"},

        minValue: false,
        maxValue: true,

        serialize: value => (value ? "true" : "false") as DynamoKeyAttribute,
        deserialize: value => value === "true",

        binary: {
            getByteCount: () => 1,
            serializeBytes: (value, bytes, byteOffset) => {
                bytes[byteOffset] = value ? 1 : 0;
            },
            deserializeBytes: (bytes, byteOffset) => {
                return bytes[byteOffset] !== 0;
            },
        },
    });

    /**
     * Booleans are serialized to either the `true` or `false` string. Except we
     * append `0-` to `true` and `1-` to `false` so that true values are ordered
     * first and false values are ordered second. Same functionality as calling
     * `.reverse()` but with more legible serialized values.
     */
    public static booleanReversed = new DynamoKeyAttributeSchema<boolean>({
        description: {type: "BooleanReversed"},

        minValue: true,
        maxValue: false,

        serialize: value => (value ? "0-true" : "1-false") as DynamoKeyAttribute,
        deserialize: value => value === "0-true",

        binary: {
            getByteCount: () => 1,
            serializeBytes: (value, bytes, byteOffset) => {
                bytes[byteOffset] = value ? 0 : 1;
            },
            deserializeBytes: (bytes, byteOffset) => {
                return bytes[byteOffset] === 0;
            },
        },
    });

    /**
     * Integers are serialized to an `ElenInteger`. Only supports [safe
     * JavaScript integers][1].
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger
     */
    public static integer = new DynamoKeyAttributeSchema<number>({
        description: {type: "Integer"},

        minValue: Number.MIN_SAFE_INTEGER,
        maxValue: Number.MAX_SAFE_INTEGER,

        serialize: encodeElenInteger,
        deserialize: keyAttribute => {
            const value = decodeElenIntegerIfPossible(keyAttribute);
            assert(value !== null);
            return value;
        },

        binary: {
            getByteCount: () => 8,
            serializeBytes: (value, bytes, byteOffset) => {
                const view = new DataView(bytes.buffer);
                view.setBigInt64(
                    byteOffset,
                    // We use a bigint since safe JavaScript integers can go up to 2^53.
                    BigInt(value),
                    // It is important that we store in big endian format so that when comparing
                    // bytes without knowledge of the type we get the correct order.
                    false,
                );

                // Flip the first bit so the negative sign is 0 instead of 1 putting negative
                // numbers first.
                bytes[byteOffset] ^= 0b10000000;
            },
            deserializeBytes: (bytes, byteOffset) => {
                // Clone the bytes before manipulating them so we don't mess up the bytes we
                // are deserializing from...
                const clonedBuffer = new ArrayBuffer(8);
                const clonedBytes = new Uint8Array(clonedBuffer);
                clonedBytes.set(bytes.slice(byteOffset, byteOffset + 8));
                clonedBytes[0] ^= 0b10000000;

                const view = new DataView(clonedBytes.buffer);
                const bigintValue = view.getBigInt64(0, false);
                return Number(bigintValue);
            },
        },
    });

    /**
     * Floats are serialized to an `ElenFloat`.
     *
     * The representation of an `ElenFloat` is less efficient for integers than
     * `ElenInteger`. So if you're using integers please prefer `ElenInteger`.
     */
    public static float = new DynamoKeyAttributeSchema<number>({
        description: {type: "Float"},

        // In the elen encoding of floats, `-NaN` is smaller than `-Infinity` and
        // `+NaN` is larger than `+Infinity`.
        minValue: -NaN,
        maxValue: NaN,

        serialize: encodeElenFloat,
        deserialize: keyAttribute => {
            const value = decodeElenFloatIfPossible(keyAttribute);
            assert(value !== null);
            return value;
        },

        // Order preserving binary float encodings are challenging to get right. We
        // also need an encoding that matches our elen encoding that puts NaNs
        // before/after Infinity.
        //
        // See this blog post on the FoundationDB order preserving encoding for a good
        // encoding example:
        // https://activesphere.com/blog/2018/08/17/order-preserving-serialization
        binary: null,
    });

    /**
     * Binary data with a fixed length. Useful if you have some opaque binary data
     * you want to use as a key.
     *
     * When serialized to a string we use a base64 format that is URL safe and
     * preserves the order of the underlying binary data. If you try to serialize
     * byte data with a different length then you'll get an error.
     */
    public static bytes(byteLength: number) {
        return new DynamoKeyAttributeSchema<Uint8Array>({
            description: {type: "Bytes", byteLength},

            minValue: new Uint8Array(createArrayWithLength(byteLength, () => 0)),
            maxValue: new Uint8Array(createArrayWithLength(byteLength, () => 2 ** 8 - 1)),

            serialize: value => {
                assert(value.byteLength === byteLength);
                return encodeBase64(value, "Rfc4648UrlWithOrderPreservation") as DynamoKeyAttribute;
            },
            deserialize: keyAttribute =>
                decodeBase64(keyAttribute, "Rfc4648UrlWithOrderPreservation"),

            binary: {
                getByteCount: () => byteLength,
                serializeBytes: (value, bytes, byteOffset) => {
                    assert(value.byteLength === byteLength);
                    bytes.set(value, byteOffset);
                },
                deserializeBytes: (bytes, byteOffset) =>
                    bytes.slice(byteOffset, byteOffset + byteLength),
            },
        });
    }

    /**
     * `OrderKey`s have a natural lexicographic order.
     */
    public static orderKey = new DynamoKeyAttributeSchema<OrderKey>({
        description: {type: "OrderKey"},

        minValue: minOrderKey,
        maxValue: maxOrderKey,

        serialize: value => value,
        deserialize: keyAttribute => {
            assert(isOrderKey(keyAttribute));
            return keyAttribute;
        },

        binary: {
            getByteCount: orderKey => orderKey.length + 1,

            serializeBytes: (orderKey, bytes, byteOffset) => {
                let byteIndex = byteOffset;

                for (let i = 0; i < orderKey.length; i++) {
                    const char = orderKey[i]!;
                    bytes[byteIndex++] =
                        assertExists(
                            orderKeyDigitIndexByChar.get(char),
                            "Unrecognized order key character",
                        ) + 1;
                }

                // Null byte terminates the order key.
                bytes[byteIndex++] = 0;
            },

            deserializeBytes: (bytes, byteOffset) => {
                let orderKey = "";
                let byteIndex = byteOffset;

                while (true) {
                    const byte = assertExists(
                        bytes[byteIndex++],
                        "Unexpected end of order key bytes",
                    );
                    if (byte === 0) break;
                    orderKey += assertExists(
                        orderKeyDigits[byte - 1],
                        "Unrecognized order key digit",
                    );
                }

                return orderKey as OrderKey;
            },
        },
    });

    /**
     * A short, single-line, string that is validated with `LabelStringSchema`.
     */
    public static labelString = new DynamoKeyAttributeSchema<string>({
        description: {type: "LabelString"},

        minValue: minLabelString,
        maxValue: maxLabelString,

        serialize: value => {
            const serializedString = LabelStringSchema.serialize(value);
            assert(typeof serializedString === "string");
            return serializeStringDynamoKeyAttribute(serializedString);
        },
        deserialize: keyAttribute =>
            LabelStringSchema.deserialize(deserializeStringDynamoKeyAttribute(keyAttribute)),

        // Order preserving binary string encodings are challenging to get right. We
        // can't encode the length at the beginning of the string since longer strings
        // may sort before shorter strings.
        //
        // A possible encoding could be "include the byte 0x01 before every code unit
        // and terminate the string with 0x00" but that's not efficient.
        //
        // Ignoring the problem for now and throwing an unimplemented error...
        //
        // See this blog post on the FoundationDB order preserving encoding for a good
        // encoding example:
        // https://activesphere.com/blog/2018/08/17/order-preserving-serialization
        binary: null,
    });

    /**
     * An email address string.
     *
     * Uses the `EmailAddress` type. Since we control all writers to the database
     * we can assume a previous writer has validated the `EmailAddress`'s MX DNS
     * records.
     */
    public static emailAddressString = new DynamoKeyAttributeSchema<EmailAddress>({
        description: {type: "EmailAddress"},

        minValue: minLabelString as EmailAddress,
        maxValue: maxLabelString as EmailAddress,

        serialize: value => {
            const serializedString = DynamoEmailAddressSchema.serialize(value);
            assert(typeof serializedString === "string");
            return serializeStringDynamoKeyAttribute(serializedString);
        },
        deserialize: keyAttribute =>
            DynamoEmailAddressSchema.deserialize(deserializeStringDynamoKeyAttribute(keyAttribute)),

        // Order preserving binary string encodings are challenging to get right. We
        // can't encode the length at the beginning of the string since longer strings
        // may sort before shorter strings.
        //
        // A possible encoding could be "include the byte 0x01 before every code unit
        // and terminate the string with 0x00" but that's not efficient.
        //
        // Ignoring the problem for now and throwing an unimplemented error...
        //
        // See this blog post on the FoundationDB order preserving encoding for a good
        // encoding example:
        // https://activesphere.com/blog/2018/08/17/order-preserving-serialization
        binary: null,
    });

    /**
     * The description of this attribute for backwards compatibility checking
     * purposes.
     */
    public readonly description: DynamoKeyAttributeSchemaDescription;

    /**
     * The smallest value serializable by this schema. Useful for creating
     * query bounds.
     */
    public readonly minValue: Value;

    /**
     * The largest value serializable by this schema. Useful for creating
     * query bounds.
     */
    public readonly maxValue: Value;

    /**
     * Serializes the attribute value into a DynamoDB key attribute.
     */
    public readonly serialize: (value: Value) => DynamoKeyAttribute;

    /**
     * Deserializes the DynamoDB key attribute into our attribute value. Throws if
     * the DynamoDB key attribute is incorrectly formatted.
     */
    public readonly deserialize: (keyAttribute: DynamoKeyAttribute) => Value;

    /**
     * Binary encoding for key values that preserves key order. Not all of our key
     * types support a binary format at the moment so this will be null if binary
     * encoding is unsupported.
     */
    public readonly binary: {
        readonly getByteCount: (value: Value) => number;
        readonly serializeBytes: (value: Value, bytes: Uint8Array, byteOffset: number) => void;
        readonly deserializeBytes: (bytes: Uint8Array, byteOffset: number) => Value;
    } | null;

    private constructor({
        description,
        minValue,
        maxValue,
        serialize,
        deserialize,
        binary,
    }: {
        description: DynamoKeyAttributeSchemaDescription;
        minValue: Value;
        maxValue: Value;
        serialize: (value: Value) => DynamoKeyAttribute;
        deserialize: (keyAttribute: DynamoKeyAttribute) => Value;
        binary: {
            getByteCount: (value: Value) => number;
            serializeBytes: (value: Value, bytes: Uint8Array, byteOffset: number) => void;
            deserializeBytes: (bytes: Uint8Array, byteOffset: number) => Value;
        } | null;
    }) {
        this.description = description;
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.serialize = serialize;
        this.deserialize = deserialize;
        this.binary = binary;

        // In development and test environments, make sure our value is within the min
        // and max value bounds. In production we don't check to avoid extra overhead
        // in a hot code path.
        //
        // Also make sure the sort order of serialized values is consistent across
        // string serialization and binary serialization. Make sure that string and
        // binary deserialization can also deserialize to the same value we serialized.
        if (process.env.NODE_ENV !== "production") {
            const serializedStringMinValue = serialize(minValue);
            const serializedStringMaxValue = serialize(maxValue);
            assert(
                serializedStringMinValue <= serializedStringMaxValue,
                "Key minimum value is not smaller than key maximum value when serialized to a string",
            );

            let serializedBinaryMinValue: Uint8Array | null = null;
            let serializedBinaryMaxValue: Uint8Array | null = null;
            if (binary) {
                serializedBinaryMinValue = new Uint8Array(binary.getByteCount(minValue));
                serializedBinaryMaxValue = new Uint8Array(binary.getByteCount(maxValue));
                binary.serializeBytes(minValue, serializedBinaryMinValue, 0);
                binary.serializeBytes(maxValue, serializedBinaryMaxValue, 0);
                assert(
                    compareBytes(serializedBinaryMinValue, serializedBinaryMaxValue) !== 1,
                    "Key minimum value is not smaller than key maximum value when serialized to binary",
                );
            }

            const maxTestValueCount = 25;
            const testValues: Array<{
                value: Value;
                serializedStringValue: string;
                serializedBinaryValue: Uint8Array | null;
            }> = [];
            let nextTestValueIndex = 0;

            const runValueTests = (value: Value) => {
                const serializedStringValue = serialize(value);

                // Test that when serializing to a string we can deserialize the value back to
                // the exact same value and that the string falls within our minimum and
                // maximum values.
                {
                    assert(
                        serializedStringValue === serialize(deserialize(serializedStringValue)),
                        "Could not deserialize to same value when serializing to a string",
                    );

                    assert(
                        serializedStringValue >= serializedStringMinValue,
                        "Serialized key value is smaller than minimum key value when serialized to a string",
                    );

                    assert(
                        serializedStringValue <= serializedStringMaxValue,
                        "Serialized key value is larger than maximum key value when serialized to a string",
                    );
                }

                let serializedBinaryValue: Uint8Array | null = null;

                // Test that when serializing to binary we can deserialize the value back to
                // the exact same value and that the string falls within our minimum and
                // maximum values.
                if (binary) {
                    serializedBinaryValue = new Uint8Array(binary.getByteCount(value));
                    binary.serializeBytes(value, serializedBinaryValue, 0);

                    const value2 = binary.deserializeBytes(serializedBinaryValue, 0);
                    const serializedBinaryValue2 = new Uint8Array(binary.getByteCount(value2));
                    binary.serializeBytes(value2, serializedBinaryValue2, 0);

                    assert(
                        compareBytes(serializedBinaryValue, serializedBinaryValue2) === 0,
                        "Could not deserialize to same value when serializing to binary",
                    );

                    assert(
                        compareBytes(
                            serializedBinaryValue,
                            assertExists(serializedBinaryMinValue),
                        ) !== -1,
                        "Serialized key value is smaller than minimum key value when serialized to binary",
                    );

                    assert(
                        compareBytes(
                            serializedBinaryValue,
                            assertExists(serializedBinaryMaxValue),
                        ) !== 1,
                        "Serialized key value is larger than maximum key value when serialized to binary",
                    );
                }

                // Ignore min/max values since we've already our values orders relative
                // to them.
                if (
                    serializedStringValue === serializedStringMinValue ||
                    serializedStringValue === serializedStringMaxValue
                ) {
                    assert(nextTestValueIndex <= testValues.length);

                    if (nextTestValueIndex < testValues.length) {
                        testValues[nextTestValueIndex] = {
                            value,
                            serializedStringValue,
                            serializedBinaryValue,
                        };
                    } else {
                        testValues.push({
                            value,
                            serializedStringValue,
                            serializedBinaryValue,
                        });
                    }

                    nextTestValueIndex++;

                    // We don't want to collect more than `maxTestValueCount` for testing. Reset the
                    // index back to zero once we've collected our max.
                    if (nextTestValueIndex === maxTestValueCount) nextTestValueIndex = 0;
                }

                // Test that values serialized to a string and values serialized to binary
                // have the same sort order.
                if (binary) {
                    const sortedSerializedStringValues = new Map(
                        Array.from(testValues)
                            .sort((a, b) =>
                                defaultCompareStrings(
                                    a.serializedStringValue,
                                    b.serializedStringValue,
                                ),
                            )
                            .map(({value}, index) => [value, index]),
                    );

                    const sortedSerializedBinaryValues = new Map(
                        Array.from(testValues)
                            .sort((a, b) =>
                                compareBytes(
                                    assertExists(a.serializedBinaryValue),
                                    assertExists(b.serializedBinaryValue),
                                ),
                            )
                            .map(({value}, index) => [value, index]),
                    );

                    assert(
                        isDeepEqual(sortedSerializedStringValues, sortedSerializedBinaryValues),
                        "Sort order when serializing key values to string is different from sort order when serializing key values to binary",
                    );
                }

                return {serializedStringValue, serializedBinaryValue};
            };

            this.serialize = value => {
                // Test that string serialization and binary serialization produce consistent
                // sort orders. It is very bad if they do not!
                //
                // Conveniently, this function also serializes our value to a string.
                return runValueTests(value).serializedStringValue;
            };

            if (binary) {
                this.binary = {
                    ...binary,
                    serializeBytes: (value, bytes, byteOffset) => {
                        binary.serializeBytes(value, bytes, byteOffset);

                        // Test that string serialization and binary serialization produce consistent
                        // sort orders. It is very bad if they do not!
                        runValueTests(value);
                    },
                };
            }
        }
    }

    /**
     * Order our values in reverse.
     *
     * Does this by serializing the value into a hexadecimal string with reverse
     * byte order from the input string.
     */
    public reverse(): DynamoKeyAttributeSchema<Value> {
        const {binary} = this;

        return new DynamoKeyAttributeSchema<Value>({
            description: {type: "Reverse", schema: this.description},

            minValue: this.maxValue,
            maxValue: this.minValue,

            serialize: value => {
                const keyAttribute = this.serialize(value);
                return serializeReversedDynamoKeyAttribute(keyAttribute);
            },
            deserialize: reversedKeyAttribute => {
                const keyAttribute = deserializeReversedDynamoKeyAttribute(reversedKeyAttribute);
                return this.deserialize(keyAttribute);
            },

            binary: binary
                ? {
                      getByteCount: value => binary.getByteCount(value),
                      serializeBytes: (value, bytes, byteOffset) => {
                          binary.serializeBytes(value, bytes, byteOffset);

                          const byteCount = binary.getByteCount(value);
                          for (
                              let byteIndex = byteOffset;
                              byteIndex < byteOffset + byteCount;
                              byteIndex++
                          ) {
                              bytes[byteIndex] = ~bytes[byteIndex]!;
                          }
                      },
                      deserializeBytes: (bytes, byteOffset) => {
                          // Clone bytes before deserializing them so we don't change what's in the
                          // source buffer we're parsing from.
                          const clonedBuffer = new ArrayBuffer(bytes.byteLength - byteOffset);
                          const clonedBytes = new Uint8Array(clonedBuffer);
                          clonedBytes.set(bytes.slice(byteOffset));

                          for (let i = 0; i < clonedBytes.length; i++) {
                              clonedBytes[i] = ~clonedBytes[i]!;
                          }

                          return binary.deserializeBytes(clonedBytes, 0);
                      },
                  }
                : null,
        });
    }

    /**
     * Allow the key value to be null.
     *
     * If null then the value serializes to `0`. Otherwise we append `1-` to the
     * serialized value. This means that null values come first by default. You can
     * customize this behavior with `nullsOrder`. When set to `Last` null
     * serializes to `1` and we append `0-` to other values.
     */
    public nullable({
        nullsOrder = "First",
    }: {
        nullsOrder?: "First" | "Last";
    } = {}): DynamoKeyAttributeSchema<Value | null> {
        const nullPrefix = nullsOrder === "First" ? "0" : "1";
        const nonNullPrefix = nullsOrder === "First" ? "1" : "0";

        const nullBytePrefix = nullsOrder === "First" ? 0 : 1;
        const nonNullBytePrefix = nullsOrder === "First" ? 1 : 0;

        const {binary} = this;

        return new DynamoKeyAttributeSchema<Value | null>({
            description: {type: "Nullable", nullsOrder, schema: this.description},

            minValue: nullsOrder === "First" ? null : this.minValue,
            maxValue: nullsOrder === "First" ? this.maxValue : null,

            serialize: value => {
                if (value === null) return nullPrefix as DynamoKeyAttribute;
                const keyAttribute = this.serialize(value);
                return `${nonNullPrefix}-${keyAttribute}` as DynamoKeyAttribute;
            },
            deserialize: nullableKeyAttribute => {
                if (nullableKeyAttribute === nullPrefix) return null;
                assert(nullableKeyAttribute.startsWith(`${nonNullPrefix}-`));
                const keyAttribute = nullableKeyAttribute.slice(2) as DynamoKeyAttribute;
                return this.deserialize(keyAttribute);
            },

            binary: binary
                ? {
                      getByteCount: value => {
                          if (value === null) return 1;
                          return binary.getByteCount(value) + 1;
                      },
                      serializeBytes: (value, bytes, byteOffset) => {
                          if (value === null) {
                              bytes[byteOffset] = nullBytePrefix;
                          } else {
                              bytes[byteOffset] = nonNullBytePrefix;
                              binary.serializeBytes(value, bytes, byteOffset + 1);
                          }
                      },
                      deserializeBytes: (bytes, byteOffset) => {
                          if (bytes[byteOffset] === nullBytePrefix) {
                              return null;
                          } else {
                              return binary.deserializeBytes(bytes, byteOffset + 1);
                          }
                      },
                  }
                : null,
        });
    }
}

/**
 * Serializes an arbitrary string into a version that is safe for a DynamoDB
 * key. By escaping any characters outside the DynamoDB key character range.
 *
 * The escaped string is parsable with `JSON.parse()`.
 */
function serializeStringDynamoKeyAttribute(string: string): DynamoKeyAttribute {
    // For now, we require DynamoDB key attributes to be non-empty. This is a
    // restriction we believe we can relax in the future.
    assert(string.length > 0);

    let serializedString = "";

    for (let index = 0; index < string.length; index++) {
        const char = string[index]!;
        const charCode = string.charCodeAt(index);

        if (
            charCode >= dynamoKeyAttributeMinCharCode + 1 &&
            charCode <= dynamoKeyAttributeMaxCharCode - 1
        ) {
            serializedString += char;
        } else {
            // Any characters outside our key attribute character range need to be escaped
            // using a Unicode escape sequence.
            //
            // We use either the minimum or maximum key attribute character as the escape
            // character. We use the minimum character if the escaped character is before
            // our valid character range.
            serializedString += `${
                charCode < dynamoKeyAttributeMinCharCode + 1
                    ? String.fromCharCode(dynamoKeyAttributeMinCharCode)
                    : String.fromCharCode(dynamoKeyAttributeMaxCharCode)
            }u${charCode.toString(16).padStart(4, "0").toUpperCase()}`;
        }
    }

    return serializedString as DynamoKeyAttribute;
}

/**
 * Deserializes a string produced from `serializeStringDynamoKeyAttribute()`
 * back into a regular string.
 */
function deserializeStringDynamoKeyAttribute(string: DynamoKeyAttribute): string {
    let deserializedString = "";

    for (let index = 0; index < string.length; index++) {
        const char = string[index]!;
        const charCode = string.charCodeAt(index);

        if (
            charCode >= dynamoKeyAttributeMinCharCode + 1 &&
            charCode <= dynamoKeyAttributeMaxCharCode - 1
        ) {
            deserializedString += char;
        } else {
            assert(
                charCode === dynamoKeyAttributeMinCharCode ||
                    charCode === dynamoKeyAttributeMaxCharCode,
            );

            index++;
            assert(string[index] === "u", "Expected unicode escape");

            const escapedCharCodeString = string.slice(index + 1, index + 5);
            assert(/^[0-9A-F]{4}$/.test(escapedCharCodeString), "Expected unicode escape");
            const escapedCharCode = parseInt(escapedCharCodeString, 16);
            index += 4;

            deserializedString += String.fromCharCode(escapedCharCode);
        }
    }

    return deserializedString;
}

/**
 * Reverses a DynamoDB key attribute.
 *
 * The reversed format is a hexadecimal encoding of the input string where
 * every character is reversed. We also append a value larger than any other
 * character to the end so that short strings are sorted last.
 */
export function serializeReversedDynamoKeyAttribute(
    keyAttribute: DynamoKeyAttribute,
): DynamoKeyAttribute {
    const bytes = new Uint8Array(keyAttribute.length + 1);

    for (let index = 0; index < keyAttribute.length; index++) {
        const reversedCharCode = 126 - keyAttribute.charCodeAt(index);
        bytes[index] = reversedCharCode;
    }

    // As the last byte, add an integer larger than any other. This way shorter
    // strings will short after longer strings.
    bytes[keyAttribute.length] = 127;

    // Convert our bytes into hexadecimal which will maintain the byte
    // order lexicographically.
    const reversedKeyAttribute = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(
        "",
    );
    return reversedKeyAttribute as DynamoKeyAttribute;
}

/**
 * Deserializes our reversed DynamoDB key attribute serialization format.
 */
export function deserializeReversedDynamoKeyAttribute(
    reversedKeyAttribute: DynamoKeyAttribute,
): DynamoKeyAttribute {
    // Hexadecimal string should be non-empty, only contain valid characters, with
    // an even number of characters.
    assert(/^[0-9a-f]+$/.test(reversedKeyAttribute));
    assert(reversedKeyAttribute.length % 2 === 0);

    const bytes = Uint8Array.from(
        reversedKeyAttribute.match(/.{2}/g)!.map(byte => parseInt(byte, 16)),
    );

    assert(bytes[bytes.length - 1] === 127);

    const chars = [];

    for (let index = 0; index < bytes.length - 1; index++) {
        const charCode = 126 - bytes[index]!;
        chars.push(String.fromCharCode(charCode));
    }

    return chars.join("") as DynamoKeyAttribute;
}

function compareBytes(bytes1: Uint8Array, bytes2: Uint8Array): number {
    for (let i = 0; i < Math.min(bytes1.length, bytes2.length); i++) {
        const byte1 = bytes1[i]!;
        const byte2 = bytes2[i]!;
        const order = byte1 - byte2;
        if (order !== 0) return clamp(-1, order, 1);
    }

    if (bytes1.length < bytes2.length) return -1;
    if (bytes1.length > bytes2.length) return 1;
    return 0;
}
