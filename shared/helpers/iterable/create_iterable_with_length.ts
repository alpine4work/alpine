/**
 * Creates an iterable with the provided length and populates every item of the
 * iterable with the `createItem()` function.
 *
 * Same as `createArrayWithLength()` but for iterables.
 */
export function* createIterableWithLength<Item>(
    length: number,
    createItem: (index: number, length: number) => Item,
): IterableIterator<Item> {
    for (let index = 0; index < length; index++) {
        yield createItem(index, length);
    }
}
