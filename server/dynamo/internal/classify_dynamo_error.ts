import {ErrorBase, UnknownError, getErrorConstructorForCode} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";

/**
 * Takes an [error returned by DynamoDB][1] and gives it one of our error
 * codes.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
 */
export function classifyDynamoError(error: {
    __type?: string;
    message?: string;
    Message?: string;
}): ErrorBase {
    let errorCode: ErrorCode | null = null;
    if (error.__type?.endsWith("InternalServerError")) {
        errorCode = ErrorCode.Internal;
    } else if (error.__type?.endsWith("RequestLimitExceeded")) {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type?.endsWith("ProvisionedThroughputExceededException")) {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type?.endsWith("ItemCollectionSizeLimitExceededException")) {
        errorCode = ErrorCode.ResourceExhausted;
    } else if (error.__type?.endsWith("ConditionalCheckFailedException")) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error.__type?.endsWith("TransactionConflictException")) {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type?.endsWith("DuplicateItemException")) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error.__type?.endsWith("IdempotentParameterMismatchException")) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error.__type?.endsWith("TransactionInProgressException")) {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type?.endsWith("TransactionCanceledException")) {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (
        error.__type?.endsWith("ResourceNotFoundException") ||
        error.__type?.endsWith("TableNotFoundException") ||
        error.__type?.endsWith("IndexNotFoundException") ||
        // Requests to DynamoDB should all be valid. An invalid request is the
        // developer's fault, not the user's fault.
        error.__type?.endsWith("ValidationException")
    ) {
        // Our code should only references resources that exist. It's not a client
        // error if we don't.
        errorCode = ErrorCode.Internal;
    }

    const message = `DynamoDB ${
        error.__type
            ? error.__type.includes("#")
                ? error.__type.split("#")[1]!
                : error.__type
            : "unknown error"
    }${error.message ? `: ${error.message}` : error.Message ? `: ${error.Message}` : ""}`;

    if (errorCode !== null) {
        const ErrorConstructor = getErrorConstructorForCode(errorCode);
        return new ErrorConstructor(message, {cause: error});
    }

    if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.warn("Unclassified DynamoDB error:", error);
    }
    return new UnknownError(message, {cause: error});
}
