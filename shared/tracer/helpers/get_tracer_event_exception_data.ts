import {ErrorBase} from "~/shared/error/error.js";
import {ErrorCode, getErrorCodeName} from "~/shared/error/error_code.js";
import {ErrorOriginalTracerSpanResult} from "~/shared/error/error_original_tracer_span.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";
import {renderDebugErrorDisplayMessage} from "~/shared/error/render_debug_error_display_message.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {TraceId} from "~/shared/id/types/id_types.js";
import {
    TracerEventData,
    TracerEventExceptionDataBase,
} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Gets the `TracerEventData` for an exception.
 */
// TODO(calebmer, #tracer): Add support for `AggregateError` (from utilities
// like `runAllPromises()`). Possibly also add support in `ErrorSchema` for
// transmitting such errors over the wire. (Maybe support `cause` in
// `ErrorSchema` too.)
//
// Also make sure `runAllPromises()` throws an `AggregateError` when multiple
// promises throw so we can report all of them.
export function getTracerEventExceptionData(
    traceId: TraceId | null,
    error: unknown,
    originalResult: ErrorOriginalTracerSpanResult,
): TracerEventData["exception"] {
    return {
        ...getTracerEventExceptionDataBase(error),
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

        // Only include causes that, themselves, are instances of `Error`. Only
        // serialize causes 3 deep. (Same as `ErrorSchema.serialize()`.)
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
    const errorCode = error instanceof ErrorBase ? error.code : ErrorCode.Unknown;

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
