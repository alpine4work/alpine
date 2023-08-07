import {AwsClient} from "aws4fetch";
import {
    DynamoClient,
    DynamoClientBatchContext,
    DynamoReadConsistency,
} from "~/server/dynamo/internal/dynamo_client.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

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
    // TODO(calebmer): I'm starting to suspect default read consistency may be a
    // bad design? Any function may make so many reads and make more reads in the
    // future, setting default read consistency sets like controlling an
    // implementation detail too high up.
    //
    // Get rid of it and set read consistency on individual reads.
    public readonly defaultReadConsistency: DynamoReadConsistency;

    /**
     * If we are in a DynamoDB transaction then this will be set to a function
     * which when called will retry the transaction.
     */
    private readonly _retryTransaction: ((error?: unknown) => never) | null;

    private constructor(
        client: DynamoClient | null,
        {
            defaultReadConsistency,
            retryTransaction,
        }: {
            defaultReadConsistency: DynamoReadConsistency;
            retryTransaction: ((error?: unknown) => never) | null;
        },
    ) {
        super();

        if (client !== null) {
            this._client = client;
        } else {
            // May only construct an uninitialized context module in tests.
            assert(process.env.NODE_ENV === "test");

            Object.defineProperty(this, "_client", {
                configurable: true,
                get: () => {
                    throw new InternalError("DynamoDB client has not been initialized");
                },
            });
        }

        this.defaultReadConsistency = defaultReadConsistency;
        this._retryTransaction = retryTransaction;
    }

    public static new(options: {
        getAwsHttpClient: (tracer: TracerBase) => Promise<AwsClient>;
        awsDynamoUrl: string;
    }) {
        return new DynamoContextModule(new DynamoClient(options), {
            defaultReadConsistency: "Eventual",
            retryTransaction: null,
        });
    }

    /**
     * Create a DynamoDB context module for tests. You can lazily initialize the
     * DynamoDB client in a test.
     *
     * May only run in a test environment.
     */
    public static test(): DynamoContextModule & {
        initialize: (awsHttpClient: AwsClient, awsDynamoUrl: string) => void;
    } {
        assert(process.env.NODE_ENV === "test");

        const contextModule = new DynamoContextModule(null, {
            defaultReadConsistency: "Eventual",
            retryTransaction: null,
        });

        return Object.assign(contextModule, {
            initialize: (awsHttpClient: AwsClient, awsDynamoUrl: string) => {
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
                    value: new DynamoClient({
                        getAwsHttpClient: async () => awsHttpClient,
                        awsDynamoUrl,
                    }),
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
            dynamo: new DynamoContextModule(this._client, {
                defaultReadConsistency,
                retryTransaction: this._retryTransaction,
            }),
        });
    }

    /**
     * Creates a retry loop for expected transaction errors. You can not nest two
     * retry transaction loops.
     *
     * Will retry if certain condition checks fail. For instance an
     * `updateLockVersion` condition check failure.
     */
    public retryTransaction<Modules extends {}, Value>(
        this: ContextModuleBase<Modules> & DynamoContextModule,
        action: (
            context: Context<Replace<Modules, {dynamo: DynamoContextModule}>>,
        ) => Promise<Value>,
    ): Promise<Value> {
        if (this._retryTransaction)
            throw new InternalError("Can not nest DynamoDB transaction retry loops");

        return retryWithExponentialBackoff(retry => {
            return this._context.with(
                {
                    dynamo: new DynamoContextModule(this._client, {
                        defaultReadConsistency: this.defaultReadConsistency,
                        retryTransaction: retry,
                    }),
                },
                action,
            );
        });
    }
}

/**
 * When this module exists in a context. Any calls to `getItem()`,
 * `createOrReplaceItem()`, or `deleteItem()` in short succession on the
 * context are batched.
 *
 * We batch at the action level so that unrelated requests do not share IO.
 */
export class DynamoBatchContextModule extends ContextModuleBase {
    public readonly batchContext = new DynamoClientBatchContext();
}
