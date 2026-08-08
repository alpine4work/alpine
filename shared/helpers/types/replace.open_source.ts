/**
 * Replaces properties in `T` with properties of the same name from `U`.
 *
 * So `Replace<{a: number, b: number}, {b: string}>` becomes
 * `{a: number, b: string}`.
 *
 * This is different from the intersection operator which intersects properties of
 * the same name. So `{a: number, b: number} & {b: string}` becomes
 * `{a: number, b: number & string}`.
 */
export type Replace<T, U> = Omit<T, keyof U> & U;
