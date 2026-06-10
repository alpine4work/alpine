import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";

/**
 * Returns an iterable that's a section of the input. Same as `Array.slice()`
 * except we don't accept negative indexes.
 */
export function sliceIterable<Value>(
    iterable: Iterable<Value>,
    start: number,
    end?: number,
): Iterable<Value> {
    return {
        [Symbol.iterator]: function* () {
            // Optimization: If this is an array then we can start iterating from the middle of
            // the array instead of the start.
            if (isReadonlyArray(iterable)) {
                const length = Math.min(end ?? iterable.length, iterable.length);
                for (let index = start; index < length; index++) {
                    yield iterable[index];
                }
                return;
            }

            let index = 0;
            for (const value of iterable) {
                if (typeof end === "number" && index >= end) break;

                if (index >= start) {
                    yield value;
                }

                index++;
            }
        },
    };
}
