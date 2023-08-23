/**
 * A `ReadonlyArray<T>` that is not empty.
 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...ReadonlyArray<T>];

export function isNonEmptyReadonlyArray<T>(
    array: ReadonlyArray<T>,
): array is NonEmptyReadonlyArray<T> {
    return array.length > 0;
}
