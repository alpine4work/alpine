import {getAggregateErrorPriority} from "~/shared/error/aggregate_error.open_source.js";
import {ErrorBase, getErrorCode} from "~/shared/error/error.open_source.js";
import {getErrorCodeName} from "~/shared/error/error_code.open_source.js";
import {ErrorOriginalTracerSpanResult} from "~/shared/error/error_original_tracer_span.open_source.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.open_source.js";
import {renderDebugErrorDisplayMessage} from "~/shared/error/render_debug_error_display_message.open_source.js";
import {isRetryError} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {TraceId} from "~/shared/id/types/id_types.open_source.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";
import {
    TracerEventExceptionDataBase,
    TracerEventExceptionDataBaseWithCause,
} from "~/shared/tracer/types/tracer_event_data_types.open_source.js";

/**
 * Gets the `TracerEventData` for an exception.
 */
export function getTracerEventExceptionData(
    traceId: TraceId | null,
    error: unknown,
    originalResult: ErrorOriginalTracerSpanResult,
): TracerEventData["exception"] {
    // If this is a retry error from `retryWithExponentialBackoff()` then we want to
    // record the error cause not the retry error itself (which is a boring
    // `CancelledError` with the message "Retry"). This way the `exception.message`
    // property of retry errors is interesting.
    if (isRetryError(error)) {
        error = error.cause ?? error;
    }

    const aggregateErrors: Array<unknown> = [];

    const pushAggregateError = (error: unknown) => {
        if (!(error instanceof AggregateError)) {
            aggregateErrors.push(error);
        } else {
            for (const childError of error.errors) {
                pushAggregateError(childError);
            }
        }
    };

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            pushAggregateError(childError);
        }
    }

    // Rank the highest priority errors first. So when we select the first N errors to
    // show in tracer data we have the worst errors.
    aggregateErrors.sort(
        (error1, error2) => getAggregateErrorPriority(error2) - getAggregateErrorPriority(error1),
    );

    // We can't serialize more than 5 errors since that's the max number of errors
    // that'll be serialized in `ErrorSchema`.
    const aggregateErrorData =
        aggregateErrors.length > 0
            ? aggregateErrors.slice(0, 5).map(getTracerEventExceptionDataBaseWithCause)
            : undefined;

    return {
        ...getTracerEventExceptionDataBaseWithCause(error),

        isOriginal: originalResult.isOriginal ? true : undefined,
        original: originalResult.originalSpan
            ? {
                  time:
                      originalResult.originalSpan.traceId !== traceId
                          ? serializeDateString(originalResult.originalSpan.time)
                          : undefined,
                  traceId:
                      originalResult.originalSpan.traceId !== traceId
                          ? originalResult.originalSpan.traceId
                          : undefined,
                  spanId: originalResult.originalSpan.spanId,
              }
            : undefined,

        aggregated1: aggregateErrorData?.[0],
        aggregated2: aggregateErrorData?.[1],
        aggregated3: aggregateErrorData?.[2],
        aggregated4: aggregateErrorData?.[3],
        aggregated5: aggregateErrorData?.[4],
    };
}

function getTracerEventExceptionDataBaseWithCause(
    error: unknown,
): TracerEventExceptionDataBaseWithCause {
    return {
        ...getTracerEventExceptionDataBase(error),

        // Only include causes that, themselves, are instances of `Error`. Only serialize
        // causes 3 deep. (Same as `ErrorSchema.serialize()`.)
        cause:
            error instanceof Error && error.cause && error.cause instanceof Error
                ? error.cause.cause && error.cause.cause instanceof Error
                    ? {
                          ...getTracerEventExceptionDataBase(error.cause),
                          cause: getTracerEventExceptionDataBase(error.cause.cause),
                      }
                    : getTracerEventExceptionDataBase(error.cause)
                : undefined,
    };
}

function getTracerEventExceptionDataBase(error: unknown): TracerEventExceptionDataBase {
    const errorCode = getErrorCode(error);

    return {
        type: `${getErrorCodeName(errorCode)}Error`,
        isSystem: isSystemErrorCode(errorCode) ? true : undefined,
        message: error instanceof Error ? error.message : undefined,
        stacktrace: error instanceof Error ? error.stack : undefined,
        displayMessage:
            error instanceof ErrorBase && error.displayMessage
                ? renderDebugErrorDisplayMessage(error.displayMessage)
                : undefined,
    };
}
