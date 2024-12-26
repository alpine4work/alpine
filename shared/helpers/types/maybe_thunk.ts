/**
 * Represents a value that's available immediately or a value that's produced
 * lazily (by calling a function).
 */
export type MaybeThunk<Value, Args extends ReadonlyArray<unknown> = []> =
    | Value
    | ((...args: Args) => Value);
