import {ErrorBase, UnknownError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";

/**
 * Takes an [error returned by DynamoDB][1] and gives it one of our error codes.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
 */
export function classifyDynamoError(error: {
    __type?: string;
    message?: string;
    Message?: string;
}): ErrorBase {
    let errorCode: ErrorCode | null = null;
    if (error.__type === "InternalServerError" || error.__type === "InternalFailure") {
        errorCode = ErrorCode.Internal;
    } else if (error.__type === "RequestLimitExceeded") {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type === "ProvisionedThroughputExceededException") {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type === "ItemCollectionSizeLimitExceededException") {
        errorCode = ErrorCode.ResourceExhausted;
    } else if (error.__type === "ConditionalCheckFailedException") {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error.__type === "TransactionConflictException") {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type === "DuplicateItemException") {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error.__type === "IdempotentParameterMismatchException") {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (error.__type === "TransactionInProgressException") {
        errorCode = ErrorCode.Unavailable;
    } else if (error.__type === "TransactionCanceledException") {
        errorCode = ErrorCode.FailedPrecondition;
    } else if (
        error.__type === "ResourceNotFoundException" ||
        error.__type === "ResourceInUseException" ||
        error.__type === "TableNotFoundException" ||
        error.__type === "IndexNotFoundException" ||
        // Requests to DynamoDB should all be valid. An invalid request is the developer's
        // fault, not the user's fault.
        error.__type === "ValidationException"
    ) {
        // Our code should only references resources that exist. It's not a client error if
        // we don't.
        errorCode = ErrorCode.Internal;
    }

    const message = `DynamoDB ${error.__type ? error.__type : "unknown error"}${
        error.message ? `: ${error.message}` : error.Message ? `: ${error.Message}` : ""
    }`;

    if (errorCode !== null) {
        const ErrorConstructor = getErrorConstructorForCode(errorCode);
        return new ErrorConstructor(message, {cause: error});
    }

    if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("Unclassified DynamoDB error:", error);
    }
    return new UnknownError(message, {cause: error});
}
