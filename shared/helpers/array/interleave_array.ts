/**
 * Create a new array where the provided separator is interleaved between every
 * item. Similar to `Array.join()` but you can join without a string.
 *
 * If a function is provided for the separator, you can create a new item for each
 * separator position.
 *
 * Example:
 *
 * ```ts
 * interleaveArray(["a", "b", "c"], "; ");
 * ```
 *
 * Returns:
 *
 * ```ts
 * ["a", "; ", "b", "; ", "c"];
 * ```
 */
export function interleaveArray<Item, NewItem>(
    array: ReadonlyArray<Item>,
    separatorItem: NewItem | ((index: number) => NewItem),
): Array<Item | NewItem> {
    const newArray: Array<Item | NewItem> = [];

    for (let index = 0; index < array.length; index++) {
        const item = array[index]!;

        newArray.push(item);

        if (index !== array.length - 1) {
            if (typeof separatorItem === "function") {
                newArray.push((separatorItem as any)(index));
            } else {
                newArray.push(separatorItem);
            }
        }
    }

    return newArray;
}
