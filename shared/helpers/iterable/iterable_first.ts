/**
 * Return the first value from the iterable.
 */
export function iterableFirst<Value>(iterable: Iterable<Value>): Value | undefined {
    const iterator = iterable[Symbol.iterator]();
    const step = iterator.next();
    return step.done ? undefined : step.value;
}
