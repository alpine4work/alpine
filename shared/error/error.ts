import {ErrorCode, getErrorCodeName, isErrorCode} from "~/shared/error/error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";

export function getErrorCode(error: unknown): ErrorCode {
    if (error instanceof ErrorBase) return error.code;

    if (
        error instanceof AggregateError &&
        typeof (error as any).code === "number" &&
        isErrorCode((error as any).code)
    ) {
        return (error as any).code;
    }

    return ErrorCode.Unknown;
}

/**
 * An exception in our codebase that interrupts the normal flow of execution.
 *
 * Exceptions in our codebase all come with a status code to help us identify
 * the impact of the problem.
 */
export abstract class ErrorBase extends Error {
    public readonly code: ErrorCode;
    public readonly displayMessage?: ErrorDisplayMessage;
    public readonly aggregateDedupeKey?: string;

    constructor(
        message: string,
        {
            cause,
            displayMessage,
            aggregateDedupeKey,
        }: {
            cause?: unknown;

            /**
             * A message to show to the user in the UI when this error is thrown. `message`
             * is intended for internal developer usage, however `displayMessage` can be
             * presented to the end user.
             */
            displayMessage?: ErrorDisplayMessage;

            /**
             * When creating an error with `createAggregateError()` if there are multiple
             * errors with the same code, message, and `aggregateDedupeKey` then only the
             * first such error will be included in the aggregate error.
             *
             * If `aggregateDedupeKey` isn't set then this error will never be deduped.
             */
            aggregateDedupeKey?: string;
        } = {},
    ) {
        super(message, {cause});
        this.code = this._getCode();
        this.name = getErrorCodeName(this.code) + "Error";
        this.cause = cause;
        if (displayMessage !== undefined) this.displayMessage = displayMessage;
        if (aggregateDedupeKey !== undefined) this.aggregateDedupeKey = aggregateDedupeKey;
    }

    protected abstract _getCode(): ErrorCode;

    /**
     * Convert an unknown exception object into a coded error with the original
     * error as the cause object.
     *
     * If you call `ErrorBase.from()` you will get an `UnknownError`. Instead
     * prefer using a specific error like `FailedPreconditionError.from()`.
     */
    public static from<This extends typeof ErrorBase>(
        this: This,
        error: unknown,
        newMessage?: string,
        {displayMessage}: {displayMessage?: ErrorDisplayMessage} = {},
    ): InstanceType<This> {
        const ErrorConstructor =
            this !== ErrorBase
                ? (this as any as new (
                      message: string,
                      options?: {cause?: unknown; displayMessage?: ErrorDisplayMessage},
                  ) => ErrorBase)
                : UnknownError;

        return new ErrorConstructor(
            (newMessage ? `${newMessage}: ` : "") +
                (error instanceof Error ? error.message : String(error)),
            {
                cause: error,
                displayMessage,
            },
        ) as InstanceType<This>;
    }
}

/**
 * The operation was cancelled, typically by the caller.
 */
export class CancelledError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Cancelled as const;
    }
}

/**
 * Unknown error. For example, this error may be returned when a status code
 * received from another address space belongs to an error space that is not
 * known in this address space. Also errors raised by APIs that do not return
 * enough error information may be converted to this error.
 */
export class UnknownError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Unknown as const;
    }
}

/**
 * The client specified an invalid argument. Note that this differs from
 * `FailedPrecondition`. `InvalidArgument` indicates arguments that are
 * problematic regardless of the state of the system (e.g., a malformed file
 * name).
 */
export class InvalidArgumentError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.InvalidArgument as const;
    }
}

/**
 * The deadline expired before the operation could complete. For operations
 * that change the state of the system, this error may be returned even if the
 * operation has completed successfully.
 */
export class DeadlineExceededError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.DeadlineExceeded as const;
    }
}

/**
 * Some requested entity (e.g., file or directory) was not found. Note to
 * server developers: if a request is denied for an entire class of users, such
 * as gradual feature rollout or undocumented allowlist, `NotFound` may be
 * used. If a request is denied for some users within a class of users, such as
 * user-based access control, `PermissionDenied` must be used.
 */
export class NotFoundError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.NotFound as const;
    }
}

/**
 * The entity that a client attempted to create (e.g., file or directory)
 * already exists.
 */
export class AlreadyExistsError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.AlreadyExists as const;
    }
}

/**
 * The caller does not have permission to execute the specified operation.
 * `PermissionDenied` must not be used for rejections caused by exhausting some
 * resource (use `ResourceExhausted` instead for those errors).
 * `PermissionDenied` must not be used if the caller can not be identified (use
 * `Unauthenticated` instead for those errors). This error code does not imply
 * the request is valid or the requested entity exists or satisfies other
 * pre-conditions.
 */
export class PermissionDeniedError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.PermissionDenied as const;
    }
}

/**
 * Some resource has been exhausted, perhaps a per-user quota, or perhaps the
 * entire file system is out of space.
 */
export class ResourceExhaustedError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.ResourceExhausted as const;
    }
}

/**
 * The operation was rejected because the system is not in a state required for
 * the operation's execution. For example, the directory to be deleted is
 * non-empty, an rmdir operation is applied to a non-directory, etc. Service
 * implementors can use the following guidelines to decide between
 * `FailedPrecondition`, `Aborted`, and `Unavailable`: (a) Use `Unavailable` if
 * the client can retry just the failing call. (b) Use `Aborted` if the client
 * should retry at a higher level (e.g., when a client-specified test-and-set
 * fails, indicating the client should restart a read-modify-write sequence).
 * (c) Use `FailedPrecondition` if the client should not retry until the system
 * state has been explicitly fixed. E.g., if an "rmdir" fails because the
 * directory is non-empty, `FailedPrecondition` should be returned since the
 * client should not retry unless the files are deleted from the directory.
 */
export class FailedPreconditionError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.FailedPrecondition as const;
    }
}

/**
 * The operation was aborted, typically due to a concurrency issue such as a
 * sequencer check failure or transaction abort. See the guidelines above for
 * deciding between `FailedPrecondition`, `Aborted`, and `Unavailable`.
 */
export class AbortedError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Aborted as const;
    }
}

/**
 * The operation was attempted past the valid range. E.g., seeking or reading
 * past end-of-file. Unlike `InvalidArgument`, this error indicates a problem
 * that may be fixed if the system state changes. For example, a 32-bit file
 * system will generate `InvalidArgument` if asked to read at an offset that is
 * not in the range [0,2^32-1], but it will generate `OutOfRange` if asked to
 * read from an offset past the current file size. There is a fair bit of
 * overlap between `FailedPrecondition` and `OutOfRange`. We recommend using
 * `OutOfRange` (the more specific error) when it applies so that callers who
 * are iterating through a space can easily look for an `OutOfRange` error to
 * detect when they are done.
 */
export class OutOfRangeError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.OutOfRange as const;
    }
}

/**
 * The operation is not implemented or is not supported/enabled in this
 * service.
 */
export class UnimplementedError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Unimplemented as const;
    }
}

/**
 * Internal errors. This means that some invariants expected by the underlying
 * system have been broken. This error code is reserved for serious errors.
 */
export class InternalError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Internal as const;
    }
}

/**
 * The service is currently unavailable. This is most likely a transient
 * condition, which can be corrected by retrying with a backoff. Note that it
 * is not always safe to retry non-idempotent operations.
 */
export class UnavailableError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Unavailable as const;
    }
}

/**
 * Unrecoverable data loss or corruption.
 */
export class DataLossError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.DataLoss as const;
    }
}

/**
 * The request does not have valid authentication credentials for the
 * operation.
 */
export class UnauthenticatedError extends ErrorBase {
    protected _getCode() {
        return ErrorCode.Unauthenticated as const;
    }
}
