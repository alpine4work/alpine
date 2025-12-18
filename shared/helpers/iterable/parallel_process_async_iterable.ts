import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Processes items from an async iterable in parallel with a configurable concurrency limit.
 *
 * This function iterates through the provided async iterable and processes each value using
 * the provided async function. Processing happens concurrently up to the specified concurrency
 * limit, ensuring that no more than `concurrency` items are being processed simultaneously.
 *
 * If any processing operations fail, all errors are collected and thrown as an aggregate error
 * after all operations complete (or fail). This ensures that all items are attempted even if
 * some fail.
 *
 * @returns A Promise that resolves when all items have been processed
 * @throws {AggregateError} If any processing operations fail, throws an aggregate error
 *         containing all errors that occurred
 *
 * @example
 * ```ts
 * await parallelProcessAsyncIterable(
 *     dangerouslyGetAllAccountIdsForBot(context, botId, options),
 *     async accountId => {
 *         await dangerouslyUpdateBotAccountAvatarWithoutAuthorization(
 *             context,
 *             accountId,
 *             {
 *                 avatarId,
 *                 avatarContent,
 *             },
 *         );
 *     },
 * );
 * ```
 */
export async function parallelProcessAsyncIterable<Value>(
    iterable: AsyncIterable<Value>,
    process: (value: Value) => Promise<void>,
    {concurrency = 10}: {concurrency?: number} = {},
) {
    assert(concurrency > 0);

    const errors: Array<unknown> = [];
    const promises = createArrayWithLength(concurrency, index => Promise.resolve(index));

    for await (const value of iterable) {
        const index = await Promise.race(promises);

        const promise = process(value);

        promises[index] = promise.then(
            () => index,
            error => {
                errors.push(error);
                return index;
            },
        );
    }

    await Promise.all(promises);

    if (errors.length > 0) {
        throw createAggregateError(errors);
    }
}
