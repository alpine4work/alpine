/**
 * Count the number of items in the iterable. Same as `Array.length` but with an
 * iterable.
 */
export function countIterable<Item>(iterable: Iterable<Item>) {
    let count = 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const item of iterable) {
        count++;
    }

    return count;
}
