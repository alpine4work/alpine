import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * Is the provided error a failure due to a DynamoDB condition check?
 *
 * True for failures in `PutItem` and `TransactWriteItems` alike.
 */
export function isDynamoConditionCheckError(error: unknown): boolean {
    // Recurse into the error's cause if there is one. `classifyDynamoError()` will put
    // the raw error JSON from the response in the cause property.
    if (error instanceof Error && "cause" in error) return isDynamoConditionCheckError(error.cause);

    if (!isObject(error)) return false;

    // If an individual `PutItem` request's condition failed we get this error code.
    if (error.__type === "ConditionalCheckFailedException") return true;

    // If a transaction check in `TransactWriteItems` failed then we get this error
    // code. Check to make sure one of the cancellation reasons was specifically a
    // condition check failure.
    if (
        error.__type === "TransactionCanceledException" &&
        Array.isArray(error.CancellationReasons) &&
        error.CancellationReasons.every(
            cancellationReason =>
                isObject(cancellationReason) &&
                (cancellationReason.Code === "None" ||
                    cancellationReason.Code === "ConditionalCheckFailed"),
        )
    ) {
        return true;
    }

    return false;
}
