import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * Is the provided error a failure due to a DynamoDB resource already being in use?
 *
 * Thrown by commands like [`CreateTable`][1].
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
 */
export function isDynamoResourceInUseError(error: unknown): boolean {
    // Recurse into the error's cause if there is one. `classifyDynamoError()` will put
    // the raw error JSON from the response in the cause property.
    if (error instanceof Error && "cause" in error) return isDynamoResourceInUseError(error.cause);

    if (!isObject(error)) return false;

    if (error.__type === "ResourceInUseException") return true;

    return false;
}
