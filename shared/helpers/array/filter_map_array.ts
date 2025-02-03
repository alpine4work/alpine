/**
 * Map each individual value of an array and remove null values. Same as a
 * combination of `Array.filter()` and `Array.map()` but in one iteration.
 */
export function filterMapArray<Value, NewValue>(
    array: Iterable<Value>,
    filterMap: (value: Value, index: number) => NewValue | undefined,
): Array<NewValue> {
    const newArray: Array<NewValue> = [];

    let index = 0;
    for (const value of array) {
        const newValue = filterMap(value, index++);
        if (newValue !== undefined) newArray.push(newValue);
    }

    return newArray;
}
