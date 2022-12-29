import {AwsClient} from "aws4fetch";
import {DynamoClient, DynamoReadConsistency} from "~/server/dynamo/internal/dynamo_client";
import {ContextModuleBase} from "~/shared/context/context_module_base";

/**
 * Context module for DynamoDB. Holds a DynamoDB client which is accessible to
 * our `internal` folder with the `getDynamoClient()` function.
 */
export class DynamoContextModule extends ContextModuleBase {
    private readonly _client: DynamoClient;

    /**
     * The default consistency for DynamoDB reads which use this context.
     *
     * Using `Eventual` consistency is much faster but it might give you slightly
     * out of date data.
     */
    public readonly defaultReadConsistency: DynamoReadConsistency = "Eventual";

    constructor(client: AwsClient, url: string) {
        super();
        this._client = new DynamoClient(client, url);
    }
}
