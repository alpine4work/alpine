import {ErrorBase, InternalError} from "~/shared/error/error.js";
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
function isTransientErrorCode(code: ErrorCode, hasDisplayMessage: boolean): boolean {
    switch (code) {
        // Errors where the input to the operation is invalid so the operation can't
        // complete. No change to the underlying data will resolve this error. The
        // only remedy is for caller to change their inputs.
        //
        // For example, if you try passing a number into a function where a string is
        // expected you'll get an `InvalidArgumentError`. If you try to make an HTTP
        // request without an `Authorization` header you'll get an
        // `UnauthenticatedError`.
        //
        // `UnimplementedError` is only loosely similar. If you call a function that's
        // unimplemented then you (the caller) need to call a different function
        // instead to avoid an error.
        case ErrorCode.InvalidArgument:
        case ErrorCode.Unauthenticated:
        case ErrorCode.Unimplemented:
            return false;

        // Errors where the data is in a state that doesn't allow this operation to
        // succeed but if the data were in another state the operation could succeed.
        //
        // For example, you try to read a chat message at index 3 you get a
        // `NotFoundError` but if you create a chat message at index 3 then read again
        // you won't get that error. Or if you try to read a private document you get a
        // `PermissionDeniedError` but if the user grants you access to the document
        // you'll be able to read it without error.
        //
        // In other words, retrying these errors may indeed cause an RPC call to
        // succeed if the data changes between retries. However, within our ~30
        // second retry window it's unlikely a user will make the specific change
        // to resolve this error.
        //
        // One exception is eventually consistent reads. If you create an item then
        // immediately try to read the item back with eventual consistency you may get
        // a `NotFoundError`. However, after a retry or two DynamoDB may finish
        // replicating and the item will be readable with eventual consistency and the
        // `NotFoundError` goes away.
        //
        // For now, we decide to treat these error codes as NOT transient. Because a
        // lot of the time errors like `NotFoundError`, `PermissionDeniedError`, and
        // `FailedPreconditionError` are accompanied with a `displayMessage` which is
        // presented to the user in the UI. Errors with a `displayMessage` are NOT
        // transient and immediately presented to the user without retries. Since these
        // errors are often accompanied by a `displayMessage` to explain why the
        // current data doesn't allow a certain operation, we think it's conceptually
        // simpler to treat all errors of these codes as not transient.
        case ErrorCode.FailedPrecondition:
        case ErrorCode.NotFound:
        case ErrorCode.AlreadyExists:
        case ErrorCode.OutOfRange:
        case ErrorCode.PermissionDenied:
            return false;

        // Something very bad happened and we lost customer data. No retry can save the
        // customer data.
        case ErrorCode.DataLoss:
            return false;

        // Transient errors we always retry even if there is a `displayMessage`. For
        // example, we throw `UnavailableError` when a WebSocket disconnects with a
        // `displayMessage` saying we lost contact with our servers. We should always
        // retry that `UnavailableError`.
        case ErrorCode.DeadlineExceeded:
        case ErrorCode.Unavailable:
            return true;

        // Common transient errors. Typically some resource is overloaded and a retry
        // will find its way to new resources.
        case ErrorCode.Cancelled:
        case ErrorCode.Aborted:
        case ErrorCode.ResourceExhausted:
            return !hasDisplayMessage;

        // `UnknownError` is used for unclassified third party errors. We try to
        // classify as many errors as we can from a third party with better error codes
        // but we aren't able to classify every error. We assume unknown errors are
        // transient. If there's a known, predictable, consistent error thrown by a
        // third party we should have classified it. Any remaining errors are hopefully
        // then transient failures.
        case ErrorCode.Unknown:
            return !hasDisplayMessage;

        // Generic error code we use when our code is doing something unexpected.
        // Commonly thrown by `assert()`s. We should basically never see this error
        // code in production since it means some piece of code is behaving in an
        // unexpected way. Retry these unexpected errors just in case they're
        // transient. If the error is expected, it should use a different error code
        // that's more descriptive!
        case ErrorCode.Internal:
            return !hasDisplayMessage;

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
 *
 * For some transient error codes, a `displayMessage` makes the error NOT a
 * transient error. Errors with `displayMessage`s are intended to be shown to
 * the user. Don't retry these errors, instead show the error to the user
 * immediately.
 */
export function isTransientError(error: unknown): boolean {
    if (!(error instanceof ErrorBase)) {
        return isTransientErrorCode(ErrorCode.Unknown, false);
    } else {
        return isTransientErrorCode(error.code, !!error.displayMessage);
    }
}
