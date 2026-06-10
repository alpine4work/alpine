/**
 * A [queue][1] is a collection of values that are maintained in sequence and can
 * be modified by the addition of values at one of the queue and removal of values
 * at the other end of the queue.
 *
 * You can implement a queue in JavaScript simply using an array's `push()` and
 * `shift()` methods. However, this implementation is inefficient since while
 * `push()` is O(1), `shift()` is O(n). This implementation of a queue has O(1)
 * `enqueue()` and `dequeue()` operations.
 *
 * [1]: https://en.wikipedia.org/wiki/Queue_(abstract_data_type)
 */
export class Queue<Value> {
    private _head: QueueNode<Value> | null = null;
    private _tail: QueueNode<Value> | null = null;
    private _size: number = 0;

    public get size(): number {
        return this._size;
    }

    public enqueue(value: Value): void {
        const node = {value, next: null};

        if (this._head === null) {
            this._head = node;
        } else {
            this._tail!.next = node;
        }

        this._tail = node;
        this._size++;
    }

    public dequeue(): Value | undefined {
        const node = this._head;
        if (node === null) return;

        this._head = node.next ?? null;
        if (this._head === null) {
            this._tail = null;
        }

        this._size--;
        return node.value;
    }
}

type QueueNode<Value> = {
    readonly value: Value;
    next: QueueNode<Value> | null;
};
