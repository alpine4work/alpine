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
