import {AwsClient} from "aws4fetch";
import {DynamoClient, DynamoReadConsistency} from "~/server/dynamo/internal/dynamo_client";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Context module for DynamoDB. Holds a DynamoDB client which is accessible to
 * our `internal` folder with the `getDynamoClient()` function.
 */
export class DynamoContextModule extends ContextModuleBase {
    private readonly _client!: DynamoClient;

    /**
     * The default consistency for DynamoDB reads which use this context.
     *
     * Using `Eventual` consistency is much faster but it might give you slightly
     * out of date data.
     */
    public readonly defaultReadConsistency: DynamoReadConsistency = "Eventual";

    private constructor(client: DynamoClient | null) {
        super();

        if (client !== null) {
            this._client = client;
        } else {
            // You can only create a lazily initialized DynamoDB context module in
            // Jest tests.
            assert(typeof jest !== "undefined");

            Object.defineProperty(this, "_client", {
                configurable: true,
                get: () => {
                    throw new InternalError("DynamoDB client has not been initialized");
                },
            });
        }
    }

    public static new(client: AwsClient, url: string) {
        return new DynamoContextModule(new DynamoClient(client, url));
    }

    /**
     * Create a DynamoDB context module for tests. You can lazily initialize the
     * DynamoDB client in a test.
     *
     * May only run in Jest tests.
     */
    public static test(): DynamoContextModule & {
        initialize: (client: AwsClient, url: string) => void;
    } {
        assert(typeof jest !== "undefined");

        const contextModule = new DynamoContextModule(null);

        return Object.assign(contextModule, {
            initialize: (client: AwsClient, url: string) => {
                let hasInitialized = false;
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    contextModule._client;
                    hasInitialized = true;
                } catch {
                    hasInitialized = false;
                }
                assert(!hasInitialized, "Can not initialize DynamoDB client twice");

                Object.defineProperty(contextModule, "_client", {
                    value: new DynamoClient(client, url),
                    writable: false,
                });
            },
        });
    }
}
