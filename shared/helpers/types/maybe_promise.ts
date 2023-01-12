/**
 * A type that may be a promise. Or it may be the promise's underlying value
 * returned immediately.
 */
export type MaybePromise<T> = T | Promise<T>;
