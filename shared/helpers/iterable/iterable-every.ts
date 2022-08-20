/**
 * Returns true if every item in the iterable returns true for the provided
 * function. The same as `Array.every()` but for iterables.
 */
export function iterableEvery<Item>(
    iterable: Iterable<Item>,
    predicate: (item: Item, index: number) => boolean,
): boolean {
    const iterator = iterable[Symbol.iterator]();
    let index = 0;

    while (true) {
        const step = iterator.next();
        if (step.done) return true;

        if (!predicate(step.value, index)) {
            return false;
        }

        index++;
    }
}
