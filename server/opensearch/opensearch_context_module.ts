import {
    OpensearchBulkCommandBase,
    OpensearchClient,
    OpensearchClientBulkOptions,
    OpensearchClientDocVersion,
    OpensearchClientDocWithId,
    OpensearchClientDocWithIdAndVersion,
    OpensearchClientIndexDocIfVersionOptions,
    OpensearchClientInterface,
    OpensearchMultiGetDocCommandBase,
    OpensearchMultiGetDocCommandOutputType,
    TestDisabledOpensearchClient,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchHighlightClause} from "~/server/opensearch/opensearch_highlight_clause.js";
import {
    OpensearchIndex,
    OpensearchIndexDocIdType,
    OpensearchIndexDocType,
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexRoutingType,
    OpensearchIndexStoredFieldsType,
} from "~/server/opensearch/opensearch_index.js";
import {OpensearchIndexAnalysisAnalyzer} from "~/server/opensearch/opensearch_index_analysis.js";
import {OpensearchQueryClause} from "~/server/opensearch/opensearch_query_clause.js";
import {OpensearchSortClause} from "~/server/opensearch/opensearch_sort_clause.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type WithoutFirstTracerParameter<F> = F extends (
    tracer: TracerBase,
    ...args: infer Args
) => infer Return
    ? (...args: Args) => Return
    : never;

type OpensearchContextModuleInterface = {
    [Key in keyof OpensearchClientInterface]: WithoutFirstTracerParameter<
        OpensearchClientInterface[Key]
    >;
};

export class OpensearchContextModule
    extends ContextModuleBase<{tracer: TracerContextModule}>
    implements ForkableContextModuleBase, OpensearchContextModuleInterface
{
    /**
     * The OpenSearch client. Even though this client is public, you can't do anything
     * with it without an `OpensearchIndex` object which is private to whatever package
     * chooses to define it. That way we limit what you can do with an OpenSearch
     * client.
     */
    private readonly _client!: OpensearchClientInterface;

    private constructor(client: OpensearchClientInterface | null) {
        super();

        if (client !== null) {
            this._client = client;
        } else {
            // May only construct an uninitialized context module in tests.
            assert(isTestNodeEnvOrAdminScenariosScript);

            Object.defineProperty(this, "_client", {
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
        assert(isTestNodeEnvOrAdminScenariosScript);

        const contextModule = new OpensearchContextModule(null);

        return Object.assign(contextModule, {
            initialize: (client: OpensearchClientInterface) => {
                let hasInitialized = false;
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    contextModule._client;
                    hasInitialized = true;
                } catch {
                    hasInitialized = false;
                }
                assert(!hasInitialized, "Can not initialize OpenSearch client twice");

                Object.defineProperty(contextModule, "_client", {
                    value: client,
                    writable: false,
                });
            },
        });
    }

    public isDisabledForTest() {
        return this._client instanceof TestDisabledOpensearchClient;
    }

    public fork() {
        return new OpensearchContextModule(this._client);
    }

    /**
     * Creates the OpenSearch index if it doesn't exist. This function is idempotent.
     * You may call it multiple times and it will produce the same response. Only
     * attempts to create the index once per process.
     *
     * If we're in a test that's disabled OpenSearch this is a noop.
     *
     * Throws an error in production.
     */
    public async ensureLocalIndexIfEnabled<
        Routing extends string,
        DocId extends string,
        Doc,
        FlattenedKeys extends string,
        StoredFields extends {[key: string]: unknown},
    >(index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys, StoredFields>) {
        if (this._client instanceof OpensearchClient) {
            await this._client.ensureLocalIndex(this._context.tracer.getTracer(), index);
        }
    }

    /**
     * Gets a document by the provided ID using the [get document API][1].
     *
     * We do not automatically batch calls to this function. To load multiple documents
     * with one API call see `multiGetDocsIfExist()`.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    public getDocIfExists<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        options?: {realtime?: boolean},
    ): Promise<OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    > | null> {
        return this._client.getDocIfExists(
            this._context.tracer.getTracer(),
            index,
            routing,
            id,
            options,
        );
    }

    /**
     * Gets a document by the provided ID using the [get document API][1] but without
     * `_source` and with `stored_fields`.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    public getDocWithoutSourceIfExists<
        Index extends OpensearchIndex<any, any, any, any, any>,
        StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
    >(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        options?: {
            storedFields?: Array<StoredFieldKeys>;
            realtime?: boolean;
        },
    ): Promise<{
        readonly id: OpensearchIndexDocIdType<Index>;
        readonly routing: OpensearchIndexRoutingType<Index>;
        readonly version: OpensearchClientDocVersion | null;
        readonly fields: {
            readonly [Key in StoredFieldKeys]?: ReadonlyArray<
                OpensearchIndexStoredFieldsType<Index>[Key]
            >;
        };
    } | null> {
        return this._client.getDocWithoutSourceIfExists(
            this._context.tracer.getTracer(),
            index,
            routing,
            id,
            options,
        );
    }

    /**
     * Gets multiple documents in one network request using the [multi-get documents
     * API][1].
     *
     * Documents are returned in the order `DocId`s were provided in.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    public multiGetDocsIfExist<
        const Commands extends ReadonlyArray<OpensearchMultiGetDocCommandBase<any, any>>,
    >(
        commands: Commands,
    ): Promise<{
        -readonly [K in keyof Commands]: OpensearchMultiGetDocCommandOutputType<Commands[K]> | null;
    }> {
        return this._client.multiGetDocsIfExist(this._context.tracer.getTracer(), commands);
    }

    /**
     * Gets multiple documents in one network request using the [multi-get documents
     * API][1].
     *
     * This method is slightly more efficient than `multiGetDocsIfExist()` since
     * `multiGetDocsIfExist()` calls this method and turns the map into an array.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    public async multiGetDocByIdByIndexIfExist<
        Index extends OpensearchIndex<any, any, any, any, any>,
        Output,
    >(
        commands: ReadonlyArray<OpensearchMultiGetDocCommandBase<Index, Output>>,
    ): Promise<Map<Index, Map<OpensearchIndexDocIdType<Index>, Output>>> {
        return await this._client.multiGetDocByIdByIndexIfExist(
            this._context.tracer.getTracer(),
            commands,
        );
    }

    /**
     * Indexes a single document using the [index document API][1].
     *
     * You must provide the document's version. This call will fail if the version does
     * not match what's in OpenSearch. This implements [optimistic concurrency
     * control][2].
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/document-apis/index-document/
     * [2]:
     *     https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
     */
    public indexDocIfVersion<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        doc: OpensearchClientDocWithIdAndVersion<
            OpensearchIndexDocIdType<Index>,
            OpensearchIndexDocType<Index>
        >,
        options?: OpensearchClientIndexDocIfVersionOptions,
    ): Promise<void> {
        return this._client.indexDocIfVersion(
            this._context.tracer.getTracer(),
            index,
            routing,
            doc,
            options,
        );
    }

    /**
     * Lets you add, update, or delete multiple documents in a single request using the
     * [bulk API][1].
     *
     * We have a special `IndexIfVersion` that will only index the document if it's
     * version matches what's in the source. This implements [optimistic concurrency
     * control][2].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/bulk/
     * [2]:
     *     https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
     */
    public bulk<const Commands extends ReadonlyArray<OpensearchBulkCommandBase<any>>>(
        commands: Commands,
        options?: OpensearchClientBulkOptions,
    ): Promise<void> {
        return this._client.bulk(this._context.tracer.getTracer(), commands, options);
    }

    /**
     * Lets you execute a search against an OpenSearch index with the [search API][1].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    public search<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        options: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            afterCursor?: ReadonlyArray<JsonScalarValue | bigint>;
            withCursor?: boolean;
            highlight?: OpensearchHighlightClause<OpensearchIndexFlattenedKeysType<Index>>;
            explain?: boolean;
        },
    ): Promise<{
        hits: Array<
            OpensearchClientDocWithId<
                OpensearchIndexDocIdType<Index>,
                OpensearchIndexDocType<Index>
            > & {
                readonly score: number;
                readonly cursor?: ReadonlyArray<JsonValue>;
                readonly highlight?: {
                    readonly [Key in OpensearchIndexFlattenedKeysType<Index>]?: Array<string>;
                };
                readonly innerHits?: {
                    readonly [key: string]: Array<{
                        readonly offset: number;
                        readonly fields: {
                            readonly [Key in OpensearchIndexStoredFieldsType<Index>]?: ReadonlyArray<
                                OpensearchIndexStoredFieldsType<Index>[Key]
                            >;
                        };
                    }>;
                };
                readonly explanation?: OpensearchSearchHitExplanation;
                readonly matchedQueries?: ReadonlyArray<string>;
            }
        >;
    }> {
        return this._client.search(this._context.tracer.getTracer(), index, routing, options);
    }

    /**
     * Lets you execute a search against an OpenSearch index with the [search API][1]
     * without returning the OpenSearch docs, just there IDs.
     *
     * This can be much more efficient than a regular `search()` since looking up docs
     * in OpenSearch can be an expensive step once query results are determined.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    public searchWithoutSource<
        Index extends OpensearchIndex<any, any, any, any, any>,
        StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
    >(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        options: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            afterCursor?: ReadonlyArray<JsonScalarValue | bigint>;
            storedFields?: Array<StoredFieldKeys>;
            highlight?: OpensearchHighlightClause<OpensearchIndexFlattenedKeysType<Index>>;
            explain?: boolean;
        },
    ): Promise<{
        hits: Array<{
            readonly score: number;
            readonly id: OpensearchIndexDocIdType<Index>;
            readonly fields: {
                readonly [Key in StoredFieldKeys]?: ReadonlyArray<
                    OpensearchIndexStoredFieldsType<Index>[Key]
                >;
            };
            readonly cursor?: ReadonlyArray<JsonValue>;
            readonly highlight?: {
                readonly [Key in OpensearchIndexFlattenedKeysType<Index>]?: Array<string>;
            };
            readonly innerHits?: {
                readonly [key: string]: Array<{
                    readonly offset: number;
                    readonly fields: {
                        readonly [Key in keyof OpensearchIndexStoredFieldsType<Index>]?: ReadonlyArray<
                            OpensearchIndexStoredFieldsType<Index>[Key]
                        >;
                    };
                }>;
            };
            readonly explanation?: OpensearchSearchHitExplanation;
            readonly matchedQueries?: ReadonlyArray<string>;
        }>;
    }> {
        return this._client.searchWithoutSource(
            this._context.tracer.getTracer(),
            index,
            routing,
            options,
        );
    }

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]:
     *     https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    public refresh<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
    ): Promise<void> {
        return this._client.refresh(this._context.tracer.getTracer(), index);
    }

    /**
     * Analyze some text using the [analysis API][1].
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/analyze-apis/#apply-a-built-in-analyzer
     */
    public analyze<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
        analyzer: OpensearchIndexAnalysisAnalyzer,
        text: string,
    ): Promise<
        Array<{
            token: string;
            startOffset: number;
            endOffset: number;
            type: string;
            position: number;
        }>
    > {
        return this._client.analyze(this._context.tracer.getTracer(), index, analyzer, text);
    }
}
