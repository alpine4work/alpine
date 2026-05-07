/**
 * Build a comparator that orders objects by a single field. Useful with
 * `Array.prototype.sort()` when items are records and you want to compare a
 * specific property using a known comparator.
 *
 * @example
 *
 * ```ts
 * items.sort(compareByObjectKey("orderKey", defaultCompareStrings));
 * ```
 */
export function compareByObjectKey<Key extends string, Value>(
    key: Key,
    compare?: (value1: Value, value2: Value) => number,
) {
    compare ??= (value1: Value, value2: Value) => {
        if (value1 < value2) return -1;
        if (value1 > value2) return 1;
        return 0;
    };

    return (object1: Record<Key, Value>, object2: Record<Key, Value>) => {
        return compare(object1[key], object2[key]);
    };
}
