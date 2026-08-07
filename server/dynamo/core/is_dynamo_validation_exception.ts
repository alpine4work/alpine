import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * Is the provided error a failure due to a DynamoDB validation error?
 *
 * Thrown by commands like [`UpdateTimeToLive`][1].
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTimeToLive.html
 */
export function isDynamoValidationError(error: unknown): boolean {
    // Recurse into the error's cause if there is one. `classifyDynamoError()` will put
    // the raw error JSON from the response in the cause property.
    if (error instanceof Error && "cause" in error) return isDynamoValidationError(error.cause);

    if (!isObject(error)) return false;

    if (error.__type === "ValidationException") return true;

    return false;
}
