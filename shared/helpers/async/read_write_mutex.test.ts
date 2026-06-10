// Tests adapted from gist comment we adapted our `ReadWriteMutex` implementation
// from:
// https://gist.github.com/CMCDragonkai/4de5c1526fc58dac259e321db8cf5331?permalink_comment_id=4030688#gistcomment-4030688

import {ReadWriteMutex} from "~/shared/helpers/async/read_write_mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {waitMicrotask} from "~/shared/helpers/async/wait_microtask.js";

type TestCase = {
    locks: Array<"Read" | "Write">;
};

const tests: Array<TestCase> = [
    {locks: ["Read", "Write", "Read"]},
    {locks: ["Read", "Write", "Write", "Read"]},
    {locks: ["Write", "Read"]},
    {locks: ["Read", "Write"]},
    {locks: ["Read", "Read", "Write", "Read", "Read", "Write", "Read"]},
];

test.each(tests)("maintains order: $locks", async ({locks}) => {
    const mutex = new ReadWriteMutex();

    const expectedOrder = locks.map((type, index) => type + index.toString());
    const actualOrder: Array<string> = [];

    await runAllPromises(
        locks.map((type, index) =>
            type === "Read"
                ? mutex.withReadLock(async () => actualOrder.push(expectedOrder[index]!))
                : mutex.withWriteLock(async () => actualOrder.push(expectedOrder[index]!)),
        ),
    );

    expect(actualOrder).toEqual(expectedOrder);
});

test("maintains order with uneven event loop ticks", async () => {
    const mutex = new ReadWriteMutex();

    const locks = ["Read", "Read", "Write", "Read", "Read", "Write", "Read"];

    const expectedOrder = locks.map((type, index) => type + index.toString());
    const actualOrder: Array<string> = [];

    const ticks = [0, 1, 2, 0, 3, 0, 1];

    const run = async (index: number) => {
        for (let i = 0; i < ticks[index]!; i++) {
            await waitMicrotask();
        }
        actualOrder.push(expectedOrder[index]!);
    };

    await runAllPromises(
        locks.map((type, index) =>
            type === "Read"
                ? mutex.withReadLock(() => run(index))
                : mutex.withWriteLock(() => run(index)),
        ),
    );

    expect(actualOrder).toStrictEqual(expectedOrder);
});
