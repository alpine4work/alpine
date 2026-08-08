import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * Is the provided error a failure due to a DynamoDB condition check from a
 * transaction? Checks that `conditionCheckIndex` is the cancellation reason with
 * condition check failure.
 */
export function isDynamoTransactionCancelledExceptionByConditionCheckError(
    error: unknown,
    conditionCheckIndex: number,
): boolean {
    // Recurse into the error's cause if there is one. `classifyDynamoError()` will put
    // the raw error JSON from the response in the cause property.
    if (error instanceof Error && "cause" in error) {
        return isDynamoTransactionCancelledExceptionByConditionCheckError(
            error.cause,
            conditionCheckIndex,
        );
    }

    if (!isObject(error)) return false;

    // If a transaction check in `TransactWriteItems` failed then we get this error
    // code. Check to make sure one of the cancellation reasons was specifically a
    // condition check failure.
    if (
        error.__type === "TransactionCanceledException" &&
        Array.isArray(error.CancellationReasons)
    ) {
        const cancellationReason = error.CancellationReasons[conditionCheckIndex];

        if (isObject(cancellationReason) && cancellationReason.Code === "ConditionalCheckFailed") {
            return true;
        }
    }

    return false;
}
