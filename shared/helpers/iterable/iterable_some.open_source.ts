/**
 * Returns true if some item in the iterable returns true for the provided
 * function. The same as `Array.some()` but for iterables.
 */
export function iterableSome<Item>(
    iterable: Iterable<Item>,
    predicate: (item: Item, index: number) => boolean,
): boolean {
    const iterator = iterable[Symbol.iterator]();
    let index = 0;

    while (true) {
        const step = iterator.next();
        if (step.done) return false;

        if (predicate(step.value, index)) {
            return true;
        }

        index++;
    }
}
