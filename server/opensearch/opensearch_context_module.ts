import {
    OpensearchBulkCommandBase,
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
import {JsonObjectValue, JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
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
     * The OpenSearch client. Even though this client is public, you can't do
     * anything with it without an `OpensearchIndex` object which is private to
     * whatever package chooses to define it. That way we limit what you can do
     * with an OpenSearch client.
     */
    private readonly _client!: OpensearchClientInterface;

    private constructor(client: OpensearchClientInterface | null) {
        super();

        if (client !== null) {
            this._client = client;
        } else {
            // May only construct an uninitialized context module in tests.
            assert(process.env.NODE_ENV === "test");

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
        assert(process.env.NODE_ENV === "test");

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
     * Gets a document by the provided ID using the [get document API][1].
     *
     * We do not automatically batch calls to this function. To load multiple
     * documents with one API call see `multiGetDocsIfExist()`.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
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
     * Gets a document by the provided ID using the [get document API][1] but
     * without `_source` and with `stored_fields`.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
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
     * Gets multiple documents in one network request using the [multi-get
     * documents API][1].
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
     * Indexes a single document using the [index document API][1].
     *
     * You must provide the document's version. This call will fail if the version
     * does not match what's in OpenSearch. This implements [optimistic concurrency
     * control][2].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/index-document/
     * [2]: https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
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
     * Lets you add, update, or delete multiple documents in a single request using
     * the [bulk API][1].
     *
     * We have a special `IndexIfVersion` that will only index the document if it's
     * version matches what's in the source. This implements [optimistic
     * concurrency control][2].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/bulk/
     * [2]: https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
     */
    public bulk<const Commands extends ReadonlyArray<OpensearchBulkCommandBase<any>>>(
        commands: Commands,
        options?: OpensearchClientBulkOptions,
    ): Promise<void> {
        return this._client.bulk(this._context.tracer.getTracer(), commands, options);
    }

    /**
     * Lets you execute a search against an OpenSearch index with the [search
     * API][1].
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
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
            highlight?: OpensearchHighlightClause<OpensearchIndexFlattenedKeysType<Index>>;
        },
    ): Promise<
        Array<
            OpensearchClientDocWithId<
                OpensearchIndexDocIdType<Index>,
                OpensearchIndexDocType<Index>
            >
        >
    > {
        return this._client.search(this._context.tracer.getTracer(), index, routing, options);
    }

    /**
     * Lets you execute a search against an OpenSearch index with the [search
     * API][1] without returning the OpenSearch docs, just there IDs.
     *
     * This can be much more efficient than a regular `search()` since looking up
     * docs in OpenSearch can be an expensive step once query results are
     * determined.
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
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
            storedFields?: Array<StoredFieldKeys>;
            highlight?: OpensearchHighlightClause<OpensearchIndexFlattenedKeysType<Index>>;
        },
    ): Promise<
        Array<{
            readonly score: number;
            readonly id: OpensearchIndexDocIdType<Index>;
            readonly fields: {
                readonly [Key in StoredFieldKeys]?: ReadonlyArray<
                    OpensearchIndexStoredFieldsType<Index>[Key]
                >;
            };
            readonly sort?: ReadonlyArray<JsonValue>;
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
        }>
    > {
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
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    public refresh<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
    ): Promise<void> {
        return this._client.refresh(this._context.tracer.getTracer(), index);
    }

    /**
     * Update many documents in an OpenSearch index at once with the [update by
     * query API][1].
     *
     * If there are version conflicts while updating a document the update on that
     * document is dropped and we proceed updating other documents. It's
     * [recommended by the ElasticSearch team][2] to keep retrying updates by query
     * until you have no version conflicts.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
     * [2]: https://github.com/elastic/elasticsearch/issues/22723#issuecomment-274156818
     */
    public updateByQuery<Index extends OpensearchIndex<any, any, any, any, any>>(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        options: {
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            script: {
                lang: "painless";
                source: string;
                params?: JsonObjectValue;
            };
        },
    ): Promise<{versionConflictCount: number}> {
        return this._client.updateByQuery(
            this._context.tracer.getTracer(),
            index,
            routing,
            options,
        );
    }

    /**
     * Analyze some text using the [analysis API][1].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/analyze-apis/#apply-a-built-in-analyzer
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
