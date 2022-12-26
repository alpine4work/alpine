import {ErrorBase} from "~/shared/error/error";
import {ErrorCode, getErrorCodeName} from "~/shared/error/error_code";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

/**
 * Gets the `TracerEventData` for an exception.
 */
export function getExceptionTracerEventData(
    error: unknown,
    {escaped}: {escaped: boolean},
): TracerEventData["exception"] {
    const errorCode = error instanceof ErrorBase ? error.code : ErrorCode.Unknown;

    return {
        escaped,
        message: error instanceof Error ? error.message : undefined,
        stacktrace: error instanceof Error ? error.stack : undefined,
        type: `${getErrorCodeName(errorCode)}Error`,
    };
}
