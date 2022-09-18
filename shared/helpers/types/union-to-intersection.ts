// Type is derived from:
// https://github.com/type-challenges/type-challenges

/**
 * Converts a union type to an intersection type.
 *
 * So if you have `{a: number} | {b: number} | {c: number}` then it becomes
 * `{a: number} & {b: number} & {c: number}`.
 */
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
    k: infer I,
) => void
    ? I
    : never;
