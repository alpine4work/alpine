// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {InternalError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    JsonStringifiableUint8Array,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
} from "~/shared/schema/schema.js";

/**
 * The DynamoDB API has this awkward format where the type for all values must
 * be tagged. This function converts from our serialized value format to
 * DynamoDB's attribute value format.
 */
// NOTE(calebmer): The extra object allocation and traversal is a little annoying.
// What if we implemented our own custom DynamoDB client that made HTTP calls
// directly to DynamoDB? Then we could directly write values to a stream and avoid
// some excess iteration.
//
// We could also likely build a faster serialization/deserialization API into
// `Schema`. For instance, what if `Schema` generated code that directly wrote
// to our DynamoDB stream in the right attribute value? So fast.
export function intoDynamoAttributeValue(value: SchemaSerializedValue): types.AttributeValue {
    switch (typeof value) {
        case "boolean":
            return {BOOL: value};
        case "number":
            return {N: JSON.stringify(value)};
        case "string":
            return {S: value};
        case "object": {
            if (value === null) return {NULL: true};
            if (isReadonlyArray(value)) return {L: value.map(intoDynamoAttributeValue)};

            // NOTE(calebmer, 2023-07-27): Since right now we use `awsfetch` directly
            // instead of the AWS SDK, it's important that `B` is a
            // `JsonStringifiableUint8Array` so when we `JSON.stringify()` it is base64
            // encoded.
            if (value instanceof JsonStringifiableUint8Array) return {B: value};

            return {M: intoDynamoAttributeValueObject(value)};
        }
        default:
            throw exhaustive(value);
    }
}

export function intoDynamoAttributeValueObject(value: SchemaSerializedObjectValue): {
    [key: string]: types.AttributeValue;
} {
    const newObject: {[key: string]: types.AttributeValue} = {};

    for (const [key, keyValue] of Object.entries(value)) {
        if (keyValue === undefined) continue;
        newObject[key] = intoDynamoAttributeValue(keyValue);
    }

    return newObject;
}

/**
 * The DynamoDB API has this awkward format where the type for all values must
 * be tagged. This function converts from the DynamoDB attribute value format
 * to our serialized value format.
 */
export function fromDynamoAttributeValue(value: types.AttributeValue): SchemaSerializedValue {
    if (value.NULL !== undefined) return null;
    if (value.BOOL !== undefined) return value.BOOL;
    if (value.N !== undefined) return JSON.parse(value.N);
    if (value.S !== undefined) return value.S;
    if (value.L !== undefined) return value.L.map(fromDynamoAttributeValue);

    // NOTE(calebmer, 2023-07-27): Since right now we use `awsfetch` directly
    // instead of the AWS SDK, `B` is a base64 encoded string not a `Uint8Array`.
    if (value.B !== undefined) {
        const array = typeof value.B === "string" ? decodeBase64((value as any).B) : value.B;
        return new JsonStringifiableUint8Array(
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            array.buffer,
            array.byteOffset,
            array.byteLength,
        );
    }

    if (value.M !== undefined) return fromDynamoAttributeValueObject(value.M);

    throw new InternalError("Unexpected DynamoDB attribute value");
}

export function fromDynamoAttributeValueObject(value: {
    [key: string]: types.AttributeValue;
}): SchemaSerializedObjectValue {
    const newObject: {[key: string]: SchemaSerializedValue} = {};

    for (const [key, keyValue] of Object.entries(value)) {
        if (keyValue === undefined) continue;
        newObject[key] = fromDynamoAttributeValue(keyValue);
    }

    return newObject;
}
