import {AwsClient} from "aws4fetch";
import {DynamoClient, DynamoReadConsistency} from "~/server/dynamo/internal/dynamo_client";
import {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Replace} from "~/shared/helpers/types/replace";

/**
 * Context module for DynamoDB. Holds a DynamoDB client which is accessible to
 * our `internal` folder with the `getDynamoClient()` function.
 */
export class DynamoContextModule<Modules extends {} = {}> extends ContextModuleBase<Modules> {
    private readonly _client!: DynamoClient;

    /**
     * The default consistency for DynamoDB reads which use this context.
     *
     * Using `Eventual` consistency is much faster but it might give you slightly
     * out of date data.
     */
    public readonly defaultReadConsistency: DynamoReadConsistency;

    private constructor(
        client: DynamoClient | null,
        {defaultReadConsistency}: {defaultReadConsistency: DynamoReadConsistency},
    ) {
        super();

        if (client !== null) {
            this._client = client;
        } else {
            // May only run in a test environment.
            assert(process.env.NODE_ENV === "test");

            Object.defineProperty(this, "_client", {
                configurable: true,
                get: () => {
                    throw new InternalError("DynamoDB client has not been initialized");
                },
            });
        }

        this.defaultReadConsistency = defaultReadConsistency;
    }

    public static new(client: AwsClient, url: string) {
        return new DynamoContextModule(new DynamoClient(client, url), {
            defaultReadConsistency: "Eventual",
        });
    }

    /**
     * Create a DynamoDB context module for tests. You can lazily initialize the
     * DynamoDB client in a test.
     *
     * May only run in a test environment.
     */
    public static test(): DynamoContextModule & {
        initialize: (client: AwsClient, url: string) => void;
    } {
        assert(process.env.NODE_ENV === "test");

        const contextModule = new DynamoContextModule(null, {
            defaultReadConsistency: "Eventual",
        });

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

    /**
     * Clone the context and set a different default read consistency for DynamoDB.
     * Use this if you want to execute some code with a strong read consistency
     * instead of an eventual read consistency.
     */
    public setDefaultReadConsistency<Modules extends {}>(
        this: DynamoContextModule<Modules>,
        defaultReadConsistency: DynamoReadConsistency,
    ): Context<Replace<Modules, {dynamo: DynamoContextModule}>> {
        return this._context.clone({
            dynamo: new DynamoContextModule(this._client, {defaultReadConsistency}),
        });
    }
}
