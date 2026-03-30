import {InternalError} from "~/shared/error/error.js";
import {PromiseQueue} from "~/shared/helpers/async/promise_queue.js";

test("tasks execute in order", async () => {
    const queue = new PromiseQueue();
    const order: Array<number> = [];

    const a = queue.enqueue(async () => {
        await delay(30);
        order.push(1);
    });
    const b = queue.enqueue(async () => {
        order.push(2);
    });
    const c = queue.enqueue(async () => {
        order.push(3);
    });

    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
});

test("rejected task does not block subsequent tasks", async () => {
    const queue = new PromiseQueue();

    const a = queue.enqueue(async () => {
        throw new InternalError("boom");
    });
    const b = queue.enqueue(async () => "ok");

    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
});

test("return value is propagated", async () => {
    const queue = new PromiseQueue();
    const result = await queue.enqueue(() => Promise.resolve(42));
    expect(result).toBe(42);
});

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
