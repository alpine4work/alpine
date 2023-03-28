import {DynamoEmailAddressSchema} from "~/server/dynamo/internal/dynamo_email_address_schema";
import {EmailAddress} from "~/server/emails/email_address";
import {assert} from "~/shared/helpers/control/assert";
import {
    DateString,
    deserializeDateString,
    isDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string";
import {maxIsoLexicographicallySortableDate} from "~/shared/helpers/date/max_date";
import {
    ElenFloat,
    decodeElenFloatIfPossible,
    encodeElenFloat,
} from "~/shared/helpers/number/elen_float";
import {
    ElenInteger,
    decodeElenIntegerIfPossible,
    encodeElenInteger,
} from "~/shared/helpers/number/elen_integer";
import {OrderKey, isOrderKey} from "~/shared/helpers/sort/order_key";
import {Id, getMaxId, getMinId, isId} from "~/shared/id/id";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";

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
    | {readonly type: "Boolean"}
    | {readonly type: "Integer"}
    | {readonly type: "Float"}
    | {readonly type: "OrderKey"}
    | {readonly type: "LabelString"}
    | {readonly type: "EmailAddress"}
    | {readonly type: "Reverse"; readonly schema: DynamoKeyAttributeSchemaDescription}
    | {readonly type: "Nullable"; readonly schema: DynamoKeyAttributeSchemaDescription};

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
        serialize: value => value,
        deserialize: keyAttribute => {
            assert(isId(keyAttribute));
            return keyAttribute;
        },
    });

    /**
     * Dates are serialized to [ISO 8601][1].
     *
     * [1]: https://en.wikipedia.org/wiki/ISO_8601
     */
    public static date = Object.assign(
        new DynamoKeyAttributeSchema<Date>({
            description: {type: "Date"},
            serialize: date => {
                // If the date is larger than `maxIsoLexicographicallySortableDate` it won't be
                // sorted properly by DynamoDB.
                assert(
                    date.getTime() <= maxIsoLexicographicallySortableDate.getTime(),
                    "DynamoDB date key attribute too large",
                );
                return serializeDateString(date);
            },
            deserialize: keyAttribute => {
                assert(isDateString(keyAttribute));
                return deserializeDateString(keyAttribute);
            },
        }),
        {
            maxValue: maxIsoLexicographicallySortableDate,
        },
    );

    /**
     * Booleans are serialized to either the `true` or `false` string.
     */
    public static boolean = new DynamoKeyAttributeSchema<boolean>({
        description: {type: "Boolean"},
        serialize: value => (value ? "true" : "false") as DynamoKeyAttribute,
        deserialize: value => value === "true",
    });

    /**
     * Integers are serialized to an `ElenInteger`.
     */
    public static integer = new DynamoKeyAttributeSchema<number>({
        description: {type: "Integer"},
        serialize: encodeElenInteger,
        deserialize: keyAttribute => {
            const value = decodeElenIntegerIfPossible(keyAttribute);
            assert(value !== null);
            return value;
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
        serialize: encodeElenFloat,
        deserialize: keyAttribute => {
            const value = decodeElenFloatIfPossible(keyAttribute);
            assert(value !== null);
            return value;
        },
    });

    /**
     * `OrderKey`s have a natural lexicographic order.
     */
    public static orderKey = new DynamoKeyAttributeSchema<OrderKey>({
        description: {type: "OrderKey"},
        serialize: value => value,
        deserialize: keyAttribute => {
            assert(isOrderKey(keyAttribute));
            return keyAttribute;
        },
    });

    /**
     * A short, single-line, string that is validated with `LabelStringSchema`.
     */
    public static labelString = new DynamoKeyAttributeSchema<string>({
        description: {type: "LabelString"},
        serialize: value => {
            const serializedString = LabelStringSchema.serialize(value);
            assert(typeof serializedString === "string");
            return serializeStringDynamoKeyAttribute(serializedString);
        },
        deserialize: keyAttribute =>
            LabelStringSchema.deserialize(deserializeStringDynamoKeyAttribute(keyAttribute)),
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
        serialize: value => {
            const serializedString = DynamoEmailAddressSchema.serialize(value);
            assert(typeof serializedString === "string");
            return serializeStringDynamoKeyAttribute(serializedString);
        },
        deserialize: keyAttribute =>
            DynamoEmailAddressSchema.deserialize(deserializeStringDynamoKeyAttribute(keyAttribute)),
    });

    /**
     * The description of this attribute for backwards compatibility checking
     * purposes.
     */
    public readonly description: DynamoKeyAttributeSchemaDescription;

    /**
     * Serializes the attribute value into a DynamoDB key attribute.
     */
    public readonly serialize: (value: Value) => DynamoKeyAttribute;

    /**
     * Deserializes the DynamoDB key attribute into our attribute value. Throws if
     * the DynamoDB key attribute is incorrectly formatted.
     */
    public readonly deserialize: (keyAttribute: DynamoKeyAttribute) => Value;

    private constructor({
        description,
        serialize,
        deserialize,
    }: {
        description: DynamoKeyAttributeSchemaDescription;
        serialize: (value: Value) => DynamoKeyAttribute;
        deserialize: (keyAttribute: DynamoKeyAttribute) => Value;
    }) {
        this.description = description;
        this.serialize = serialize;
        this.deserialize = deserialize;
    }

    /**
     * Order our values in reverse.
     *
     * Does this by serializing the value into a hexadecimal string with reverse
     * byte order from the input string.
     */
    public reverse(): DynamoKeyAttributeSchema<Value> {
        return new DynamoKeyAttributeSchema<Value>({
            description: {type: "Reverse", schema: this.description},
            serialize: value => {
                const keyAttribute = this.serialize(value);
                return serializeReversedDynamoKeyAttribute(keyAttribute);
            },
            deserialize: reversedKeyAttribute => {
                const keyAttribute = deserializeReversedDynamoKeyAttribute(reversedKeyAttribute);
                return this.deserialize(keyAttribute);
            },
        });
    }

    /**
     * Allow the key value to be null.
     *
     * If null then the value serializes to `0`. Otherwise we append `1-` to the
     * serialized value. This means that null values always come first.
     */
    public nullable(): DynamoKeyAttributeSchema<Value | null> {
        return new DynamoKeyAttributeSchema<Value | null>({
            description: {type: "Nullable", schema: this.description},
            serialize: value => {
                if (value === null) return "0" as DynamoKeyAttribute;
                const keyAttribute = this.serialize(value);
                return `1-${keyAttribute}` as DynamoKeyAttribute;
            },
            deserialize: nullableKeyAttribute => {
                if (nullableKeyAttribute === "0") return null;
                assert(nullableKeyAttribute.startsWith("1-"));
                const keyAttribute = nullableKeyAttribute.slice(2) as DynamoKeyAttribute;
                return this.deserialize(keyAttribute);
            },
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

    let newString = "";

    for (let index = 0; index < string.length; index++) {
        const char = string[index]!;
        const charCode = string.charCodeAt(index);

        if (
            charCode >= dynamoKeyAttributeMinCharCode &&
            charCode <= dynamoKeyAttributeMaxCharCode &&
            // Make sure we escape the backslash character and the double quote character.
            // That way we can parse the string using JSON.
            char !== "\\" &&
            char !== '"'
        ) {
            newString += char;
        } else {
            // Any characters outside our key attribute character range need to be escaped
            // using a Unicode escape sequence.
            newString += `\\u${charCode.toString(16).padStart(4, "0").toUpperCase()}`;
        }
    }

    return newString as DynamoKeyAttribute;
}

/**
 * Deserializes a string produced from `serializeStringDynamoKeyAttribute()`
 * back into a regular string.
 */
function deserializeStringDynamoKeyAttribute(string: string): string {
    return JSON.parse(`"${string}"`);
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
