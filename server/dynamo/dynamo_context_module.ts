import {AwsClient} from "aws4fetch";
import {createAwsClientFromEnv} from "~/server/aws/create_aws_client_from_env";
import {DynamoClient} from "~/server/dynamo/internal/dynamo_client";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Context module for DynamoDB. Holds a DynamoDB client which is accessible to
 * our `internal` folder with the `getDynamoClient()` function.
 */
export class DynamoContextModule extends ContextModuleBase {
    private readonly _client: DynamoClient;

    constructor(client: AwsClient, url: string) {
        super();
        this._client = new DynamoClient(client, url);
    }

    /**
     * Create an AWS context module just for use in tests. Uses LocalStack.
     */
    public static test() {
        assert(typeof jest !== "undefined");
        return new DynamoContextModule(createAwsClientFromEnv({}), "http://127.0.0.1:4566");
    }
}
