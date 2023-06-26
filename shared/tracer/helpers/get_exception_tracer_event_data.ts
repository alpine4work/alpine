import {ErrorBase} from "~/shared/error/error.js";
import {ErrorCode, getErrorCodeName} from "~/shared/error/error_code.js";
import {renderDebugErrorDisplayMessage} from "~/shared/error/render_debug_error_display_message.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Gets the `TracerEventData` for an exception.
 */
export function getExceptionTracerEventData(error: unknown): TracerEventData["exception"] {
    const errorCode = error instanceof ErrorBase ? error.code : ErrorCode.Unknown;

    return {
        message: error instanceof Error ? error.message : undefined,
        stacktrace: error instanceof Error ? error.stack : undefined,
        type: `${getErrorCodeName(errorCode)}Error`,
        displayMessage:
            error instanceof ErrorBase && error.displayMessage
                ? renderDebugErrorDisplayMessage(error.displayMessage)
                : undefined,
    };
}
