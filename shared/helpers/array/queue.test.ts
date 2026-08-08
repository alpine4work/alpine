import {Queue} from "~/shared/helpers/array/queue.open_source.js";

test("can dequeue elements in FIFO order", () => {
    const queue = new Queue<number>();

    expect(queue.size).toEqual(0);
    queue.enqueue(1);
    expect(queue.size).toEqual(1);
    queue.enqueue(2);
    expect(queue.size).toEqual(2);
    queue.enqueue(3);
    expect(queue.size).toEqual(3);
    expect(queue.dequeue()).toBe(1);
    expect(queue.size).toEqual(2);
    expect(queue.dequeue()).toBe(2);
    expect(queue.size).toEqual(1);
    expect(queue.dequeue()).toBe(3);
    expect(queue.size).toEqual(0);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.size).toEqual(0);
});

test("should return undefined when dequeueing from an empty queue", () => {
    const queue = new Queue<number>();

    expect(queue.size).toEqual(0);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.size).toEqual(0);
});

test("should handle enqueue and dequeue operations correctly", () => {
    const queue = new Queue<number>();

    expect(queue.size).toEqual(0);
    queue.enqueue(1);
    expect(queue.size).toEqual(1);
    expect(queue.dequeue()).toBe(1);
    expect(queue.size).toEqual(0);
    queue.enqueue(2);
    expect(queue.size).toEqual(1);
    queue.enqueue(3);
    expect(queue.size).toEqual(2);
    expect(queue.dequeue()).toBe(2);
    expect(queue.size).toEqual(1);
    expect(queue.dequeue()).toBe(3);
    expect(queue.size).toEqual(0);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.size).toEqual(0);
});

test("should handle multiple enqueue and dequeue operations", () => {
    const queue = new Queue<number>();

    expect(queue.size).toEqual(0);
    queue.enqueue(1);
    expect(queue.size).toEqual(1);
    queue.enqueue(2);
    expect(queue.size).toEqual(2);
    expect(queue.dequeue()).toBe(1);
    expect(queue.size).toEqual(1);
    queue.enqueue(3);
    expect(queue.size).toEqual(2);
    expect(queue.dequeue()).toBe(2);
    expect(queue.size).toEqual(1);
    expect(queue.dequeue()).toBe(3);
    expect(queue.size).toEqual(0);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.size).toEqual(0);
});
