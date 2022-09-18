import {DynamoClient} from "~/server/dynamo/internal/dynamo-client";
import {RequestContext} from "~/server/request/request-context";

/**
 * Get the `DynamoClient` object stored on our `RequestContext`.
 *
 * This is a free function living in `server/dynamo/internal` because we want
 * our folder visibility rules to ban using this function outside of
 * `server/dynamo`.
 */
export function getDynamoClientFromRequestContext(context: RequestContext): DynamoClient {
    // @ts-expect-error: The `_dynamoClient` property is private. But not for code
    // in the `server/dynamo` folder.
    return context._dynamoClient;
}
