import {ErrorBase} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

/**
 * Should we classify this with a 500 HTTP status code? True if we should
 * classify the error with a 500 HTTP status code. False if we should classify
 * the error with a 400 HTTP status code.
 */
export function isHttp500ErrorCode(code: ErrorCode): boolean {
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
        default:
            throw exhaustive(code);
    }
}

/**
 * Should we classify this error object with a 500 HTTP status code?
 *
 * Uses `isHttp500ErrorCode()`. If the error is an `ErrorBase` error we use the
 * error code. Otherwise we default to `ErrorCode.Unknown` which is classified
 * with a 500 status code.
 */
export function isHttp500Error(error: unknown): boolean {
    const code = error instanceof ErrorBase ? error.code : ErrorCode.Unknown;
    return isHttp500ErrorCode(code);
}
