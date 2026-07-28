import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {
    MaybeArray,
    MaybeNonEmptyReadonlyArray,
    MaybeReadonlyArray,
} from "~/shared/helpers/types/maybe_array.js";

/**
 * Always returns an array. If the value is already an array, it is returned as-is.
 * Otherwise, the value is wrapped in an array.
 */
export function wrapMaybeArray<Value>(value: MaybeArray<Value>): Array<Value> {
    return Array.isArray(value) ? value : [value];
}

/**
 * Always returns an array. If the value is already an array, it is returned as-is.
 * Otherwise, the value is wrapped in an array.
 */
export function wrapMaybeReadonlyArray<Value>(
    value: MaybeReadonlyArray<Value>,
): ReadonlyArray<Value> {
    return isReadonlyArray(value) ? value : [value];
}

/**
 * Always returns an array. If the value is already an array, it is returned as-is.
 * Otherwise, the value is wrapped in an array.
 */
export function wrapMaybeNonEmptyReadonlyArray<Value>(
    value: MaybeNonEmptyReadonlyArray<Value>,
): NonEmptyReadonlyArray<Value> {
    return isReadonlyArray(value) ? value : [value];
}
