// Type is derived from:
// https://github.com/type-challenges/type-challenges/issues/3382

/**
 * Takes a tuple of object entries and turns it into an object type.
 *
 * Example:
 *
 * ```
 * type T = [
 *    ["a", number],
 *    ["b", string],
 * ];
 *
 * type U = ObjectFromEntries<T>;
 * ```
 *
 * `U` is `{a: number, b: string}`.
 *
 * This solution doesn't use `UnionToIntersection` which we find can sometimes
 * causes problems with generic types.
 */
export type ObjectFromEntries<Entries extends ReadonlyArray<[string, any]>> =
    ObjectFromEntriesUnion<Entries[number]>;

type ObjectFromEntriesUnion<Entries extends [string, any]> = {
    [Key in Entries[0]]: Entries extends [Key, any] ? Entries[1] : never;
};
