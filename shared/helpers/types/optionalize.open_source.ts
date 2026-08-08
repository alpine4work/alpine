import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.open_source.js";

/**
 * Convert all properties of an object that include `undefined` to optional
 * properties.
 *
 * Does not convert properties that include `null` to optional properties. Use
 * `OptionalizeNullable` for that.
 */
export type Optionalize<O> = MergeObjectIntersection<
    {readonly [K in KeyofWithoutUndefined<O>]: O[K]} & {
        readonly [K in KeyofWithUndefined<O>]?: O[K];
    }
>;

type IfUndefinedButNotUnknown<T, Y, N> = unknown extends T ? N : undefined extends T ? Y : N;

type KeyofWithUndefined<O> = {
    [K in keyof O]: IfUndefinedButNotUnknown<O[K], K, never>;
}[keyof O];

type KeyofWithoutUndefined<O> = {
    [K in keyof O]: IfUndefinedButNotUnknown<O[K], never, K>;
}[keyof O];
