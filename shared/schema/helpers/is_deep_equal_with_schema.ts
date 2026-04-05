import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * `isDeepEqual()` only performs a referential equality check on custom JavaScript
 * classes. So if you have an object that may contain custom classes, first use a
 * schema to serialize to JSON before performing a deep equality check.
 *
 * This helper performs a deep equality check by first serializing the values using
 * a schema.
 */
export function isDeepEqualWithSchema<Value>(
    schema: Schema<Value>,
    value1: Value | null | undefined,
    value2: Value | null | undefined,
): boolean {
    if (value1 === null || value1 === undefined || value2 === undefined || value2 === null)
        return value1 === value2;

    return isDeepEqual(schema.serialize(value1), schema.serialize(value2));
}
