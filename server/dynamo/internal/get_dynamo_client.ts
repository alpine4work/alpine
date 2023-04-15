import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {DynamoClient} from "~/server/dynamo/internal/dynamo_client";

/**
 * Get the DynamoDB client from context.
 */
export function getDynamoClient(context: DynamoContext): DynamoClient {
    // @ts-expect-error: The client property is not private to our
    // `internal` folder.
    return context.dynamo._client;
}

/**
 * Get the DynamoDB `retryTransaction()` function from context.
 */
export function getDynamoRetryTransactionIfExists(context: DynamoContext): (() => never) | null {
    // @ts-expect-error: The `retryTransaction` property is not private to our
    // `internal` folder.
    return context.dynamo._retryTransaction;
}
