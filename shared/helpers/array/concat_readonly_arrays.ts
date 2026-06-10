import {emptyArray} from "~/shared/helpers/array/empty_array.js";

/**
 * Concatenate read-only arrays. This is more efficient than `Array.concat()` since
 * if all the arrays except one are empty then instead of returning a shallow copy
 * we return the one non-empty array. Only makes sense if the arrays are immutable.
 */
export function concatReadonlyArrays<Value>(
    ...arrays: ReadonlyArray<ReadonlyArray<Value>>
): ReadonlyArray<Value> {
    // Optimized case for when there are only two arrays.
    if (arrays.length === 2) {
        if (arrays[0]!.length === 0) return arrays[1]!;
        if (arrays[1]!.length === 0) return arrays[0]!;
        return [...arrays[0]!, ...arrays[1]!];
    }

    let onlyNonEmptyArray: ReadonlyArray<Value> | undefined;

    for (const array of arrays) {
        if (array.length === 0) continue;

        if (onlyNonEmptyArray === undefined) {
            onlyNonEmptyArray = array;
        } else {
            const newArray: Array<Value> = [];

            for (const array of arrays) {
                for (const value of array) {
                    newArray.push(value);
                }
            }

            return newArray;
        }
    }

    if (onlyNonEmptyArray === undefined) {
        return emptyArray;
    } else {
        return onlyNonEmptyArray;
    }
}
