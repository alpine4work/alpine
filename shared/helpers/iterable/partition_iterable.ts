import {Queue} from "~/shared/helpers/array/queue.open_source.js";

/**
 * Splits an iterable in two. The iterable array is for all items where `predicate`
 * returns true. The second iterable is for all items where `predicate` returns
 * false.
 *
 * Named after Lodash's [`partition` function][1].
 *
 * [1]: https://lodash.com/docs/4.17.15#partition
 */
export function partitionIterable<Value>(
    iterable: Iterable<Value>,
    predicate: (value: Value) => boolean,
): [IterableIterator<Value>, IterableIterator<Value>] {
    const iterator = iterable[Symbol.iterator]();

    let done = false;
    let trueQueue: Queue<Value> | undefined;
    let falseQueue: Queue<Value> | undefined;

    const trueIterator: IterableIterator<Value> = {
        [Symbol.iterator]: () => trueIterator,
        next: (): IteratorResult<Value, undefined> => {
            if (trueQueue !== undefined && trueQueue.size > 0) {
                const value = trueQueue.dequeue()!;
                return {done: false, value};
            }

            if (done) return {done: true, value: undefined};

            while (true) {
                const step = iterator.next();
                if (step.done) {
                    done = true;
                    return {done: true, value: undefined};
                }

                if (predicate(step.value)) {
                    return {done: false, value: step.value};
                } else {
                    falseQueue ??= new Queue();
                    falseQueue.enqueue(step.value);
                }
            }
        },
    };

    const falseIterator: IterableIterator<Value> = {
        [Symbol.iterator]: () => falseIterator,
        next: (): IteratorResult<Value> => {
            if (falseQueue !== undefined && falseQueue.size > 0) {
                const value = falseQueue.dequeue()!;
                return {done: false, value};
            }

            if (done) return {done: true, value: undefined};

            while (true) {
                const step = iterator.next();
                if (step.done) return {done: true, value: undefined};

                if (predicate(step.value)) {
                    trueQueue ??= new Queue();
                    trueQueue.enqueue(step.value);
                } else {
                    return {done: false, value: step.value};
                }
            }
        },
    };

    return [trueIterator, falseIterator];
}
