import {IdentityType} from "~/shared/helpers/types/identity_type.open_source.js";

/**
 * Takes an object intersection type and merges it into a single object type for
 * when TypeScript displays the type in an IDE.
 *
 * Example:
 *
 * ```
 * type T = MergeObjectIntersectionType<{a: number} & {b?: string}>;
 * ```
 *
 * If you hover over `T` you will see `{a: number, b?: string}`.
 *
 * Implementation taken from [`ts-sql`][1].
 *
 * [1]:
 *     https://github.com/codemix/ts-sql/blob/de9dc91a30a0ce9340bed719ba6c0d564504ea56/src/Utils/ObjectUtils.ts
 */
export type MergeObjectIntersection<T> = IdentityType<{readonly [K in keyof T]: T[K]}>;
