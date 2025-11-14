/**
 * Add all the numbers in the iterable together. Same as
 * `reduceIterable(iterable, (a, b) => a + b, 0)`.
 */
export function sumIterable(iterable: Iterable<number>): number {
    let value = 0;

    for (const item of iterable) {
        value += item;
    }

    return value;
}
