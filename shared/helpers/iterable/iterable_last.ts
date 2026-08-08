import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";

/**
 * Return the last value from the iterable. Must iterate through the entire
 * iterable.
 *
 * There's an optimized case for arrays which simply reads the last element without
 * iterating.
 */
export function iterableLast<Value>(iterable: Iterable<Value>): Value | undefined {
    if (isReadonlyArray(iterable)) return iterable[iterable.length - 1];

    let value: Value | undefined;
    for (const item of iterable) value = item;
    return value;
}
