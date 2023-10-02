import {OpensearchClientInterface} from "~/server/opensearch/opensearch_client.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {InternalError, UnavailableError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

export class OpensearchContextModule
    extends ContextModuleBase
    implements ForkableContextModuleBase
{
    /**
     * The OpenSearch client. Even though this client is public, you can't do
     * anything with it without an `OpensearchIndex` object which is private to
     * whatever package chooses to define it. That way we limit what you can do
     * with an OpenSearch client.
     */
    public readonly client!: OpensearchClientInterface;

    private constructor(client: OpensearchClientInterface | null) {
        super();

        if (client !== null) {
            this.client = client;
        } else {
            // May only construct an uninitialized context module in tests.
            assert(process.env.NODE_ENV === "test");

            Object.defineProperty(this, "client", {
                configurable: true,
                get: () => {
                    throw new InternalError("OpenSearch client has not been initialized");
                },
            });
        }
    }

    public static new(client: OpensearchClientInterface) {
        return new OpensearchContextModule(client);
    }

    /**
     * Create an OpenSearch context module for tests. You can lazily initialize the
     * OpenSearch client in a test.
     *
     * May only run in a test environment.
     */
    public static test(): OpensearchContextModule & {
        initialize: (client: OpensearchClientInterface) => void;
    } {
        assert(process.env.NODE_ENV === "test");

        const contextModule = new OpensearchContextModule(null);

        return Object.assign(contextModule, {
            initialize: (client: OpensearchClientInterface) => {
                let hasInitialized = false;
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    contextModule.client;
                    hasInitialized = true;
                } catch {
                    hasInitialized = false;
                }
                assert(!hasInitialized, "Can not initialize DynamoDB client twice");

                Object.defineProperty(contextModule, "client", {
                    value: client,
                    writable: false,
                });
            },
        });
    }

    public fork() {
        return new OpensearchContextModule(this.client);
    }
}

/**
 * If we have a test with OpenSearch disabled, we use this client which
 * throws whenever you try to access anything from OpenSearch.
 */
export class TestDisabledOpensearchClient implements OpensearchClientInterface {
    constructor() {
        // Can only use this context module in tests.
        assert(process.env.NODE_ENV === "test");
    }

    private _newUnavailableError() {
        return new UnavailableError(
            "OpenSearch is not enabled for this test, try setting `shouldStartOpensearch: true` in `createTestContext()`",
        );
    }

    public getDocIfExists(): never {
        throw this._newUnavailableError();
    }

    public multiGetDocsIfExist(): never {
        throw this._newUnavailableError();
    }

    public bulkWrite(): never {
        throw this._newUnavailableError();
    }

    public search(): never {
        throw this._newUnavailableError();
    }

    public searchWithoutReturningDocs(): never {
        throw this._newUnavailableError();
    }

    public refresh(): never {
        throw this._newUnavailableError();
    }

    public updateByQuery(): never {
        throw this._newUnavailableError();
    }
}
