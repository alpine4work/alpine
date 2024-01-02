/**
 * Splits an array in two. The first array is for all items where `predicate`
 * returns true. The second array is for all items where `predicate`
 * returns false.
 *
 * Named after Lodash's [`partition` function][1].
 *
 * [1]: https://lodash.com/docs/4.17.15#partition
 */
export function partitionArray<Value>(
    array: ReadonlyArray<Value>,
    predicate: (value: Value) => boolean,
): [Array<Value>, Array<Value>] {
    const trueArray: Array<Value> = [];
    const falseArray: Array<Value> = [];

    for (const value of array) {
        if (predicate(value)) {
            trueArray.push(value);
        } else {
            falseArray.push(value);
        }
    }

    return [trueArray, falseArray];
}
