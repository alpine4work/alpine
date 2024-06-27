import {ErrorBase} from "~/shared/error/error.js";
import {ErrorCode, getErrorCodeName} from "~/shared/error/error_code.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";
import {renderDebugErrorDisplayMessage} from "~/shared/error/render_debug_error_display_message.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Gets the `TracerEventData` for an exception.
 */
// TODO(calebmer, #tracer): Add support for reporting `cause` (may hold
// original error codes/messages) and `AggregateError` (from utilities like
// `runAllPromises()`). Possibly also add support in `ErrorSchema` for
// transmitting such errors over the wire.
//
// Also make sure `runAllPromises()` throws an `AggregateError` when multiple
// promises throw so we can report all of them.
export function getExceptionTracerEventData(error: unknown): TracerEventData["exception"] {
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
