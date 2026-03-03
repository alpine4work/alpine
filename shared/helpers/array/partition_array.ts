/**
 * Splits an array in two. The first array is for all items where `predicate`
 * returns true. The second array is for all items where `predicate` returns false.
 *
 * Named after Lodash's [`partition` function][1].
 *
 * [1]: https://lodash.com/docs/4.17.15#partition
 */
export function partitionArray<Value, TrueValue extends Value>(
    array: ReadonlyArray<Value>,
    predicate: (value: Value, index: number) => value is TrueValue,
): [Array<TrueValue>, Array<Exclude<Value, TrueValue>>];
export function partitionArray<Value>(
    array: ReadonlyArray<Value>,
    predicate: (value: Value, index: number) => boolean,
): [Array<Value>, Array<Value>];
export function partitionArray<Value>(
    array: ReadonlyArray<Value>,
    predicate: (value: Value, index: number) => boolean,
): [Array<Value>, Array<Value>] {
    const trueArray: Array<Value> = [];
    const falseArray: Array<Value> = [];

    let index = 0;
    for (const value of array) {
        if (predicate(value, index++)) {
            trueArray.push(value);
        } else {
            falseArray.push(value);
        }
    }

    return [trueArray, falseArray];
}
