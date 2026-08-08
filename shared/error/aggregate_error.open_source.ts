import {ErrorBase, InternalError, getErrorCode} from "~/shared/error/error.open_source.js";
import {ErrorCode} from "~/shared/error/error_code.open_source.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.open_source.js";
import {isTransientError} from "~/shared/error/is_transient_error.open_source.js";

export function getAggregateErrorPriority(error: unknown): number {
    if (error instanceof AggregateError && error.errors.length > 0) {
        return error.errors.map(getAggregateErrorPriority).reduce((a, b) => Math.max(a, b), 0);
    }

    const isErrorBase = error instanceof ErrorBase;
    const errorCode = isErrorBase ? error.code : ErrorCode.Unknown;

    let priority = 2;

    // Errors with a display message are higher priority than errors without a display
    // message.
    if (isErrorBase && error.displayMessage !== undefined) {
        priority = 3;
    }
    // Cancelled errors (e.g. from `AbortSignal`s) are lower priority than other
    // errors.
    else if (errorCode === ErrorCode.Cancelled) {
        priority = 1;
    }

    // System errors are highest priority.
    if (isSystemErrorCode(errorCode)) priority += 4;

    // Transient errors are lower priority than all other errors. If there was one
    // non-transient error, that should be the one we pick.
    if (!isTransientError(errorCode)) priority += 5;

    return priority;
}

/**
 * Create an `AggregateError` instance from multiple errors. We pick the error with
 * the highest priority (according to `getAggregateErrorPriority()`) to be the
 * message of the aggregate error.
 *
 * If there's only one error then we return that error. If there are zero errors we
 * return an `InternalError`. If `AggregateError`s are provided then we flatten
 * them in the resulting `AggregateError`s result list.
 */
export function createAggregateError(errors: Iterable<unknown>): unknown {
    const errorSet = new Set<unknown>();
    let aggregateDedupeKeys: Set<string> | undefined;

    const pushError = (error: unknown) => {
        if (!(error instanceof AggregateError) || error.errors.length === 0) {
            if (!(error instanceof ErrorBase) || error.aggregateDedupeKey === undefined) {
                errorSet.add(error);
            } else {
                const aggregateDedupeKey = JSON.stringify([
                    error.code,
                    error.message,
                    error.aggregateDedupeKey,
                ]);

                aggregateDedupeKeys ??= new Set();

                if (!aggregateDedupeKeys.has(aggregateDedupeKey)) {
                    aggregateDedupeKeys.add(aggregateDedupeKey);
                    errorSet.add(error);
                }
            }
        } else {
            for (const childError of error.errors) {
                pushError(childError);
            }
        }
    };

    for (const error of errors) {
        pushError(error);
    }

    if (errorSet.size === 1) return errorSet[Symbol.iterator]().next().value;

    let highestPriority: number | null = null;
    let highestPriorityError: unknown;

    for (const error of errorSet) {
        const priority = getAggregateErrorPriority(error);

        if (highestPriority === null || highestPriority < priority) {
            highestPriority = priority;
            highestPriorityError = error;
        }
    }

    if (highestPriority === null) {
        return new InternalError("Tried to create an `AggregateError` with no errors");
    } else {
        const otherErrorCount = errorSet.size - 1;

        const error = new AggregateError(
            errorSet,
            `${
                highestPriorityError instanceof Error
                    ? highestPriorityError.message
                    : String(highestPriorityError)
            } (and ${otherErrorCount} other ${otherErrorCount === 1 ? "error" : "errors"})`,
        );

        // We look for the `code` property on `AggregateError`s in `getErrorCode()` to get
        // the code of the highest priority error. This also means that if an aggregate
        // error has no system errors then `isSystemError()` should return false.
        (error as any).code = getErrorCode(highestPriorityError);

        return error;
    }
}
