import {InternalError, getErrorCode} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";

/**
 * Is this the code for a system error? System errors are errors we do not expect
 * under normal system operations. Unlike permission denied errors or user input
 * validation errors which can happen all the time as users interact with our
 * software. System errors should be promptly addressed and fixed.
 *
 * System errors correspond to an HTTP 500 status code (server's fault) whereas
 * other errors correspond to a 400 HTTP status code (client's fault).
 */
export function isSystemErrorCode(code: ErrorCode): boolean {
    switch (code) {
        case ErrorCode.Cancelled:
        case ErrorCode.InvalidArgument:
        case ErrorCode.NotFound:
        case ErrorCode.AlreadyExists:
        case ErrorCode.PermissionDenied:
        case ErrorCode.FailedPrecondition:
        case ErrorCode.Aborted:
        case ErrorCode.OutOfRange:
        case ErrorCode.Unauthenticated:
            return false;
        case ErrorCode.Unknown:
        case ErrorCode.DeadlineExceeded:
        case ErrorCode.ResourceExhausted:
        case ErrorCode.Unimplemented:
        case ErrorCode.Internal:
        case ErrorCode.Unavailable:
        case ErrorCode.DataLoss:
            return true;
        default: {
            // We inline the implementation of `exhaustive()` here because core error files
            // can not import `~/shared/helpers`. Since `~/shared/helpers` depends on core
            // error files.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const never: never = code;
            throw new InternalError("Unexpected value in exhaustive check");
        }
    }
}

/**
 * Is this a system error?
 *
 * Uses `isSystemErrorCode()`. If the error is an `ErrorBase` error we use the
 * error code. Otherwise we default to `ErrorCode.Unknown` which is classified as a
 * system error.
 */
export function isSystemError(error: unknown): boolean {
    const code = getErrorCode(error);
    return isSystemErrorCode(code);
}
