/**
 * Produces an iterable that yields the elements of an array in reverse.
 *
 * The input must be an array (or array-like object) since we need to know the
 * length ahead of time. You can't generically reverse an iterable without first
 * coercing it into an array which is O(n).
 */
export function* reverseIterable<Value>(array: ArrayLike<Value>): Iterable<Value> {
    for (let index = array.length - 1; index >= 0; index--) {
        yield array[index]!;
    }
}
