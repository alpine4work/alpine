// Type is derived from:
// https://github.com/type-challenges/type-challenges

/**
 * Converts a union type to an intersection type.
 *
 * So if you have `{a: number} | {b: number} | {c: number}` then it becomes
 * `{a: number} & {b: number} & {c: number}`.
 */
export type UnionToIntersection<U> =
    UnionToFunctionUnion<U> extends (arg: infer Arg) => unknown ? Arg : never;

type UnionToFunctionUnion<U> = U extends unknown ? (arg: U) => unknown : never;
