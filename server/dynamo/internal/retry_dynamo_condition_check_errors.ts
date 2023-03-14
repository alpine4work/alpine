import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff";

/**
 * Executes the provided action and if it fails because a DynamoDB condition
 * failed then we will retry the action with exponential backoff.
 *
 * We will keep retrying until the action either succeeds or the wait becomes
 * excessive.
 *
 * Useful if you want to update a value using some form of [optimistic
 * concurrency control][1].
 *
 * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
 */
export function retryDynamoConditionCheckErrors<Value>(
    action: () => Promise<Value>,
): Promise<Value> {
    return retryWithExponentialBackoff(action, isDynamoConditionCheckError);
}
