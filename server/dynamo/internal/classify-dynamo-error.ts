import {
    ConditionalCheckFailedException,
    DuplicateItemException,
    IdempotentParameterMismatchException,
    IndexNotFoundException,
    InternalServerError,
    ItemCollectionSizeLimitExceededException,
    ProvisionedThroughputExceededException,
    RequestLimitExceeded,
    ResourceNotFoundException,
    TableNotFoundException,
    TransactionCanceledException,
    TransactionConflictException,
    TransactionInProgressException,
} from "@aws-sdk/client-dynamodb";
import {
    ErrorBase,
    InternalError,
    UnknownError,
    getErrorConstructorForCode,
} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error-code";

/**
 * Takes an [error returned by DynamoDB][1] and gives it one of our error
 * codes.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
 */
export function classifyDynamoError(error: unknown): ErrorBase {
    if (!(error instanceof Error)) return new InternalError("DynamoDB threw a non-Error object");

    let errorCode: ErrorCode | null = null;
    if (error instanceof InternalServerError) {
        errorCode = ErrorCode.Internal;
    } else if (error instanceof RequestLimitExceeded) {
        errorCode = ErrorCode.Unavailable;
    } else if (error instanceof ProvisionedThroughputExceededException) {
        errorCode = ErrorCode.Unavailable;
    } else if (error instanceof ItemCollectionSizeLimitExceededException) {
        errorCode = ErrorCode.ResourceExhausted;
    } else if (error instanceof ConditionalCheckFailedException) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error instanceof TransactionConflictException) {
        errorCode = ErrorCode.Unavailable;
    } else if (error instanceof DuplicateItemException) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error instanceof IdempotentParameterMismatchException) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error instanceof TransactionInProgressException) {
        errorCode = ErrorCode.Unavailable;
    } else if (error instanceof TransactionCanceledException) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (
        error instanceof ResourceNotFoundException ||
        error instanceof TableNotFoundException ||
        error instanceof IndexNotFoundException
    ) {
        // Our code should only references resources that exist. It's not a client
        // error if we don't.
        errorCode = ErrorCode.Internal;
    }

    if (errorCode !== null) {
        const ErrorConstructor = getErrorConstructorForCode(errorCode);
        return new ErrorConstructor(error.message, {cause: error});
    }

    if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.warn("Unclassified DynamoDB error:", error);
    }
    return new UnknownError(error.message, {cause: error});
}
