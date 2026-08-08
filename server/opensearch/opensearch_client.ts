import fs from "fs/promises";
import createJsonBigInt from "json-bigint";
import jsonStableStringify from "json-stable-stringify";
import murmurhash from "murmurhash";
import {dirname, join as joinPath} from "path";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {OpensearchHighlightClause} from "~/server/opensearch/opensearch_highlight_clause.js";
import {
    OpensearchIndex,
    OpensearchIndexConfig,
    OpensearchIndexDocIdType,
    OpensearchIndexDocType,
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexRoutingType,
    OpensearchIndexStoredFieldsType,
    omitOpensearchStaticIndexConfig,
    pickOpensearchStaticIndexConfig,
} from "~/server/opensearch/opensearch_index.js";
import {OpensearchIndexAnalysisAnalyzer} from "~/server/opensearch/opensearch_index_analysis.js";
import {
    OpensearchQueryClause,
    getOpensearchQueryClauseDescription,
} from "~/server/opensearch/opensearch_query_clause.js";
import {OpensearchSortClause} from "~/server/opensearch/opensearch_sort_clause.js";
import {
    FailedPreconditionError,
    InternalError,
    UnavailableError,
    UnimplementedError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {partitionArray} from "~/shared/helpers/array/partition_array.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {
    runAllPromiseThunks,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {
    JsonObjectValue,
    JsonScalarValue,
    JsonValue,
} from "~/shared/helpers/types/json_value.open_source.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

const JsonBigInt = createJsonBigInt({useNativeBigInt: true});

// Useful for testing caching logic for OpenSearch. If the number of executed
// actions doesn't increase that means we're hitting a cache.
export const opensearchClientExecuteOperationTestCounter = new TestCounter<string>();

export type OpensearchClientDocWithId<DocId, Doc> = {
    readonly id: DocId;
} & Doc;

/**
 * The version of the document used for [optimistic concurrency control][1].
 *
 * [1]:
 *     https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
 */
export type OpensearchClientDocVersion = {
    readonly sequenceNumber: number;
    readonly primaryTerm: number;
};

export type OpensearchClientDocWithVersion<Doc> = Doc & {
    readonly version: OpensearchClientDocVersion | null;
};

export type OpensearchClientDocWithIdAndVersion<DocId, Doc> = OpensearchClientDocWithVersion<
    OpensearchClientDocWithId<DocId, Doc>
>;

export type OpensearchClientIndexDocIfVersionOptions = {
    retryVersionConflictError?: (error?: unknown) => never;
};

export type OpensearchClientBulkOperation<DocId, Doc> = {
    readonly type: "IndexIfVersion";
    readonly doc: OpensearchClientDocWithIdAndVersion<DocId, Doc>;
};

export type OpensearchClientBulkOptions = {
    retryPartialVersionConflictError?: (error?: unknown) => never;
};

/**
 * The interface implemented by an `OpensearchClient` which allows us to have other
 * interfaces.
 */
export interface OpensearchClientInterface {
    /**
     * Gets a document by the provided ID using the [get document API][1].
     *
     * We do not automatically batch calls to this function. To load multiple documents
     * with one API call see `multiGetDocsIfExist()`.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    getDocIfExists<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        options?: {realtime?: boolean},
    ): Promise<OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    > | null>;

    /**
     * Gets a document by the provided ID using the [get document API][1] but without
     * `_source` and with `stored_fields`.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    getDocWithoutSourceIfExists<
        Index extends OpensearchIndex<any, any, any, any, any>,
        StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
    >(
        tracer: TracerBase,
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
    } | null>;

    /**
     * Gets multiple documents in one network request using the [multi-get documents
     * API][1].
     *
     * Documents are returned in the order `DocId`s were provided in.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    multiGetDocsIfExist<
        const Commands extends ReadonlyArray<OpensearchMultiGetDocCommandBase<any, any>>,
    >(
        tracer: TracerBase,
        commands: Commands,
    ): Promise<{
        -readonly [K in keyof Commands]: OpensearchMultiGetDocCommandOutputType<Commands[K]> | null;
    }>;

    /**
     * Gets multiple documents in one network request using the [multi-get documents
     * API][1].
     *
     * This method is slightly more efficient than `multiGetDocsIfExist()` since
     * `multiGetDocsIfExist()` calls this method and turns the map into an array.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    multiGetDocByIdByIndexIfExist<Index extends OpensearchIndex<any, any, any, any, any>, Output>(
        tracer: TracerBase,
        commands: ReadonlyArray<OpensearchMultiGetDocCommandBase<Index, Output>>,
    ): Promise<Map<Index, Map<OpensearchIndexDocIdType<Index>, Output>>>;

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
    indexDocIfVersion<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        doc: OpensearchClientDocWithIdAndVersion<
            OpensearchIndexDocIdType<Index>,
            OpensearchIndexDocType<Index>
        >,
        options?: OpensearchClientIndexDocIfVersionOptions,
    ): Promise<void>;

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
    bulk<const Commands extends ReadonlyArray<OpensearchBulkCommandBase<any>>>(
        tracer: TracerBase,
        commands: Commands,
        options?: OpensearchClientBulkOptions,
    ): Promise<void>;

    /**
     * Lets you execute a search against an OpenSearch index with the [search API][1].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    search<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        options: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            afterCursor?: ReadonlyArray<JsonScalarValue | bigint>;
            highlight?: OpensearchHighlightClause<OpensearchIndexFlattenedKeysType<Index>>;
            explain?: boolean;
        },
    ): Promise<{
        hits: Array<
            OpensearchClientDocWithId<
                OpensearchIndexDocIdType<Index>,
                OpensearchIndexDocType<Index>
            > & {
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
                /**
                 * The list of query names that the result matched.
                 *
                 * When we query opensearch with filters, we create one query per filter.
                 * OpenSearch results can match multiple queries.
                 */
                readonly matchedQueries?: ReadonlyArray<string>;
            }
        >;
    }>;

    /**
     * Lets you execute a search against an OpenSearch index with the [search API][1]
     * without returning the OpenSearch docs, just there IDs.
     *
     * This can be much more efficient than a regular `search()` since looking up docs
     * in OpenSearch can be an expensive step once query results are determined.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    searchWithoutSource<
        Index extends OpensearchIndex<any, any, any, any, any>,
        StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
    >(
        tracer: TracerBase,
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
            /**
             * The list of query names that the result matched.
             *
             * When we query opensearch with filters, we create one query per filter.
             * OpenSearch results can match multiple queries.
             */
            readonly matchedQueries?: ReadonlyArray<string>;
        }>;
    }>;

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]:
     *     https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    refresh<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
    ): Promise<void>;

    /**
     * Analyze some text using the [analysis API][1].
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/analyze-apis/#apply-a-built-in-analyzer
     */
    analyze<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
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
    >;
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
// IMPORTANT //
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
//
// > TL;DR: Everywhere in this file where you serialize or parse JSON, you should
// > include a `// NOTE(#opensearch-important-json-disclaimer):` comment.
// >
// > For the reason why and what to put in that comment keep reading...
//
// OpenSearch returns `long` and `unsigned_long` values as JSON numbers. However,
// JavaScript's `JSON.parse()` coerces all JSON numbers to JavaScript numbers which
// are 64-bit floats. A 64-bit float can not safely hold a 64-bit unsigned or
// signed integer.
//
// For example, ElasticSearch may return the response:
//
// ```
// {
//   // ...
//   "hits": [
//     {
//       // ...
//       "sort": [
//         110849034631512066
//       ]
//     }
//   ]
// }
// ```
//
// Which JavaScript will parse as:
//
// ```
// {
//   // ...
//   "hits": [
//     {
//       // ...
//       "sort": [
//         110849034631512060
//       ]
//     }
//   ]
// }
// ```
//
// Since `110849034631512066` can't be represented as a 64-bit float.
//
// We store OpenSearch `long`s as strings in the document `_source`. If we're
// requesting `_source` OpenSearch will give us back the stringified value. So this
// is only a problem when OpenSearch sends the value it's parsed from `_source`
// internally. For example the `sort` field in the example above.
//
// We've installed the library `json-bigint` to get correct JSON parsing for big
// integers. However, since it's implemented in JavaScript it's slightly less
// efficient than native streaming implementations.
//
// Everywhere in this file where you serialize or parse JSON, you should include a
// `// NOTE(#opensearch-important-json-disclaimer):` comment explaining why your
// chose JSON stringify/parse methodology is safe. Or why you need to use
// `json-bigint`.

export type OpensearchMultiGetDocCommandOutputType<
    Command extends OpensearchMultiGetDocCommandBase<any, any>,
> = Command extends OpensearchMultiGetDocCommandBase<any, infer Output> ? Output : never;

/**
 * Description for a single document we fetch in a [multi-get documents
 * operation][1].
 *
 * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
 */
export abstract class OpensearchMultiGetDocCommandBase<
    Index extends OpensearchIndex<any, any, any, any, any>,
    Output,
> {
    public abstract readonly index: Index;
    public abstract readonly routing: OpensearchIndexRoutingType<Index>;
    public abstract readonly id: OpensearchIndexDocIdType<Index>;

    public abstract serialize(): {
        _source?: boolean;
        stored_fields?: ReadonlyArray<string>;
    };

    public abstract deserialize(rawDoc: {
        _id: string;
        _seq_no: number;
        _primary_term: number;
        _source?: JsonValue;
        fields?: {[key: string]: Array<JsonValue>};
    }): Output;
}

export class OpensearchGetDocCommand<
    Index extends OpensearchIndex<any, any, any, any, any>,
> extends OpensearchMultiGetDocCommandBase<
    Index,
    OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    >
> {
    public readonly index: Index;
    public readonly routing: OpensearchIndexRoutingType<Index>;
    public readonly id: OpensearchIndexDocIdType<Index>;

    constructor(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
    ) {
        super();
        this.index = index;
        this.routing = routing;
        this.id = id;
    }

    public serialize() {
        return {};
    }

    public deserialize(rawDoc: {
        _id: string;
        _seq_no: number;
        _primary_term: number;
        _source?: JsonValue;
        fields?: {[key: string]: Array<JsonValue>};
    }): OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    > {
        assert(rawDoc._source);

        const doc = this.index.type.deserialize(rawDoc._source);

        // Add the version number to the doc so we can perform updates.
        return Object.assign(doc, {
            id: rawDoc._id,
            version: {
                sequenceNumber: rawDoc._seq_no,
                primaryTerm: rawDoc._primary_term,
            },
        });
    }
}

export class OpensearchGetDocWithoutSourceCommand<
    Index extends OpensearchIndex<any, any, any, any, any>,
    const StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
> extends OpensearchMultiGetDocCommandBase<
    Index,
    {
        readonly id: OpensearchIndexDocIdType<Index>;
        readonly version: OpensearchClientDocVersion | null;
        readonly fields: {
            readonly [Key in StoredFieldKeys]?: ReadonlyArray<
                OpensearchIndexStoredFieldsType<Index>[Key]
            >;
        };
    }
> {
    public readonly index: Index;
    public readonly routing: OpensearchIndexRoutingType<Index>;
    public readonly id: OpensearchIndexDocIdType<Index>;
    public readonly storedFields: ReadonlyArray<StoredFieldKeys>;

    constructor(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        {storedFields = []}: {storedFields?: ReadonlyArray<StoredFieldKeys>} = {},
    ) {
        super();
        this.index = index;
        this.routing = routing;
        this.id = id;
        this.storedFields = storedFields;
    }

    public serialize() {
        return {
            _source: false,
            stored_fields: this.storedFields.length > 0 ? this.storedFields : undefined,
        };
    }

    public deserialize(rawDoc: {
        _id: string;
        _seq_no: number;
        _primary_term: number;
        _routing: string;
        _source?: JsonValue;
        fields?: {[key: string]: Array<JsonValue>};
    }): {
        readonly id: OpensearchIndexDocIdType<Index>;
        readonly routing: OpensearchIndexRoutingType<Index>;
        readonly version: OpensearchClientDocVersion | null;
        readonly fields: {
            readonly [Key in StoredFieldKeys]?: ReadonlyArray<
                OpensearchIndexStoredFieldsType<Index>[Key]
            >;
        };
    } {
        const fields: {[key: string]: Array<any>} = {};

        if (rawDoc.fields) {
            for (const [key, values] of Object.entries(rawDoc.fields)) {
                const storedFieldType = this.index.type.storedFields[key];
                if (!storedFieldType)
                    throw new InternalError(quote`Stored field type not found for ${key}`);

                fields[key] = values.map(value => storedFieldType.deserialize(value));
            }
        }

        return {
            id: rawDoc._id as any,
            routing: rawDoc._routing as any,
            version: {
                sequenceNumber: rawDoc._seq_no,
                primaryTerm: rawDoc._primary_term,
            },
            fields: fields as any,
        };
    }
}

/**
 * Description for a single write we make in a [bulk operation][1].
 *
 * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/bulk/
 */
export abstract class OpensearchBulkCommandBase<
    Index extends OpensearchIndex<any, any, any, any, any>,
> {
    public abstract readonly index: Index;
    public abstract readonly routing: OpensearchIndexRoutingType<Index>;
    public abstract readonly id: OpensearchIndexDocIdType<Index> | null;

    public abstract serialize(): {
        action: "index" | "create" | "update" | "delete";
        ifSequenceNumber?: number;
        ifPrimaryTerm?: number;
        body: JsonObjectValue | null;
    };
}

export class OpensearchIndexDocIfVersionCommand<
    Index extends OpensearchIndex<any, any, any, any, any>,
> extends OpensearchBulkCommandBase<Index> {
    public readonly index: Index;
    public readonly routing: OpensearchIndexRoutingType<Index>;
    public readonly id: OpensearchIndexDocIdType<Index>;
    public readonly doc: OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    >;

    constructor(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        doc: OpensearchClientDocWithIdAndVersion<
            OpensearchIndexDocIdType<Index>,
            OpensearchIndexDocType<Index>
        >,
    ) {
        super();
        this.index = index;
        this.routing = routing;
        this.id = doc.id;
        this.doc = doc;
    }

    public serialize() {
        return {
            action: !this.doc.version ? ("create" as const) : ("index" as const),
            ifSequenceNumber: this.doc.version?.sequenceNumber,
            ifPrimaryTerm: this.doc.version?.primaryTerm,
            body: this.index.type.serialize(this.doc),
        };
    }
}

export class OpensearchIndexDocWithoutIdCommand<
    Index extends OpensearchIndex<any, any, any, any, any>,
> extends OpensearchBulkCommandBase<Index> {
    public readonly index: Index;
    public readonly routing: OpensearchIndexRoutingType<Index>;
    public readonly id: null;
    public readonly doc: OpensearchIndexDocType<Index>;

    constructor(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        doc: OpensearchIndexDocType<Index>,
    ) {
        super();
        this.index = index;
        this.routing = routing;
        this.id = null;
        this.doc = doc;
    }

    public serialize() {
        return {
            action: "index" as const,
            body: this.index.type.serialize(this.doc),
        };
    }
}

export class OpensearchDeleteDocCommand<
    Index extends OpensearchIndex<any, any, any, any, any>,
> extends OpensearchBulkCommandBase<Index> {
    public readonly index: Index;
    public readonly routing: OpensearchIndexRoutingType<Index>;
    public readonly id: OpensearchIndexDocIdType<Index>;

    constructor(
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
    ) {
        super();
        this.index = index;
        this.routing = routing;
        this.id = id;
    }

    public serialize() {
        return {
            action: "delete" as const,
            body: null,
        };
    }
}

// NOTE(calebmer): We don't currently log `reason` from OpenSearch errors since
// sometimes we've seen it contain user data.
type OpensearchError = {
    readonly type: string;
    readonly reason: string;
    readonly root_cause?: Array<{readonly type: string; readonly reason: string}>;
    readonly caused_by?: {readonly type: string; readonly reason: string};
};

type OpensearchSearchHit = {
    _id: string;
    _score: number;
    _source?: JsonValue;
    fields?: {[key: string]: Array<JsonValue>};
    sort?: Array<JsonValue>;
    highlight?: {
        [key: string]: Array<string>;
    };
    inner_hits?: {
        [key: string]: {
            hits: {
                hits: Array<{
                    _nested: {offset: number};
                    _score: number;
                    _source?: JsonValue;
                    fields: {
                        [key: string]: Array<JsonValue>;
                    };
                }>;
            };
        };
    };
    _explanation?: OpensearchSearchHitExplanation;
    /**
     * A list of queries that the document matched. We can "name" queries by using the
     * `_name` parameter. We can assign unique `_name`s to each filter.
     *
     * > If you want to identify which of these clauses actually caused the matching
     * > results, name each query with the \_name parameter... `matched_queries` is an
     * > array that lists the queries that matched these results
     *
     * https://docs.opensearch.org/latest/query-dsl/compound/bool/
     */
    matched_queries?: Array<string>;
};

/**
 * Lightweight abstraction for making requests to OpenSearch. Implements the
 * following features:
 *
 * - Strong typing for API requests
 * - In development, makes sure indexes are created
 */
export class OpensearchClient implements OpensearchClientInterface {
    private readonly _url: URL;
    private readonly _signer: AwsRequestSigner;
    private readonly _ensureLocalCachePath: string | null;

    constructor({
        url,
        signer,
        ensureLocalCachePath,
    }: {
        url: string;
        signer: AwsRequestSigner;
        ensureLocalCachePath: string | null;
    }) {
        this._url = new URL(url);
        this._signer = signer;
        this._ensureLocalCachePath = ensureLocalCachePath;
    }

    private readonly _ensureLocalIndexPromiseByIndex = new Map<
        OpensearchIndex<any, any, any, any, any>,
        Promise<void>
    >();

    /**
     * Creates the OpenSearch index if it doesn't exist. This function is idempotent.
     * You may call it multiple times and it will produce the same response. Only
     * attempts to create the index once per process.
     *
     * Throws an error in production. Use `deployIndex()` in production.
     */
    public async ensureLocalIndex<
        Routing extends string,
        DocId extends string,
        Doc,
        FlattenedKeys extends string,
        StoredFields extends {[key: string]: unknown},
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys, StoredFields>,
    ) {
        assert(process.env.NODE_ENV !== "production");

        await getOrSetDefaultMapValue(this._ensureLocalIndexPromiseByIndex, index, async () => {
            await tracer.withSpan("Waiting for OpenSearch to start", async () => {
                assert(this._url.hostname === "localhost");

                // We don't wait for OpenSearch to start before executing code in our dev server
                // and tests. That's because OpenSearch takes ~7s to start. That means we need to
                // wait for it here before we can use it.
                const port = parseInt(this._url.port, 10);
                assert(Number.isInteger(port));
                await waitForHttpServer(port);

                // We need to wait for OpenSearch primary shards to be allocated before we can
                // check the status of indexes or create new indexes. Otherwise OpenSearch returns
                // weird partial health errors in integration tests.
                //
                // This [endpoint is not available in OpenSearch serverless][1] so we don't run it
                // in production.
                //
                // [1]:
                //     https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-genref.html#serverless-operations
                await fetchWithTracer(
                    tracer,
                    new URL("/_cluster/health?wait_for_status=yellow&timeout=60s", this._url),
                    {
                        sign: this._signer.sign,
                        serviceName: "OpenSearch",
                        route: "/_cluster/health",
                        method: "GET",
                    },
                    async response => {
                        // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                        // size in cluster health. Ok to use native JSON parser instead of `json-bigint`.
                        const body = await response.json();
                        if (!response.ok) {
                            throw new InternalError(
                                // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser so
                                // it's ok to stringify with native JSON parser.
                                `OpenSearch health check failed: ${JSON.stringify(body)}`,
                            );
                        }
                    },
                );
            });

            const ensureLocalCachePath = joinPath(
                assertExists(
                    this._ensureLocalCachePath,
                    "Must have `ensureLocalCachePath` when running OpenSearch locally",
                ),
                `${index.name}.txt`,
            );

            const ensureLocalCacheHash = murmurhash
                .v3(jsonStableStringify(index.config))
                .toString(16)
                .padStart(8, "0");

            // We've previously ensured this index! Don't do so again until
            // `ensureLocalCacheHash` updates.
            try {
                if (
                    (await fs.readFile(ensureLocalCachePath, "utf8")).trim() ===
                    ensureLocalCacheHash
                ) {
                    return;
                }
            } catch (error) {
                if (isObject(error) && error.code === "ENOENT") {
                    // If the file doesn't exist, that's ok ensure the table...
                } else {
                    throw error;
                }
            }

            await this._deployIndex(tracer, index, new AbortController().signal);

            await fs.mkdir(dirname(ensureLocalCachePath), {recursive: true});
            await fs.writeFile(ensureLocalCachePath, ensureLocalCacheHash);

            // After creating the index, wait for the index to have green status before
            // allowing any new requests.
            //
            // [ElasticSearch integration tests wait for newly-created indexes to be `green`
            // before proceeding][1]. We're following their example.
            //
            // [1]:
            //     https://discuss.elastic.co/t/no-shard-available-action-exception-in-integration-tests/262941/3
            await fetchWithTracer(
                tracer,
                new URL(
                    `/_cluster/health/${index.name}?wait_for_status=green&timeout=60s`,
                    this._url,
                ),
                {
                    sign: this._signer.sign,
                    serviceName: "OpenSearch",
                    route: `/_cluster/health/${index.name}`,
                    method: "GET",
                },
                async response => {
                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                    // size in cluster health. Ok to use native JSON parser instead of `json-bigint`.
                    const body = await response.json();
                    if (!response.ok) {
                        throw new InternalError(
                            // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser so
                            // it's ok to stringify with native JSON parser.
                            `OpenSearch health check failed: ${JSON.stringify(body)}`,
                        );
                    }
                },
            );
        });
    }

    /**
     * Creates the OpenSearch index if it doesn't exist and updates any dynamic
     * settings or mappings. This function is idempotent. You can call it multiple
     * times and it should produce the same response.
     *
     * May only be called in a production environment. Should only be called by our
     * deployment scripts.
     */
    public async deployIndex<
        Routing extends string,
        DocId extends string,
        Doc,
        FlattenedKeys extends string,
        StoredFields extends {[key: string]: unknown},
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys, StoredFields>,
        signal: AbortSignal,
    ) {
        assert(process.env.NODE_ENV === "production");

        return await this._deployIndex(tracer, index, signal);
    }

    /**
     * Deploys the OpenSearch index configuration and mapping. This function is
     * idempotent. You can call it multiple times and it should produce the same
     * response. We call it whenever the process restarts in development to make sure
     * the latest index updates are properly incorporated.
     *
     * We also call this function as part of our production deployment process. If
     * nothing in the index has changed this will be a noop (since this is idempotent).
     * Only dynamic index settings can be updated. Static index settings must stay the
     * same after the index has been created.
     */
    private async _deployIndex<
        Routing extends string,
        DocId extends string,
        Doc,
        FlattenedKeys extends string,
        StoredFields extends {[key: string]: unknown},
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys, StoredFields>,
        signal: AbortSignal,
    ) {
        return await tracer.withSpan("Deploy OpenSearch index", async tracer => {
            await retryWithExponentialBackoff(async retry => {
                const getBody = await fetchWithTracer(
                    tracer,
                    new URL(`/${index.name}/_settings`, this._url),
                    {
                        sign: this._signer.sign,
                        serviceName: "OpenSearch",
                        route: `/${index.name}`,
                        method: "GET",
                        signal,
                    },
                    async response => {
                        // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                        // size in settings. Ok to use native JSON parser instead of `json-bigint`.
                        const getBody:
                            | {error: {type: string}}
                            | {
                                  error: undefined;
                                  [key: string]: OpensearchIndexConfig<string> | undefined;
                              } = await response.json();

                        if (getBody.error && getBody.error?.type !== "index_not_found_exception") {
                            throw new InternalError(
                                // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser so
                                // it's ok to stringify with native JSON parser.
                                `Getting OpenSearch index failed: ${JSON.stringify(getBody)}`,
                            );
                        }

                        return getBody;
                    },
                );

                // If the index does not already exists then create a new one.
                if (getBody.error) {
                    try {
                        // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                        // size in settings. Ok to use native JSON stringifier instead of `json-bigint`.
                        const requestBody = JSON.stringify(index.config);

                        const requestHeaders: {[key: string]: string} = {
                            "content-type": "application/json",
                        };

                        await fetchWithTracer(
                            tracer,
                            new URL(`/${index.name}`, this._url),
                            {
                                sign: this._signer.sign,
                                serviceName: "OpenSearch",
                                route: `/${index.name}`,
                                method: "PUT",
                                headers: requestHeaders,
                                body: requestBody,
                                signal,
                            },
                            async response => {
                                // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                                // size in settings. Ok to use native JSON parser instead of `json-bigint`.
                                const body = await response.json();

                                if (!response.ok) {
                                    throw new InternalError(
                                        // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser so
                                        // it's ok to stringify with native JSON parser.
                                        `Creating OpenSearch index failed: ${JSON.stringify(body)}`,
                                        {cause: body.error},
                                    );
                                }
                            },
                        );
                    } catch (error) {
                        // We may have a concurrent process also trying to create the index. If we try to
                        // create the index and it fails, try reading the index again to see if it exists
                        // now.
                        if (
                            error instanceof Error &&
                            isObject(error.cause) &&
                            error.cause.type === "resource_already_exists_exception"
                        ) {
                            retry(error);
                        }

                        throw error;
                    }
                }
                // If the index does exist then check that the static configuration hasn't changed
                // and update the index's dynamic configuration.
                else {
                    const previousIndexConfig = assertExists(getBody[index.name]);

                    // If there are no custom filters/analyzers in our settings then set the empty
                    // object.
                    if (!previousIndexConfig.settings.analysis) {
                        (previousIndexConfig.settings as any).analysis = {
                            filter: {},
                            analyzer: {},
                        };
                    }

                    // We observe that when reading index settings, analysis properties are nested
                    // under `index`. But the documentation says we should create analyzers at the root
                    // level. Confusing!
                    if ((previousIndexConfig.settings.index as any).analysis) {
                        (previousIndexConfig.settings as any).analysis = (
                            previousIndexConfig.settings.index as any
                        ).analysis;
                        delete (previousIndexConfig.settings.index as any).analysis;
                    }

                    // `number_of_shards` and `routing_partition_size` are returned as strings. Treat
                    // them as integers.
                    (previousIndexConfig.settings as any).index.number_of_shards = JSON.parse(
                        (previousIndexConfig.settings as any).index.number_of_shards,
                    );
                    (previousIndexConfig.settings as any).index.routing_partition_size = JSON.parse(
                        (previousIndexConfig.settings as any).index.routing_partition_size,
                    );
                    if ("knn" in (previousIndexConfig.settings as any).index) {
                        (previousIndexConfig.settings as any).index.knn = JSON.parse(
                            (previousIndexConfig.settings as any).index.knn,
                        );
                    }

                    // These properties are converted into a `string`. Convert them back to booleans.
                    if (previousIndexConfig.settings.analysis?.filter) {
                        for (const filter of Object.values(
                            previousIndexConfig.settings.analysis.filter,
                        )) {
                            if ((filter as any).stem_english_possessive) {
                                (filter as any).stem_english_possessive = JSON.parse(
                                    (filter as any).stem_english_possessive,
                                );
                            }

                            if ((filter as any).output_unigrams) {
                                (filter as any).output_unigrams = JSON.parse(
                                    (filter as any).output_unigrams,
                                );
                            }

                            if ((filter as any).max_shingle_size) {
                                (filter as any).max_shingle_size = JSON.parse(
                                    (filter as any).max_shingle_size,
                                );
                            }

                            if ((filter as any).min_shingle_size) {
                                (filter as any).min_shingle_size = JSON.parse(
                                    (filter as any).min_shingle_size,
                                );
                            }
                        }
                    }

                    // Unfortunately, when we read settings ElasticSearch doesn't return
                    // `number_of_routing_shards`. We need to get it from a separate endpoint to make
                    // sure it hasn't changed. https://github.com/elastic/elasticsearch/issues/33036
                    {
                        const numberOfRoutingShards = await fetchWithTracer(
                            tracer,
                            new URL(
                                `/_cluster/state?filter_path=metadata.indices.${index.name}.routing_num_shards`,
                                this._url,
                            ),
                            {
                                sign: this._signer.sign,
                                serviceName: "OpenSearch",
                                route: "/_cluster/state",
                                signal,
                            },
                            async response => {
                                if (!response.ok) {
                                    throw new InternalError(
                                        `Getting OpenSearch cluster setting failed: ${JSON.stringify(
                                            await response.json(),
                                        )}`,
                                    );
                                }

                                const numberOfRoutingShards: number = assertExists(
                                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                                    // size in settings. Ok to use native JSON parser instead of `json-bigint`.
                                    (await response.json()).metadata.indices[index.name]
                                        .routing_num_shards,
                                );

                                return numberOfRoutingShards;
                            },
                        );

                        (previousIndexConfig.settings as any).index.number_of_routing_shards =
                            numberOfRoutingShards;
                    }

                    const previousIndexStaticConfig =
                        pickOpensearchStaticIndexConfig(previousIndexConfig);

                    const indexStaticConfig = pickOpensearchStaticIndexConfig(index.config);

                    if (
                        !isDeepEqual(
                            previousIndexStaticConfig,
                            // Feed through JSON stringify/parse so `undefined` properties are removed.
                            JSON.parse(JSON.stringify(indexStaticConfig)),
                        )
                    ) {
                        throw new InternalError(
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                            // size in settings. Ok to use native JSON stringifier instead of `json-bigint`.
                            `OpenSearch index static settings changed: ${JSON.stringify(
                                {old: previousIndexStaticConfig, new: indexStaticConfig},
                                null,
                                2,
                            )}`,
                        );
                    }

                    await runAllPromiseThunks(
                        async () => {
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                            // size in settings. Ok to use native JSON stringifier instead of `json-bigint`.
                            const requestBody = JSON.stringify(
                                omitOpensearchStaticIndexConfig(index.config).settings,
                            );

                            const requestHeaders: {[key: string]: string} = {
                                "content-type": "application/json",
                            };

                            await fetchWithTracer(
                                tracer,
                                new URL(`/${index.name}/_settings`, this._url),
                                {
                                    sign: this._signer.sign,
                                    serviceName: "OpenSearch",
                                    route: `/${index.name}/_settings`,
                                    method: "PUT",
                                    headers: requestHeaders,
                                    body: requestBody,
                                    signal,
                                },
                                async response => {
                                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                                    // size in settings. Ok to use native JSON parser instead of `json-bigint`.
                                    const body = await response.json();

                                    if (!response.ok) {
                                        throw new InternalError(
                                            // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser so
                                            // it's ok to stringify with native JSON parser.
                                            `Updating OpenSearch index failed: ${JSON.stringify(
                                                body,
                                            )}`,
                                        );
                                    }
                                },
                            );
                        },
                        async () => {
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                            // size in settings. Ok to use native JSON stringifier instead of `json-bigint`.
                            const requestBody = JSON.stringify(index.config.mappings);

                            const requestHeaders: {[key: string]: string} = {
                                "content-type": "application/json",
                            };

                            await fetchWithTracer(
                                tracer,
                                new URL(`/${index.name}/_mappings`, this._url),
                                {
                                    sign: this._signer.sign,
                                    serviceName: "OpenSearch",
                                    route: `/${index.name}/_mappings`,
                                    method: "PUT",
                                    headers: requestHeaders,
                                    body: requestBody,
                                    signal,
                                },
                                async response => {
                                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond float-64
                                    // size in settings. Ok to use native JSON parser instead of `json-bigint`.
                                    const body = await response.json();

                                    if (!response.ok) {
                                        throw new InternalError(
                                            // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser so
                                            // it's ok to stringify with native JSON parser.
                                            `Updating OpenSearch index failed: ${JSON.stringify(
                                                body,
                                            )}`,
                                        );
                                    }
                                },
                            );
                        },
                    );
                }
            });
        });
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
    public async getDocIfExists<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        {realtime = true}: {realtime?: boolean} = {},
    ): Promise<OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    > | null> {
        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await this.ensureLocalIndex(tracer, index);
        }

        const url = new URL(`/${index.name}/_doc/${encodeURIComponent(id)}`, this._url);
        url.searchParams.set("routing", routing);
        url.searchParams.set("realtime", String(realtime));

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest("/:index/_doc/:docId");
        }

        const body = await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: `/${index.name}/_doc/:docId`,
            },
            async (response, span) => {
                span.addData({
                    opensearch: {
                        routing,
                        get: {id},
                    },
                });

                // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
                // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s to
                // strings to maintain precision. Ok to use native JSON parser since `long`s will
                // be strings and we know how to handle those strings.
                const body:
                    | {error: OpensearchError}
                    | ({
                          error?: undefined;
                      } & (
                          | {
                                found: false;
                                _seq_no?: undefined;
                                _primary_term?: undefined;
                            }
                          | {
                                found: true;
                                _id: string;
                                _source: JsonValue;
                                _seq_no: number;
                                _primary_term: number;
                            }
                      )) = await response.json();

                if (body.error) {
                    throw new UnknownError(
                        `OpenSearch get document failed with ${formatOpensearchError(body.error)}`,
                        {cause: body.error},
                    );
                }

                span.addData({
                    opensearch: {
                        get: {
                            found: body.found,
                            seqNo: body._seq_no,
                            primaryTerm: body._primary_term,
                        },
                    },
                });

                return body;
            },
        );

        if (!body.found) return null;

        return new OpensearchGetDocCommand(index, routing, id).deserialize(body);
    }

    /**
     * Gets a document by the provided ID using the [get document API][1] but without
     * `_source` and with `stored_fields`.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    public async getDocWithoutSourceIfExists<
        Index extends OpensearchIndex<any, any, any, any, any>,
        StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
    >(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        {
            storedFields = [],
            realtime = true,
        }: {
            storedFields?: Array<StoredFieldKeys>;
            realtime?: boolean;
        } = {},
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
        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await this.ensureLocalIndex(tracer, index);
        }

        const url = new URL(`/${index.name}/_doc/${encodeURIComponent(id)}`, this._url);
        url.searchParams.set("routing", routing);
        url.searchParams.set("realtime", String(realtime));
        url.searchParams.set("_source", "false");

        if (storedFields.length > 0) {
            url.searchParams.set("stored_fields", storedFields.join(","));
        }

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest("/:index/_doc/:docId");
        }

        const body = await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: `/${index.name}/_doc/:docId`,
            },
            async (response, span) => {
                span.addData({
                    opensearch: {
                        routing,
                        get: {id},
                    },
                });

                // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
                // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s to
                // strings to maintain precision. Ok to use native JSON parser since `long`s will
                // be strings and we know how to handle those strings.
                const body:
                    | {error: OpensearchError}
                    | ({
                          error?: undefined;
                      } & (
                          | {
                                found: false;
                                _seq_no?: undefined;
                                _primary_term?: undefined;
                            }
                          | {
                                found: true;
                                _id: string;
                                _routing: string;
                                _seq_no: number;
                                _primary_term: number;
                                fields?: {[key: string]: Array<JsonValue>};
                            }
                      )) = await response.json();

                if (body.error) {
                    throw new UnknownError(
                        `OpenSearch get document failed with ${formatOpensearchError(body.error)}`,
                        {cause: body.error},
                    );
                }

                span.addData({
                    opensearch: {
                        get: {
                            found: body.found,
                            seqNo: body._seq_no,
                            primaryTerm: body._primary_term,
                        },
                    },
                });

                return body;
            },
        );

        if (!body.found) return null;

        return new OpensearchGetDocWithoutSourceCommand(index, routing, id, {
            storedFields,
        }).deserialize(body);
    }

    /**
     * Gets multiple documents in one network request using the [multi-get documents
     * API][1].
     *
     * Documents are returned in the order `DocId`s were provided in.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    public async multiGetDocsIfExist<
        const Commands extends ReadonlyArray<OpensearchMultiGetDocCommandBase<any, any>>,
    >(
        tracer: TracerBase,
        commands: Commands,
    ): Promise<{
        -readonly [K in keyof Commands]: OpensearchMultiGetDocCommandOutputType<Commands[K]> | null;
    }> {
        const docByIdByIndex = await this.multiGetDocByIdByIndexIfExist(tracer, commands);

        return commands.map(command => {
            const doc = docByIdByIndex.get(command.index)?.get(command.id);
            if (!doc) return null;
            return doc;
        }) as any;
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
        tracer: TracerBase,
        commands: ReadonlyArray<OpensearchMultiGetDocCommandBase<Index, Output>>,
    ): Promise<Map<Index, Map<OpensearchIndexDocIdType<Index>, Output>>> {
        // No commands, noop.
        if (commands.length === 0) return emptyMap as any;

        const indexByName = new Map<string, OpensearchIndex<any, any, any, any, any>>();
        const commandByIdByIndex = new Map<
            OpensearchIndex<any, any, any, any, any>,
            Map<OpensearchIndexDocIdType<any>, OpensearchMultiGetDocCommandBase<any, any>>
        >();
        const routings = new Set<string>();

        for (const command of commands) {
            const existingIndex = indexByName.get(command.index.name);
            assert(!existingIndex || existingIndex === command.index);
            indexByName.set(command.index.name, command.index);

            getOrSetDefaultMapValue(commandByIdByIndex, command.index, () => new Map()).set(
                command.id,
                command,
            );

            routings.add(command.routing);
        }

        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await runAllPromises(
                mapIterable(commandByIdByIndex.keys(), index =>
                    this.ensureLocalIndex(tracer, index),
                ),
            );
        }

        const singularIndex =
            commandByIdByIndex.size === 1 ? iterableFirst(commandByIdByIndex.keys())! : null;
        const singularRouting =
            singularIndex && routings.size === 1 ? iterableFirst(routings)! : null;

        const url = new URL(singularIndex ? `/${singularIndex.name}/_mget` : "/_mget", this._url);

        if (singularRouting) {
            url.searchParams.set("routing", singularRouting);
        }

        // NOTE(#opensearch-important-json-disclaimer): We only include IDs which are
        // strings and so JSON safe. Stringify is fine here.
        const requestBody = JSON.stringify({
            docs: commands.map(command => ({
                _index: !singularIndex ? command.index.name : undefined,
                routing: !singularRouting ? command.routing : undefined,
                _id: command.id,
                ...command.serialize(),
            })),
        });

        const requestHeaders: {[key: string]: string} = {
            "content-type": "application/json",
        };

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest(
                singularIndex ? "/:index/_mget" : "/_mget",
            );
        }

        const responseBody = await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: singularIndex ? `/${singularIndex.name}/_mget` : "/_mget",
                method: "POST",
                headers: requestHeaders,
                body: requestBody,
            },
            async (response, span) => {
                span.addData({
                    opensearch: {
                        routing: singularRouting ?? undefined,
                        mget: {
                            count: commands.length,
                            routings:
                                singularRouting !== null
                                    ? commands.map(command => command.routing).join(", ")
                                    : undefined,
                            ids: commands.map(command => command.id).join(", "),
                        },
                    },
                });

                // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
                // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s to
                // strings to maintain precision. Ok to use native JSON parser since `long`s will
                // be strings and we know how to handle those strings.
                const body:
                    | {error: OpensearchError}
                    | {
                          error?: undefined;
                          docs: Array<
                              {
                                  _index: string;
                                  _id: string;
                              } & (
                                  | {
                                        found?: false;
                                        _seq_no?: undefined;
                                        _primary_term?: undefined;
                                        error?: OpensearchError;
                                    }
                                  | {
                                        found: true;
                                        _seq_no: number;
                                        _primary_term: number;
                                        _source?: JsonValue;
                                        fields?: {[key: string]: Array<JsonValue>};
                                    }
                              )
                          >;
                      } = await response.json();

                if (body.error) {
                    throw new UnknownError(
                        `OpenSearch multi-get documents failed with ${formatOpensearchError(
                            body.error,
                        )}`,
                        {cause: body.error},
                    );
                }

                let foundCount = 0;
                const spanSeqNos: Array<number> = [];
                const spanPrimaryTerms: Array<number> = [];

                for (const bodyDoc of body.docs) {
                    if (!bodyDoc.found) {
                        if (bodyDoc.error) {
                            throw new UnknownError(
                                `OpenSearch multi-get documents failed with ${formatOpensearchError(
                                    bodyDoc.error,
                                )}`,
                                {cause: bodyDoc.error},
                            );
                        }
                        continue;
                    }

                    foundCount++;
                    spanSeqNos.push(bodyDoc._seq_no);
                    spanPrimaryTerms.push(bodyDoc._primary_term);
                }

                span.addData({
                    opensearch: {
                        mget: {
                            foundCount,
                            // TODO(calebmer): I don't think it's guaranteed that `body.docs` will be in the
                            // same order as the `ids` we passed in. Ideally we would make sure these arrays
                            // are in the same order as the input `ids`.
                            seqNos: spanSeqNos.join(", "),
                            primaryTerms: spanPrimaryTerms.join(", "),
                        },
                    },
                });

                return body;
            },
        );

        const docByIdByIndex = new Map<Index, Map<OpensearchIndexDocIdType<Index>, Output>>();

        for (const doc of responseBody.docs) {
            if (!doc.found) continue;

            const index = assertExists(indexByName.get(doc._index));
            const command = assertExists(commandByIdByIndex.get(index)?.get(doc._id));

            getOrSetDefaultMapValue(docByIdByIndex, index as Index, () => new Map()).set(
                doc._id as OpensearchIndexDocIdType<Index>,
                command.deserialize(doc),
            );
        }

        return docByIdByIndex;
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
    public async indexDocIfVersion<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        doc: OpensearchClientDocWithIdAndVersion<
            OpensearchIndexDocIdType<Index>,
            OpensearchIndexDocType<Index>
        >,
        {retryVersionConflictError}: OpensearchClientIndexDocIfVersionOptions = {},
    ): Promise<void> {
        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await this.ensureLocalIndex(tracer, index);
        }

        const url = !doc.version
            ? new URL(`/${index.name}/_create/${encodeURIComponent(doc.id)}`, this._url)
            : new URL(`/${index.name}/_doc/${encodeURIComponent(doc.id)}`, this._url);

        url.searchParams.set("routing", routing);

        if (doc.version) {
            url.searchParams.set("if_seq_no", doc.version.sequenceNumber);
            url.searchParams.set("if_primary_term", doc.version.primaryTerm);
        }

        // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
        // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s to
        // strings to maintain precision. Ok to use native JSON stringifier since `long`s
        // will be strings and we know how to handle those strings.
        const requestBody = JSON.stringify(index.type.serialize(doc));

        const requestHeaders: {[key: string]: string} = {
            "content-type": "application/json",
        };

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest(
                !doc.version ? "/:index/_create/:docId" : "/:index/_doc/:docId",
            );
        }

        await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: !doc.version
                    ? `/${index.name}/_create/:docId`
                    : `/${index.name}/_doc/:docId`,
                method: "PUT",
                headers: requestHeaders,
                body: requestBody,
            },
            async (response, span) => {
                span.addData({
                    opensearch: {
                        routing,
                        index: {
                            id: doc.id,
                            ifSeqNo: doc.version ? doc.version.sequenceNumber : undefined,
                            ifPrimaryTerm: doc.version ? doc.version.primaryTerm : undefined,
                        },
                    },
                });

                // NOTE(#opensearch-important-json-disclaimer): This response only contains errors
                // and the error numbers fit in 64-bit floats.
                const body:
                    | {_seq_no: number; _primary_term: number; error?: undefined}
                    | {error: OpensearchError} = await response.json();

                if (body.error) {
                    if (body.error.type === "version_conflict_engine_exception") {
                        const error = new FailedPreconditionError("OpenSearch version conflict");
                        retryVersionConflictError?.(error);
                        throw error;
                    }

                    throw new UnknownError(
                        `OpenSearch indexing failed with ${formatOpensearchError(body.error)}`,
                        {cause: body.error},
                    );
                }

                span.addData({
                    opensearch: {
                        index: {
                            seqNo: body._seq_no,
                            primaryTerm: body._primary_term,
                        },
                    },
                });

                return body;
            },
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
    public async bulk<const Commands extends ReadonlyArray<OpensearchBulkCommandBase<any>>>(
        tracer: TracerBase,
        commands: Commands,
        {retryPartialVersionConflictError}: OpensearchClientBulkOptions = {},
    ): Promise<void> {
        // No commands, noop.
        if (commands.length === 0) return;

        const indexes = new Set<OpensearchIndex<any, any, any, any, any>>();
        const routings = new Set<string>();
        for (const command of commands) {
            indexes.add(command.index);
            routings.add(command.routing);
        }

        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await runAllPromises(
                mapIterable(indexes, index => this.ensureLocalIndex(tracer, index)),
            );
        }

        const singularIndex = indexes.size === 1 ? Array.from(indexes)[0]! : null;
        const singularRouting =
            singularIndex && routings.size === 1 ? Array.from(routings)[0]! : null;

        const url = new URL(singularIndex ? `/${singularIndex.name}/_bulk` : "/_bulk", this._url);

        if (singularRouting) {
            url.searchParams.set("routing", singularRouting);
        }

        const bulkBody: Array<JsonValue> = [];
        const spanActions: Array<string> = [];
        const spanIfSeqNos: Array<number | null> = [];
        const spanIfPrimaryTerms: Array<number | null> = [];

        for (const command of commands) {
            const {action, ifSequenceNumber, ifPrimaryTerm, body} = command.serialize();

            bulkBody.push({
                [action]: {
                    _index: !singularIndex ? command.index.name : undefined,
                    routing: !singularRouting ? command.routing : undefined,
                    _id: command.id !== null ? command.id : undefined,
                    if_seq_no: ifSequenceNumber,
                    if_primary_term: ifPrimaryTerm,
                },
            });

            if (body !== null) {
                bulkBody.push(body);
            }

            spanActions.push(action);
            spanIfSeqNos.push(ifSequenceNumber ?? null);
            spanIfPrimaryTerms.push(ifPrimaryTerm ?? null);
        }

        // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
        // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s to
        // strings to maintain precision. Ok to use native JSON stringifier since `long`s
        // will be strings and we know how to handle those strings.
        const requestBody = bulkBody.map(object => `${JSON.stringify(object)}\n`).join("");

        const requestHeaders: {[key: string]: string} = {
            "content-type": "application/x-ndjson",
        };

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest(
                singularIndex ? "/:index/_bulk" : "/_bulk",
            );
        }

        const versionConflictError: FailedPreconditionError | null = await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: singularIndex ? `/${singularIndex.name}/_bulk` : "/_bulk",
                method: "POST",
                headers: requestHeaders,
                body: requestBody,
            },
            async (response, span) => {
                span.addData({
                    opensearch: {
                        routing: singularRouting ?? undefined,
                        bulk: {
                            count: bulkBody.length,
                            routings:
                                singularRouting === null
                                    ? commands.map(command => command.routing).join(", ")
                                    : undefined,
                            ids: commands.map(command => command.id).join(", "),
                            actions: spanActions.join(", "),
                            ifSeqNos: spanIfSeqNos.join(", "),
                            ifPrimaryTerms: spanIfPrimaryTerms.join(", "),
                        },
                    },
                });

                // NOTE(#opensearch-important-json-disclaimer): This response only contains errors
                // and the error numbers fit in 64-bit floats.
                const body:
                    | {error: OpensearchError}
                    | {
                          error?: undefined;
                          errors: boolean;
                          items: Array<{
                              create?: {
                                  error?: OpensearchError;
                                  _seq_no?: number;
                                  _primary_term?: number;
                              };
                              update?: {
                                  error?: OpensearchError;
                                  _seq_no?: number;
                                  _primary_term?: number;
                              };
                              delete?: {
                                  error?: OpensearchError;
                                  _seq_no?: number;
                                  _primary_term?: number;
                              };
                              index?: {
                                  error?: OpensearchError;
                                  _seq_no?: number;
                                  _primary_term?: number;
                              };
                          }>;
                      } = await response.json();

                if (body.error) {
                    throw new UnknownError(
                        `OpenSearch indexing failed with ${formatOpensearchError(body.error)}`,
                        {cause: body.error},
                    );
                }

                if (body.errors) {
                    const maybeRecoverableErrors = filterMapArray(
                        body.items,
                        item =>
                            item.create?.error ??
                            item.update?.error ??
                            item.delete?.error ??
                            item.index?.error,
                    );

                    const [versionConflictErrors, errors] = partitionArray(
                        maybeRecoverableErrors,
                        error => error.type === "version_conflict_engine_exception",
                    );

                    // If the only errors were version conflicts, allow the caller to retry the error.
                    // This implements [optimistic concurrency control][1].
                    //
                    // [1]:
                    //     https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
                    if (errors.length === 0 && versionConflictErrors.length > 0) {
                        return new FailedPreconditionError(
                            `OpenSearch bulk version conflicts in ${versionConflictErrors.length} operation(s) out of ${body.items.length} operation(s)`,
                        );
                    }

                    const error = new UnknownError(
                        `OpenSearch bulk partially failed with ${errors.length} error(s) out of ${
                            body.items.length
                        } operation(s)${
                            errors[0] ? `, first error is ${formatOpensearchError(errors[0])}` : ""
                        }`,
                    );

                    throw error;
                }

                const spanSeqNos: Array<number | null> = [];
                const spanPrimaryTerms: Array<number | null> = [];

                for (const item of body.items) {
                    const actualItem = item.create ?? item.update ?? item.delete ?? item.index;

                    spanSeqNos.push(actualItem?._seq_no ?? null);
                    spanPrimaryTerms.push(actualItem?._primary_term ?? null);
                }

                span.addData({
                    opensearch: {
                        bulk: {
                            // TODO(calebmer): I don't think it's guaranteed that `body.items` will be in the
                            // same order as the `commands` we passed in. Ideally we would make sure these
                            // arrays are in the same order as the input `commands`.
                            seqNos: spanSeqNos.join(", "),
                            primaryTerms: spanPrimaryTerms.join(", "),
                        },
                    },
                });

                return null;
            },
        );

        // If there's a version conflict error, don't report the retry exception in the
        // trace.
        if (versionConflictError) {
            retryPartialVersionConflictError?.(versionConflictError);
            throw versionConflictError;
        }
    }

    private async _search<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            size,
            query,
            sort = ["_score"],
            afterCursor,
            storedFields,
            highlight,
            explain = false,
            withoutSource = false,
        }: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            afterCursor?: ReadonlyArray<JsonScalarValue | bigint>;
            storedFields?: ReadonlyArray<string>;
            highlight?: OpensearchHighlightClause<OpensearchIndexFlattenedKeysType<Index>>;
            explain?: boolean;
            withoutSource?: boolean;
        },
    ): Promise<{hits: Array<OpensearchSearchHit>}> {
        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await this.ensureLocalIndex(tracer, index);
        }

        const url = new URL(`/${index.name}/_search`, this._url);
        url.searchParams.set("routing", routing);
        url.searchParams.set("size", String(size));

        // Important optimization. This means if we've satisfied the search's `size` limit
        // then we can immediately end the query and return instead of scanning the entire
        // index. [Works well with index sorting][1].
        //
        // This also enables optimizations for queries with common terms like "the" and
        // "and". Since a query with "the" might match millions of documents. See [this
        // deprecation message][2]. Also see [this blog post from 2013][3] which is
        // outdated since `cutoff_frequency` has been deprecated.
        //
        // [1]:
        //     https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html#early-terminate
        // [2]:
        //     https://github.com/opensearch-project/OpenSearch/blob/60b2265d9390f27f80803f16eb4d1c5cdc0f4947/server/src/main/java/org/opensearch/index/query/MatchQueryBuilder.java#L61-L62
        // [3]:
        //     https://www.elastic.co/blog/stop-stopping-stop-words-a-look-at-common-terms-query
        url.searchParams.set("track_total_hits", "false");

        // Don't return partial results in case of error or timeout.
        url.searchParams.set("allow_partial_search_results", "false");

        // If a `TaskRealtimeService` search request takes a long time then it may leave
        // the action history visibility window. Bounding the time a search may take means
        // we leave the rest of the visibility window (9.5min when the visibility window is
        // 10min) for indexing actions.
        url.searchParams.set("timeout", "30s");
        url.searchParams.set("cancel_after_time_interval", "30s");

        if (storedFields && storedFields.length > 0) {
            url.searchParams.set("stored_fields", storedFields.join(","));
        }

        if (explain) {
            url.searchParams.set("explain", "true");
        }

        // NOTE(#opensearch-important-json-disclaimer): `searchAfter` may contain bigints
        // we want to stringify as JSON integer literals so we need to use `json-bigint`.
        const requestBody = JsonBigInt.stringify({
            query,
            sort,
            search_after: afterCursor,
            _source: !withoutSource,
            highlight,
        });

        const requestHeaders: {[key: string]: string} = {
            "content-type": "application/json",
        };

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest("/:index/_search");
        }

        const body = await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: `/${index.name}/_search`,
                method: "POST",
                headers: requestHeaders,
                body: requestBody,
            },
            async (response, span) => {
                span.addData({
                    opensearch: {
                        routing,
                        query: getOpensearchQueryClauseDescription(query),
                        sort: JSON.stringify(sort),
                    },
                });

                // NOTE(#opensearch-important-json-disclaimer): We only use `_source` which is
                // deserialized with our index object type. `_source`s correctly serialize big
                // integers for JavaScript (they're stringified).
                //
                // However, `sort` values are a problem here! OpenSearch returns sort values in its
                // internal format. So a `long` will be a JSON number and that JSON number may be
                // too big to represent in a JavaScript 64-bit float so we'll get an imprecise
                // value.
                //
                // If we ignore `sort` values we'll be fine. Keep in mind that you can't use `sort`
                // values unless you parse with `json-bigint`.
                const body:
                    | {
                          hits: {hits: Array<OpensearchSearchHit>};
                          error?: undefined;
                      }
                    | {error: OpensearchError; hits?: undefined} = await response.json();

                if (body.error) {
                    throw new UnknownError(
                        `OpenSearch search failed with ${formatOpensearchError(body.error)}`,
                        {cause: body.error},
                    );
                }

                span.addData({opensearch: {search: {hitCount: body.hits.hits.length}}});

                return body;
            },
        );

        return {
            hits: body.hits.hits,
        };
    }

    /**
     * Lets you execute a search against an OpenSearch index with the [search API][1].
     *
     * Returned documents do not include the document version (`sequenceNumber` and
     * `primaryTerm`). This is not returned by default from the OpenSearch search API.
     * It may be expensive to fetch the version because search is operating on
     * potentially stale data until the next refresh.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    public async search<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            size,
            query,
            sort,
            afterCursor,
            withCursor,
            highlight,
            explain,
        }: {
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
        const {hits} = await this._search(tracer, index, routing, {
            size,
            query,
            sort,
            afterCursor,
            highlight,
            explain,
        });

        const actualHits = hits.map(hit => {
            const doc = Object.assign(index.type.deserialize(hit._source), {
                id: hit._id,
            });

            if (withCursor && hit.sort) {
                doc.cursor = hit.sort;
            }

            if (hit.highlight) {
                doc.highlight = hit.highlight;
            }

            if (hit.inner_hits) {
                doc.innerHits = mapObjectValues(hit.inner_hits, innerHits =>
                    innerHits.hits.hits.map(innerHit => {
                        if (innerHit._source) {
                            throw new UnimplementedError(
                                "`_source` not implemented for inner hits",
                            );
                        }

                        const fields: {[key: string]: Array<any>} = {};

                        for (const [key, values] of Object.entries(innerHit.fields ?? {})) {
                            const storedFieldType = index.type.storedFields[key];
                            if (!storedFieldType)
                                throw new InternalError(
                                    quote`Stored field type not found for ${key}`,
                                );

                            fields[key] = values.map(value => storedFieldType.deserialize(value));
                        }

                        return {
                            offset: innerHit._nested.offset,
                            fields: fields as any,
                        };
                    }),
                );
            }

            if (hit._explanation) {
                doc.explanation = hit._explanation;
            }

            if (hit.matched_queries) {
                doc.matchedQueries = hit.matched_queries;
            }

            return doc;
        });

        return {hits: actualHits};
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
    public async searchWithoutSource<
        Index extends OpensearchIndex<any, any, any, any, any>,
        StoredFieldKeys extends keyof OpensearchIndexStoredFieldsType<Index> & string,
    >(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            size,
            query,
            sort,
            afterCursor,
            storedFields,
            highlight,
            explain,
        }: {
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
        const {hits} = await this._search(tracer, index, routing, {
            size,
            query,
            sort,
            afterCursor,
            highlight,
            storedFields,
            explain,
            withoutSource: true,
        });

        const actualHits = hits.map(hit => {
            assert(!hit._source);

            const fields: {[key: string]: Array<any>} = {};

            if (hit.fields) {
                for (const [key, values] of Object.entries(hit.fields)) {
                    const storedFieldType = index.type.storedFields[key];
                    if (!storedFieldType)
                        throw new InternalError(quote`Stored field type not found for ${key}`);

                    fields[key] = values.map(value => storedFieldType.deserialize(value));
                }
            }

            const actualHit: any = {
                id: hit._id as OpensearchIndexDocIdType<Index>,
                score: hit._score,
                fields: fields as any,
            };

            if (hit.sort) {
                actualHit.cursor = hit.sort;
            }

            if (hit.highlight) {
                actualHit.highlight = hit.highlight;
            }

            if (hit.inner_hits) {
                actualHit.innerHits = mapObjectValues(hit.inner_hits, innerHits =>
                    innerHits.hits.hits.map(innerHit => {
                        if (innerHit._source) {
                            throw new UnimplementedError(
                                "`_source` not implemented for inner hits",
                            );
                        }

                        const innerFields: {[key: string]: Array<any>} = {};

                        for (const [key, values] of Object.entries(innerHit.fields ?? {})) {
                            const storedFieldType = index.type.storedFields[key];
                            if (!storedFieldType)
                                throw new InternalError(
                                    quote`Stored field type not found for ${key}`,
                                );

                            innerFields[key] = values.map(value =>
                                storedFieldType.deserialize(value),
                            );
                        }

                        return {
                            offset: innerHit._nested.offset,
                            fields: innerFields as any,
                        };
                    }),
                );
            }

            if (hit._explanation) {
                actualHit.explanation = hit._explanation;
            }

            if (hit.matched_queries) {
                actualHit.matchedQueries = hit.matched_queries;
            }

            return actualHit;
        });

        return {hits: actualHits};
    }

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]:
     *     https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    public async refresh<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
    ): Promise<void> {
        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await this.ensureLocalIndex(tracer, index);
        }

        const url = new URL(`/${index.name}/_refresh`, this._url);

        const requestBody = "";

        const requestHeaders: {[key: string]: string} = {};

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest("/:index/_refresh");
        }

        await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: `/${index.name}/_refresh`,
                method: "POST",
                headers: requestHeaders,
                body: requestBody,
            },
            async response => {
                await response.json();

                if (!response.ok) {
                    throw new InternalError("OpenSearch refresh failed");
                }
            },
        );
    }

    /**
     * Analyze some text using the [analysis API][1].
     *
     * [1]:
     *     https://opensearch.org/docs/latest/api-reference/analyze-apis/#apply-a-built-in-analyzer
     */
    public async analyze<Index extends OpensearchIndex<any, any, any, any, any>>(
        tracer: TracerBase,
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
        if (process.env.NODE_ENV !== "production" && this._url.hostname === "localhost") {
            await this.ensureLocalIndex(tracer, index);
        }

        const url = new URL(`/${index.name}/_analyze`, this._url);

        // NOTE(#opensearch-important-json-disclaimer): No numbers in this body.
        const requestBody = JSON.stringify({
            analyzer: typeof analyzer === "string" ? analyzer : analyzer.name,
            text,
        });

        const requestHeaders: {[key: string]: string} = {
            "content-type": "application/json",
        };

        if (import.meta.jest) {
            opensearchClientExecuteOperationTestCounter.incrementForTest("/:index/_analyze");
        }

        return await fetchWithTracer(
            tracer,
            url,
            {
                sign: this._signer.sign,
                serviceName: "OpenSearch",
                route: `/${index.name}/_analyze`,
                method: "POST",
                headers: requestHeaders,
                body: requestBody,
            },
            async response => {
                // NOTE(#opensearch-important-json-disclaimer): All numbers in this response should
                // safely fit into JavaScript float-64 numbers so we don't need to use bigint
                // parsing.
                const body:
                    | {error: OpensearchError}
                    | {
                          error?: undefined;
                          tokens: Array<{
                              token: string;
                              start_offset: number;
                              end_offset: number;
                              type: string;
                              position: number;
                          }>;
                      } = await response.json();

                if (body.error) {
                    throw new UnknownError(
                        `OpenSearch analyze failed with ${formatOpensearchError(body.error)}`,
                    );
                }

                return body.tokens.map(token => ({
                    token: token.token,
                    startOffset: token.start_offset,
                    endOffset: token.end_offset,
                    type: token.type,
                    position: token.position,
                }));
            },
        );
    }
}

/**
 * If we have a test with OpenSearch disabled, we use this client which throws
 * whenever you try to access anything from OpenSearch.
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

    public getDocWithoutSourceIfExists(): never {
        throw this._newUnavailableError();
    }

    public multiGetDocsIfExist(): never {
        throw this._newUnavailableError();
    }

    public multiGetDocByIdByIndexIfExist(): never {
        throw this._newUnavailableError();
    }

    public indexDocIfVersion(): never {
        throw this._newUnavailableError();
    }

    public bulk(): never {
        throw this._newUnavailableError();
    }

    public search(): never {
        throw this._newUnavailableError();
    }

    public searchWithoutSource(): never {
        throw this._newUnavailableError();
    }

    public refresh(): never {
        throw this._newUnavailableError();
    }

    public analyze(): never {
        throw this._newUnavailableError();
    }
}

function formatOpensearchError(error: OpensearchError): string {
    // TODO(calebmer, #security): It actually may be dangerous for us to include
    // `error.reason` in the error message. If OpenSearch includes customer data in
    // `error.reason` then we shouldn't include it in error messages since error
    // messages are visible to anyone with access to our logs. This would be a security
    // leak of since any engineer could see customer data!
    let string = `${error.type}: ${error.reason}`;

    if (error.caused_by) string += `. Caused by ${formatOpensearchError(error.caused_by)}`;

    if (error.root_cause?.[0])
        string += `. Root cause ${formatOpensearchError(error.root_cause[0])}`;

    return string;
}
