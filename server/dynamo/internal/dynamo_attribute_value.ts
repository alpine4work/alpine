// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {InternalError} from "~/shared/error/error";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    JsonStringifiableUint8Array,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

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
            if (value instanceof Uint8Array) return {B: value};
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
    if (value.B !== undefined) return new JsonStringifiableUint8Array(value.B);
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
