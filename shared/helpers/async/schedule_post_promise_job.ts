import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";

// We can't use `process.nextTick()` since Jest will override
// `process.nextTick()` when `jest.useFakeTimers()` is on. But we want to wait
// the timeout anyway.
const originalProcessNextTick =
    typeof process === "object" && typeof process.nextTick === "function"
        ? process.nextTick.bind(process)
        : null;

/**
 * Schedules a callback exactly after all promise microtasks have run. This
 * function is designed for Node.js but falls back to `setTimeout()` in the
 * browser.
 *
 * This [implementation was taken from `dataloader`][1]. `dataloader` describes
 * how this works:
 *
 * > ES6 JavaScript uses the concepts Job and JobQueue to schedule work to occur
 * > after the current execution context has completed:
 * > http://www.ecma-international.org/ecma-262/6.0/#sec-jobs-and-job-queues
 * >
 * > Node.js uses the `process.nextTick` mechanism to implement the concept of a
 * > Job, maintaining a global FIFO JobQueue for all Jobs, which is flushed after
 * > the current call stack ends.
 * >
 * > When calling `then` on a Promise, it enqueues a Job on a specific
 * > "PromiseJobs" JobQueue which is flushed in Node as a single Job on the
 * > global JobQueue.
 * >
 * > DataLoader batches all loads which occur in a single frame of execution, but
 * > should include in the batch all loads which occur during the flushing of the
 * > "PromiseJobs" JobQueue after that same execution frame.
 * >
 * > In order to avoid the DataLoader dispatch Job occuring before "PromiseJobs",
 * > A Promise Job is created with the sole purpose of enqueuing a global Job,
 * > ensuring that it always occurs after "PromiseJobs" ends.
 *
 * [1]: https://github.com/graphql/dataloader/blob/a10773043d41a56bde4219c155fcf5633e6c9bcb/src/index.js#L214-L256
 */
export const schedulePostPromiseJob: (action: () => void) => void =
    originalProcessNextTick !== null
        ? action => {
              scheduleMicrotask(() => {
                  originalProcessNextTick(action);
              });
          }
        : // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
          // @ts-ignore: This function is defined in `@types/node` which isn't available
          // when Bazel is type checking `shared`.
          typeof setImmediate === "function"
          ? action => {
                // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
                // @ts-ignore: This function is defined in `@types/node` which isn't available
                // when Bazel is type checking `shared`.
                setImmediate(action);
            }
          : action => {
                setTimeout(action);
            };
