/**
 * By default, when calling a generic function TypeScript will try to infer the
 * least upper bound for all parameter types. For example in:
 *
 * ```
 * declare function f<T>(a: T, b: T): T;
 * f(42, 'foo');
 * ```
 *
 * The result type will be `number | string`. In some cases, though, we'd like
 * TypeScript to infer `number` and error on the second argument.
 *
 * This utility type will exclude the provided type parameter from inference.
 */
export type BlockInference<T> = T extends infer U ? U : never;
