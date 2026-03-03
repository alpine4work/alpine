/**
 * Compares two arrays for sorting. Compares each item individually. If the arrays
 * have unequal lengths then the shorter array comes first and the longer array
 * comes second.
 */
export function compareArrays<Value>(
    array1: ArrayLike<Value>,
    array2: ArrayLike<Value>,
    compare: (value1: Value, value2: Value) => number,
): number {
    for (let i = 0; i < Math.min(array1.length, array2.length); i++) {
        const value1 = array1[i]!;
        const value2 = array2[i]!;
        const order = compare(value1, value2);
        if (order !== 0) return order;
    }

    if (array1.length < array2.length) return -1;
    if (array1.length > array2.length) return 1;
    return 0;
}
