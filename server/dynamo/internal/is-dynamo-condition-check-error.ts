import {
    ConditionalCheckFailedException,
    TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";

/**
 * Is the provided error a failure due to a DynamoDB condition check?
 *
 * True for failures in `PutItem` and `TransactWriteItems` alike.
 */
export function isDynamoConditionCheckError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    if (error instanceof ConditionalCheckFailedException) return true;

    if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some(
            cancellationReason => cancellationReason.Code === "ConditionalCheckFailed",
        )
    ) {
        return true;
    }

    // If this is not a condition check error but we have an `error.cause`
    // property, recurse into the parent error.
    if ("cause" in error) return isDynamoConditionCheckError(error.cause);
    return false;
}
