/**
 * Creates an array with the provided length and populates every item of the array
 * with the `createItem()` function.
 *
 * You may be used to code which does this with
 * `Array(length).fill(null).map(() => { ... })` which is harder to read.
 */
export function createArrayWithLength<Item>(
    length: number,
    createItem: (index: number, length: number) => Item,
): Array<Item> {
    const array = [];

    for (let index = 0; index < length; index++) {
        array.push(createItem(index, length));
    }

    return array;
}
