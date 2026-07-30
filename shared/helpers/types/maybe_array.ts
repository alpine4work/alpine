import type {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";

/**
 * Represents a value that might be wrapped in an array.
 */
export type MaybeArray<Value> = Value | Array<Value>;

/**
 * Represents a value that might be wrapped in an array.
 */
export type MaybeReadonlyArray<Value> = Value | ReadonlyArray<Value>;

/**
 * Represents a value that might be wrapped in a non-empty readonly array.
 */
export type MaybeNonEmptyReadonlyArray<Value> = Value | NonEmptyReadonlyArray<Value>;
