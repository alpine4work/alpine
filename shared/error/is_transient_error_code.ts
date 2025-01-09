import {InternalError, getErrorCode} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";

/**
 * Is this an error code for a possibly transient error? If we might recover by
 * retrying the request (assuming no other state has changed) then we return
 * true. Examples:
 *
 * - An operation that throws `ErrorCode.Unavailable` might work if you retry
 *   since the resource may be available now.
 *
 * - An operation that throws `ErrorCode.PermissionDenied` will never work
 *   since assuming no other state changes you'll continue to not have
 *   permission on the next attempt.
 *
 * - An operation that throws `ErrorCode.Unknown` or `ErrorCode.Internal` we
 *   consider transient since we don't know what the underlying error is.
 *
 * Transient errors are mostly the same as system errors. With the exception of
 * `ErrorCode.Cancelled` and `ErrorCode.Aborted`. Which are transient errors
 * but not system errors.
 *
 * If you get a transient error, you should retry the operation a couple times
 * before giving up. If you get a non-transient error, you should display it to
 * the user immediately without retrying. Whether an error is transient or not
 * acts as a hint to speed up failure cases when we know a retry will
 * definitively not change anything.
 */
export function isTransientErrorCode(code: ErrorCode): boolean {
    switch (code) {
        case ErrorCode.InvalidArgument:
        case ErrorCode.NotFound:
        case ErrorCode.AlreadyExists:
        case ErrorCode.PermissionDenied:
        case ErrorCode.FailedPrecondition:
        case ErrorCode.OutOfRange:
        case ErrorCode.Unauthenticated:
            return false;
        case ErrorCode.Cancelled:
        case ErrorCode.Aborted:
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
 * Is this a transient error?
 *
 * Uses `isTransientErrorCode()`. If the error is an `ErrorBase` error we use
 * the error code. Otherwise we default to `ErrorCode.Unknown` which is
 * classified as a transient error.
 */
export function isTransientError(error: unknown): boolean {
    const code = getErrorCode(error);
    return isTransientErrorCode(code);
}
