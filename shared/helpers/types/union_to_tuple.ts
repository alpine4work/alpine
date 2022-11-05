// Type is derived from:
// https://github.com/type-challenges/type-challenges

import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection";

/**
 * Converts a union into a tuple where each union member is a tuple element.
 *
 * So if you have `"a" | "b" | "c"` then it will become `["a", "b", "c"]`.
 */
export type UnionToTuple<T, A extends Array<unknown> = []> = IsUnion<T> extends true
    ? UnionToTuple<Exclude<T, PopUnion<T>>, [PopUnion<T>, ...A]>
    : [T, ...A];

type UnionToOverloadedFunction<U> = UnionToIntersection<U extends any ? (f: U) => void : never>;

type PopUnion<U> = UnionToOverloadedFunction<U> extends (a: infer A) => void ? A : never;

type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
