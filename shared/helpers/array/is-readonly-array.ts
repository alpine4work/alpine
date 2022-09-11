/**
 * Same as `Array.isArray()` but it returns a `ReadonlyArray<T>` instead of
 * an `Array<T>`.
 */
export function isReadonlyArray(value: unknown): value is ReadonlyArray<any> {
    return Array.isArray(value);
}
