/**
 * Same as `Array.isArray()` but it returns a `ReadonlyArray<T>` instead of an
 * `Array<T>`.
 */
export const isReadonlyArray: (value: unknown) => value is ReadonlyArray<any> = Array.isArray;
