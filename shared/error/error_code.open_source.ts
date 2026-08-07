import {InternalError} from "~/shared/error/error.open_source.js";

/**
 * We use [gRPC status codes][1] for our error codes. gRPC status codes are well
 * defined and, presumably, industry standard.
 *
 * gRPC status codes are more relevant for modern software systems than HTTP status
 * codes.
 *
 * Since these are just error codes we do not include gRPC status code 0 which
 * represents an "Ok" status.
 *
 * [1]:
 *     https://github.com/grpc/grpc/blob/c5c2793427c691b2663e1cf271cff04ad0ec50b3/doc/statuscodes.md
 */
export enum ErrorCode {
    /**
     * The operation was cancelled, typically by the caller.
     */
    Cancelled = 1,

    /**
     * Unknown error. For example, this error may be returned when a status code
     * received from another address space belongs to an error space that is not known
     * in this address space. Also errors raised by APIs that do not return enough
     * error information may be converted to this error.
     */
    Unknown = 2,

    /**
     * The client specified an invalid argument. Note that this differs from
     * `FailedPrecondition`. `InvalidArgument` indicates arguments that are problematic
     * regardless of the state of the system (e.g., a malformed file name).
     */
    InvalidArgument = 3,

    /**
     * The deadline expired before the operation could complete. For operations that
     * change the state of the system, this error may be returned even if the operation
     * has completed successfully.
     */
    DeadlineExceeded = 4,

    /**
     * Some requested entity (e.g., file or directory) was not found. Note to server
     * developers: if a request is denied for an entire class of users, such as gradual
     * feature rollout or undocumented allowlist, `NotFound` may be used. If a request
     * is denied for some users within a class of users, such as user-based access
     * control, `PermissionDenied` must be used.
     */
    NotFound = 5,

    /**
     * The entity that a client attempted to create (e.g., file or directory) already
     * exists.
     */
    AlreadyExists = 6,

    /**
     * The caller does not have permission to execute the specified operation.
     * `PermissionDenied` must not be used for rejections caused by exhausting some
     * resource (use `ResourceExhausted` instead for those errors). `PermissionDenied`
     * must not be used if the caller can not be identified (use `Unauthenticated`
     * instead for those errors). This error code does not imply the request is valid
     * or the requested entity exists or satisfies other pre-conditions.
     */
    PermissionDenied = 7,

    /**
     * Some resource has been exhausted, perhaps a per-user quota, or perhaps the
     * entire file system is out of space.
     */
    ResourceExhausted = 8,

    /**
     * The operation was rejected because the system is not in a state required for the
     * operation's execution. For example, the directory to be deleted is non-empty, an
     * rmdir operation is applied to a non-directory, etc. Service implementors can use
     * the following guidelines to decide between `FailedPrecondition`, `Aborted`, and
     * `Unavailable`: (a) Use `Unavailable` if the client can retry just the failing
     * call. (b) Use `Aborted` if the client should retry at a higher level (e.g., when
     * a client-specified test-and-set fails, indicating the client should restart a
     * read-modify-write sequence). (c) Use `FailedPrecondition` if the client should
     * not retry until the system state has been explicitly fixed. E.g., if an "rmdir"
     * fails because the directory is non-empty, `FailedPrecondition` should be
     * returned since the client should not retry unless the files are deleted from the
     * directory.
     */
    FailedPrecondition = 9,

    /**
     * The operation was aborted, typically due to a concurrency issue such as a
     * sequencer check failure or transaction abort. See the guidelines above for
     * deciding between `FailedPrecondition`, `Aborted`, and `Unavailable`.
     */
    Aborted = 10,

    /**
     * The operation was attempted past the valid range. E.g., seeking or reading past
     * end-of-file. Unlike `InvalidArgument`, this error indicates a problem that may
     * be fixed if the system state changes. For example, a 32-bit file system will
     * generate `InvalidArgument` if asked to read at an offset that is not in the
     * range [0,2^32-1], but it will generate `OutOfRange` if asked to read from an
     * offset past the current file size. There is a fair bit of overlap between
     * `FailedPrecondition` and `OutOfRange`. We recommend using `OutOfRange` (the more
     * specific error) when it applies so that callers who are iterating through a
     * space can easily look for an `OutOfRange` error to detect when they are done.
     */
    OutOfRange = 11,

    /**
     * The operation is not implemented or is not supported/enabled in this service.
     */
    Unimplemented = 12,

    /**
     * Internal errors. This means that some invariants expected by the underlying
     * system have been broken. This error code is reserved for serious errors.
     */
    Internal = 13,

    /**
     * The service is currently unavailable. This is most likely a transient condition,
     * which can be corrected by retrying with a backoff. Note that it is not always
     * safe to retry non-idempotent operations.
     */
    Unavailable = 14,

    /**
     * Unrecoverable data loss or corruption.
     */
    DataLoss = 15,

    /**
     * The request does not have valid authentication credentials for the operation.
     */
    Unauthenticated = 16,
}

let errorCodes: Set<ErrorCode>;

/**
 * Get all `ErrorCode`s.
 */
export function getErrorCodes(): ReadonlySet<ErrorCode> {
    errorCodes ??= new Set<number>(
        Object.values(ErrorCode).filter((code): code is number => typeof code === "number"),
    );
    return errorCodes;
}

/**
 * Is the provided number an `ErrorCode`?
 */
export function isErrorCode(code: number): code is ErrorCode {
    return getErrorCodes().has(code);
}

/**
 * Get a name base on the provided status code which we can use for debugging.
 */
export function getErrorCodeName(code: ErrorCode): string {
    switch (code) {
        case ErrorCode.Cancelled:
            return "Cancelled";
        case ErrorCode.Unknown:
            return "Unknown";
        case ErrorCode.InvalidArgument:
            return "InvalidArgument";
        case ErrorCode.DeadlineExceeded:
            return "DeadlineExceeded";
        case ErrorCode.NotFound:
            return "NotFound";
        case ErrorCode.AlreadyExists:
            return "AlreadyExists";
        case ErrorCode.PermissionDenied:
            return "PermissionDenied";
        case ErrorCode.ResourceExhausted:
            return "ResourceExhausted";
        case ErrorCode.FailedPrecondition:
            return "FailedPrecondition";
        case ErrorCode.Aborted:
            return "Aborted";
        case ErrorCode.OutOfRange:
            return "OutOfRange";
        case ErrorCode.Unimplemented:
            return "Unimplemented";
        case ErrorCode.Internal:
            return "Internal";
        case ErrorCode.Unavailable:
            return "Unavailable";
        case ErrorCode.DataLoss:
            return "DataLoss";
        case ErrorCode.Unauthenticated:
            return "Unauthenticated";
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
