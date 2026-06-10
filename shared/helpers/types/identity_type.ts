/**
 * Returns exactly the type that was passed in.
 *
 * The type has a useful property when you're doing TypeScript meta-programming. It
 * makes TypeScript show an evaluated type instead of a type alias with its input.
 *
 * Example:
 *
 * ```
 * type MergeObjectIntersection<T> = {[K in keyof T]: T[K]};
 *
 * type F<O> = {
 *   [K in keyof O]: MergeObjectIntersection<{key: K} & {value: O[K]}>;
 * };
 *
 * type T = F<{
 *   a: number,
 *   b: string,
 * }>;
 * ```
 *
 * If you hover over `T` here in an IDE you get:
 *
 * ```
 * type T = {
 *   a: MergeObjectIntersection<{
 *     key: "a";
 *   } & {
 *     value: number;
 *   }>;
 *   b: MergeObjectIntersection<{
 *     key: "b";
 *   } & {
 *     value: string;
 *   }>;
 * };
 * ```
 *
 * Which is difficult to read. But if you use `Identity<>` in
 * `MergeObjectIntersection<>` like this:
 *
 * ```
 * type MergeObjectIntersection<T> = Identity<{[K in keyof T]: T[K]}>;
 * ```
 *
 * Then instead when you hover `T` you get:
 *
 * ```
 * type T = {
 *   a: {
 *     key: "a";
 *     value: number;
 *   };
 *   b: {
 *     key: "b";
 *     value: string;
 *   };
 * };
 * ```
 *
 * Which is a much cleaner type.
 */
export type IdentityType<T> = T;
