import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * Is the provided error a failure due to an idempotent request to DynamoDB having
 * different parameters?
 *
 * Thrown by the [`TransactWriteItems`][1] command when a `ClientRequestToken` is
 * provided to make the transaction idempotent.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
 */
export function isDynamoIdempotentParameterMismatchError(error: unknown): boolean {
    // Recurse into the error's cause if there is one. `classifyDynamoError()` will put
    // the raw error JSON from the response in the cause property.
    if (error instanceof Error && "cause" in error)
        return isDynamoIdempotentParameterMismatchError(error.cause);

    if (!isObject(error)) return false;

    if (error.__type === "IdempotentParameterMismatchException") return true;

    return false;
}
