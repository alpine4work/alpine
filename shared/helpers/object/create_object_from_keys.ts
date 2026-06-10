/**
 * Creates an object from an array of keys. Where the value of each key is created
 * by the provided function.
 */
export function createObjectFromKeys<const Keys extends ReadonlyArray<string | number>, Value>(
    keys: Keys,
    createValue: (key: Keys[number]) => Value,
): {[Key in Keys[number]]: Value} {
    return Object.fromEntries(keys.map(key => [key, createValue(key)])) as any;
}
