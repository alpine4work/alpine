import {DynamoClient} from "~/server/dynamo/core/internal/dynamo_client.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context, ContextWithDestroy} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Replace} from "~/shared/helpers/types/replace.js";

/**
 * Context module for DynamoDB. Holds a DynamoDB client which is accessible to
 * our `internal` folder with the `getDynamoClient()` function.
 */
export class DynamoContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    private readonly _client!: DynamoClient;

    /**
     * If we are in a DynamoDB transaction then this will be set to a function
     * which when called will retry the transaction.
     */
    private readonly _retryTransaction: ((error?: unknown) => never) | null;

    /**
     * Do we expect `consistency` to be `Strong` when reading data?
     *
     * In some pieces of code, like reading data for a search entity, we must use
     * strongly consistent reads or we risk not indexing some data in our search
     * index. Such code can set this to true and we'll throw an error when reading
     * data with eventual consistency in development. In production we won't throw
     * an error but we'll still log an error.
     */
    private readonly _expectsStrongReadConsistency: boolean;

    private constructor(
        client: DynamoClient | null,
        {
            retryTransaction,
            expectsStrongReadConsistency,
        }: {
            retryTransaction: ((error?: unknown) => never) | null;
            expectsStrongReadConsistency: boolean;
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

        this._retryTransaction = retryTransaction;
        this._expectsStrongReadConsistency = expectsStrongReadConsistency;
    }

    public static new(options: {
        url: string;
        signer: AwsRequestSigner;
        ensureLocalCachePath: string | null;
    }) {
        return new DynamoContextModule(new DynamoClient(options), {
            retryTransaction: null,
            expectsStrongReadConsistency: false,
        });
    }

    /**
     * Create a DynamoDB context module for tests. You can lazily initialize the
     * DynamoDB client in a test.
     *
     * May only run in a test environment.
     */
    public static test(): DynamoContextModule & {
        initialize: (options: {
            url: string;
            signer: AwsRequestSigner;
            ensureLocalCachePath: string | null;
        }) => void;
    } {
        assert(process.env.NODE_ENV === "test");

        const contextModule = new DynamoContextModule(null, {
            retryTransaction: null,
            expectsStrongReadConsistency: false,
        });

        return Object.assign(contextModule, {
            initialize: (options: {
                url: string;
                signer: AwsRequestSigner;
                ensureLocalCachePath: string | null;
            }) => {
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
                    value: new DynamoClient(options),
                    writable: false,
                });
            },
        });
    }

    /**
     * Get the DynamoDB client in tests in case you want direct access to DynamoDB.
     */
    public getClientForTest(): DynamoClient {
        assert(import.meta.jest);
        return this._client;
    }

    /**
     * Are we talking to a local DynamoDB instance?
     */
    public isLocal() {
        return this._client.getInternalClient().isLocal();
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
        let hasAlreadyAttempted = false;

        return retryWithExponentialBackoff(retry => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            const dynamoContextModule = new DynamoContextModule(this._client, {
                retryTransaction: retry,
                expectsStrongReadConsistency: this._expectsStrongReadConsistency,
            });

            if (isInitialAttempt || !("cache" in this._context)) {
                return this._context.with({dynamo: dynamoContextModule}, action);
            } else {
                // On second attempt, use an empty cache when we re-run the action. Because
                // usually the reason we're retrying is we need to read an item with a newer
                // `updateLockVersion`. The cache outside this retry loop isn't affected. But
                // if we read the item using a cache then we'll keep re-reading the cached item
                // instead of reading a new item. Causing us to retry until
                // `retryWithExponentialBackoff()` reaches its retry limit.
                return this._context.with(
                    {
                        dynamo: dynamoContextModule,
                        cache: CacheContextModule.new(),
                    },
                    // @ts-expect-error
                    action,
                );
            }
        });
    }

    /**
     * Expect all DynamoDB reads made by this context to use strong consistency.
     * Throws an error in development and logs in production but won't throw an
     * error to avoid breaking the product in case of accidentally eventually
     * consistent reads.
     */
    public expectStrongReadConsistency<Modules extends {}>(
        this: ContextModuleBase<Modules> & DynamoContextModule,
    ): ContextWithDestroy<Replace<Modules, {dynamo: DynamoContextModule}>> {
        if (this._expectsStrongReadConsistency) return this._context as any;

        return this._context.clone({
            dynamo: new DynamoContextModule(this._client, {
                retryTransaction: this._retryTransaction,
                expectsStrongReadConsistency: true,
            }),
        });
    }

    /**
     * Same as `expectStrongReadConsistency()` but always returns a context module.
     * In case, for performance, you want to set `expectsStrongReadConsistency` to
     * true at the same time you're adding some other context modules.
     */
    public expectStrongReadConsistencyReturningModule<Modules extends {}>(
        this: ContextModuleBase<Modules> & DynamoContextModule,
    ): DynamoContextModule {
        return new DynamoContextModule(this._client, {
            retryTransaction: this._retryTransaction,
            expectsStrongReadConsistency: true,
        });
    }

    /**
     * Stop expecting DynamoDB reads to be strongly consistent. After calling this
     * you can make eventually consistent reads that won't throw an error.
     */
    public unexpectStrongReadConsistency<Modules extends {}>(
        this: ContextModuleBase<Modules> & DynamoContextModule,
    ): ContextWithDestroy<Replace<Modules, {dynamo: DynamoContextModule}>> {
        if (!this._expectsStrongReadConsistency) return this._context as any;

        return this._context.clone({
            dynamo: new DynamoContextModule(this._client, {
                retryTransaction: this._retryTransaction,
                expectsStrongReadConsistency: false,
            }),
        });
    }

    public fork() {
        return new DynamoContextModule(this._client, {
            // Reset retry transaction in fork. Forked actions need their own `retryTransaction()`
            // call. The retry call from the action we forked from may have finished long ago.
            retryTransaction: null,
            expectsStrongReadConsistency: this._expectsStrongReadConsistency,
        });
    }
}
