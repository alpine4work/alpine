/**
 * Returns an iterable that yields one value from each input iterable in order,
 * repeating until every iterable is exhausted.
 *
 * If an iterable ends before the others, the remaining iterables keep
 * alternating without it.
 */
export function* alternateIterables<Value>(...iterables: Array<Iterable<Value>>): Iterable<Value> {
    const iterators = iterables.map(iterable => iterable[Symbol.iterator]());

    while (iterators.length > 0) {
        let nextIndex = 0;

        while (nextIndex < iterators.length) {
            const index = nextIndex;
            const iterator = iterators[index]!;
            nextIndex++;

            const result = iterator.next();
            if (result.done) {
                iterators.splice(index, 1);
                nextIndex--;
            } else {
                yield result.value;
            }
        }
    }
}
