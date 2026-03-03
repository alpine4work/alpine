/**
 * Create a TypeScript tuple with a dynamic length.
 */
// Implementation derived from: https://stackoverflow.com/a/52490977/1568890
export type Tuple<T, N extends number> = N extends N
    ? number extends N
        ? Array<T>
        : TupleOf<T, N, []>
    : never;

type TupleOf<T, N extends number, R extends Array<unknown>> = R["length"] extends N
    ? R
    : TupleOf<T, N, [T, ...R]>;

/**
 * Create a readonly TypeScript tuple with a dynamic length.
 */
// Implementation derived from: https://stackoverflow.com/a/52490977/1568890
export type ReadonlyTuple<T, N extends number> = N extends N
    ? number extends N
        ? ReadonlyArray<T>
        : ReadonlyTupleOf<T, N, readonly []>
    : never;

type ReadonlyTupleOf<T, N extends number, R extends ReadonlyArray<unknown>> = R["length"] extends N
    ? R
    : ReadonlyTupleOf<T, N, readonly [T, ...R]>;
