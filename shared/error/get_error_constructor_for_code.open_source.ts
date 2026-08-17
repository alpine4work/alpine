import {
    AbortedError,
    AlreadyExistsError,
    CancelledError,
    DataLossError,
    DeadlineExceededError,
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
    PermissionDeniedError,
    ResourceExhaustedError,
    UnauthenticatedError,
    UnavailableError,
    UnimplementedError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {ErrorCode} from "~/shared/error/error_code.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Get a the error constructor for the provided error code.
 */
export function getErrorConstructorForCode(code: ErrorCode): {
    new (
        message: string,
        options?: {
            cause?: unknown;
            displayMessage?: ErrorDisplayMessage;
            aggregateDedupeKey?: string;
        },
    ): ErrorBase;
    from(
        error: unknown,
        newMessage?: string,
        options?: {displayMessage?: ErrorDisplayMessage},
    ): ErrorBase;
} {
    switch (code) {
        case ErrorCode.Cancelled:
            return CancelledError;
        case ErrorCode.Unknown:
            return UnknownError;
        case ErrorCode.InvalidArgument:
            return InvalidArgumentError;
        case ErrorCode.DeadlineExceeded:
            return DeadlineExceededError;
        case ErrorCode.NotFound:
            return NotFoundError;
        case ErrorCode.AlreadyExists:
            return AlreadyExistsError;
        case ErrorCode.PermissionDenied:
            return PermissionDeniedError;
        case ErrorCode.ResourceExhausted:
            return ResourceExhaustedError;
        case ErrorCode.FailedPrecondition:
            return FailedPreconditionError;
        case ErrorCode.Aborted:
            return AbortedError;
        case ErrorCode.OutOfRange:
            return OutOfRangeError;
        case ErrorCode.Unimplemented:
            return UnimplementedError;
        case ErrorCode.Internal:
            return InternalError;
        case ErrorCode.Unavailable:
            return UnavailableError;
        case ErrorCode.DataLoss:
            return DataLossError;
        case ErrorCode.Unauthenticated:
            return UnauthenticatedError;
        default:
            throw exhaustive(code);
    }
}
