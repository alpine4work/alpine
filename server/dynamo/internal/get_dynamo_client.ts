import {DynamoContext} from "~/server/dynamo/dynamo_context";
import {DynamoClient} from "~/server/dynamo/internal/dynamo_client";

/**
 * Get the DynamoDB client from context.
 */
export function getDynamoClient(context: DynamoContext): DynamoClient {
    // @ts-expect-error: The client property is not private to our
    // `internal` folder.
    return context.dynamo._client;
}
