import {MergeObjectIntersection} from "~/shared/helpers/types/merge-object-intersection";

/**
 * Convert all properties of an object that include `undefined` to optional
 * properties.
 *
 * Does not convert properties that include `null` to optional properties. Use
 * `OptionalizeNull` for that.
 */
export type Optionalize<O> = MergeObjectIntersection<
    {readonly [K in KeyofWithoutUndefined<O>]: O[K]} & {
        readonly [K in KeyofWithUndefined<O>]?: O[K];
    }
>;

type IfUndefined<T, Y, N> = undefined extends T ? Y : N;

type KeyofWithUndefined<O> = {
    [K in keyof O]: IfUndefined<O[K], K, never>;
}[keyof O];

type KeyofWithoutUndefined<O> = {
    [K in keyof O]: IfUndefined<O[K], never, K>;
}[keyof O];
