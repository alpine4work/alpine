import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * Is the provided error a failure due to a DynamoDB resource not being found?
 *
 * Thrown by commands like [`DescribeTable`][1].
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTable.html
 */
export function isDynamoResourceNotFoundError(error: unknown): boolean {
    // Recurse into the error's cause if there is one. `classifyDynamoError()` will put
    // the raw error JSON from the response in the cause property.
    if (error instanceof Error && "cause" in error)
        return isDynamoResourceNotFoundError(error.cause);

    if (!isObject(error)) return false;

    if (error.__type === "ResourceNotFoundException") return true;

    return false;
}
