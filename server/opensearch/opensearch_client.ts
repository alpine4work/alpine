import createJsonBigInt from "json-bigint";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {
    OpensearchIndex,
    OpensearchIndexConfig,
    OpensearchIndexDocIdType,
    OpensearchIndexDocType,
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexRoutingType,
    omitOpensearchStaticIndexConfig,
    pickOpensearchStaticIndexConfig,
} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchQueryClause,
    getOpensearchQueryClauseDescription,
} from "~/server/opensearch/opensearch_query_clause.js";
import {OpensearchSortClause} from "~/server/opensearch/opensearch_sort_clause.js";
import {
    DeadlineExceededError,
    FailedPreconditionError,
    InternalError,
    UnknownError,
} from "~/shared/error/error.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {partitionArray} from "~/shared/helpers/iterable/partition_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {JsonObjectValue, JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
import {fetchWithTracer, fetchWithTracerAndReturnSpan} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

const JsonBigInt = createJsonBigInt({useNativeBigInt: true});

export type OpensearchClientDocWithId<DocId, Doc> = {
    readonly id: DocId;
} & Doc;

export type OpensearchClientDocWithVersion<Doc> = Doc & {
    /**
     * The version of the document used for [optimistic concurrency
     * control][1].
     *
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
     */
    readonly version: {
        readonly sequenceNumber: number;
        readonly primaryTerm: number;
    } | null;
};

export type OpensearchClientDocWithIdAndVersion<DocId, Doc> = OpensearchClientDocWithVersion<
    OpensearchClientDocWithId<DocId, Doc>
>;

export type OpensearchClientBulkWriteOperation<DocId, Doc> = {
    readonly type: "IndexIfVersion";
    readonly doc: OpensearchClientDocWithIdAndVersion<DocId, Doc>;
};

export type OpensearchClientBulkWriteOptions = {
    retryVersionConflictError?: (error?: unknown) => never;
};

/**
 * The interface implemented by an `OpensearchClient` which allows us to have
 * other interfaces.
 */
export interface OpensearchClientInterface {
    /**
     * Gets a document by the provided ID using the [get document API][1].
     *
     * We do not automatically batch calls to this function. To load multiple
     * documents with one API call see `multiGetDocsIfExist()`.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    getDocIfExists<Index extends OpensearchIndex<any, any, any, any>>(
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
     * Gets multiple documents in one network request using the [multi-get
     * documents API][1].
     *
     * Documents are returned in the order `DocId`s were provided in.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    multiGetDocsIfExist<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        ids: ReadonlyArray<OpensearchIndexDocIdType<Index>>,
    ): Promise<
        Array<OpensearchClientDocWithIdAndVersion<
            OpensearchIndexDocIdType<Index>,
            OpensearchIndexDocType<Index>
        > | null>
    >;

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
    bulkWrite<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        operations: ReadonlyArray<
            OpensearchClientBulkWriteOperation<
                OpensearchIndexDocIdType<Index>,
                OpensearchIndexDocType<Index>
            >
        >,
        options?: OpensearchClientBulkWriteOptions,
    ): Promise<void>;

    /**
     * Lets you execute a search against an OpenSearch index with the [search
     * API][1].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    search<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        options: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
        },
    ): Promise<
        Array<OpensearchIndexDocType<Index> & {readonly id: OpensearchIndexDocIdType<Index>}>
    >;

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
    searchWithoutReturningDocs<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        options: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
        },
    ): Promise<
        Array<{
            score: number;
            id: OpensearchIndexDocIdType<Index>;
        }>
    >;

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    refresh<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
    ): Promise<void>;

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
    updateByQuery<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
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
    ): Promise<{versionConflictCount: number}>;
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
//                                 IMPORTANT                                 //
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
//
// > TL;DR: Everywhere in this file where you serialize or parse JSON, you
// > should include a `// NOTE(#opensearch-important-json-disclaimer):`
// > comment.
// >
// > For the reason why and what to put in that comment keep reading...
//
// OpenSearch returns `long` and `unsigned_long` values as JSON numbers.
// However, JavaScript's `JSON.parse()` coerces all JSON numbers to JavaScript
// numbers which are 64-bit floats. A 64-bit float can not safely hold a 64-bit
// unsigned or signed integer.
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
// requesting `_source` OpenSearch will give us back the stringified value. So
// this is only a problem when OpenSearch sends the value it's parsed from
// `_source` internally. For example the `sort` field in the example above.
//
// We've installed the library `json-bigint` to get correct JSON parsing for
// big integers. However, since it's implemented in JavaScript it's slightly
// less efficient than native streaming implementations.
//
// Everywhere in this file where you serialize or parse JSON, you should
// include a `// NOTE(#opensearch-important-json-disclaimer):` comment
// explaining why your chose JSON stringify/parse methodology is safe. Or why
// you need to use `json-bigint`.

// NOTE(calebmer): We don't currently log `reason` from OpenSearch errors since
// sometimes we've seen it contain user data.
type OpensearchError = {
    readonly type: string;
    readonly root_cause?: Array<{readonly type: string}>;
};

/**
 * Lightweight abstraction for making requests to OpenSearch. Implements the
 * following features:
 *
 * - Strong typing for API requests
 * - In development, makes sure indexes are created
 */
export class OpensearchClient implements OpensearchClientInterface {
    private readonly _protocol: string;
    private readonly _hostname: string;
    private readonly _port: number;
    private readonly _host: string;

    constructor({protocol, hostname, port}: {protocol: string; hostname: string; port: number}) {
        this._protocol = protocol;
        this._hostname = hostname;
        this._port = port;
        this._host = `${hostname}:${port}`;
    }

    private readonly _ensureLocalIndexPromiseByIndex = new Map<
        OpensearchIndex<any, any, any, any>,
        Promise<void>
    >();

    /**
     * Makes sure the local index is ready and configured with the right
     * parameters. Should only be called in development and test environments.
     */
    private _ensureLocalIndex<
        Routing extends string,
        DocId extends string,
        Doc,
        FlattenedKeys extends string,
    >(tracer: TracerBase, index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>) {
        assert(process.env.NODE_ENV !== "production");

        return getOrSetDefaultMapValue(this._ensureLocalIndexPromiseByIndex, index, () => {
            return tracer.withSpan("Ensure local OpenSearch index", async tracer => {
                // We don't wait for OpenSearch to start before executing code in our dev
                // server and tests. That's because OpenSearch takes ~7s to start. That means
                // we need to wait for it here before we can use it.
                if (this._hostname === "localhost") {
                    await waitForHttpServer(this._port);
                }

                // We need to wait for OpenSearch primary shards to be allocated before we can
                // check the status of indexes or create new indexes. Otherwise OpenSearch
                // returns weird partial health errors.
                const healthResponse = await fetchWithTracer(
                    tracer,
                    `${this._protocol}://${this._host}/_cluster/health?wait_for_status=yellow&timeout=60s`,
                    {
                        spanRoute: "/_cluster/health",
                        method: "GET",
                    },
                );

                // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                // float-64 size in cluster health. Ok to use native JSON parser instead of
                // `json-bigint`.
                const healthBody = await healthResponse.json();
                if (!healthResponse.ok) {
                    throw new InternalError(
                        // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser
                        // so it's ok to stringify with native JSON parser.
                        `OpenSearch health check failed: ${JSON.stringify(healthBody)}`,
                    );
                }

                const getResponse = await fetchWithTracer(
                    tracer,
                    `${this._protocol}://${this._host}/${index.name}/_settings`,
                    {
                        spanRoute: `/${index.name}`,
                        method: "GET",
                    },
                );

                // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                // float-64 size in settings. Ok to use native JSON parser instead of
                // `json-bigint`.
                const getBody:
                    | {error: {type: string}}
                    | {
                          error: undefined;
                          [key: string]: OpensearchIndexConfig<string> | undefined;
                      } = await getResponse.json();

                // If the index does not already exists then create a new one.
                if (getBody.error) {
                    if (getBody.error.type !== "index_not_found_exception") {
                        throw new InternalError(
                            // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser
                            // so it's ok to stringify with native JSON parser.
                            `Getting OpenSearch index failed: ${JSON.stringify(getBody)}`,
                        );
                    }

                    const putResponse = await fetchWithTracer(
                        tracer,
                        `${this._protocol}://${this._host}/${index.name}`,
                        {
                            spanRoute: `/${index.name}`,
                            method: "PUT",
                            headers: {"content-type": "application/json"},
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                            // float-64 size in settings. Ok to use native JSON stringifier instead of
                            // `json-bigint`.
                            body: JSON.stringify(index.config),
                        },
                    );

                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                    // float-64 size in settings. Ok to use native JSON parser instead of
                    // `json-bigint`.
                    const putBody = await putResponse.json();

                    if (!putResponse.ok) {
                        throw new InternalError(
                            // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser
                            // so it's ok to stringify with native JSON parser.
                            `Creating OpenSearch index failed: ${JSON.stringify(putBody)}`,
                        );
                    }
                }
                // If the index does exist then check that the static configuration hasn't
                // changed and update the index's dynamic configuration.
                else {
                    const previousIndexConfig = assertExists(getBody[index.name]);

                    // If there are no custom filters/analyzers in our settings then set the
                    // empty object.
                    if (!previousIndexConfig.settings.analysis) {
                        (previousIndexConfig.settings as any).analysis = {
                            filter: {},
                            analyzer: {},
                        };
                    }

                    // We observe that when reading index settings, analysis properties are nested
                    // under `index`. But the documentation says we should create analyzers at the
                    // root level. Confusing!
                    if ((previousIndexConfig.settings.index as any).analysis) {
                        (previousIndexConfig.settings as any).analysis = (
                            previousIndexConfig.settings.index as any
                        ).analysis;
                        delete (previousIndexConfig.settings.index as any).analysis;
                    }

                    // `number_of_shards` and `routing_partition_size` are returned as strings.
                    // Treat them as integers.
                    (previousIndexConfig.settings as any).index.number_of_shards = parseInt(
                        (previousIndexConfig.settings as any).index.number_of_shards,
                        10,
                    );
                    (previousIndexConfig.settings as any).index.routing_partition_size = parseInt(
                        (previousIndexConfig.settings as any).index.routing_partition_size,
                        10,
                    );

                    // The `stem_english_possessive` property is converted into a `string`. Convert
                    // it back to a boolean.
                    if (previousIndexConfig.settings.analysis?.filter) {
                        for (const filter of Object.values(
                            previousIndexConfig.settings.analysis.filter,
                        )) {
                            if ((filter as any).stem_english_possessive) {
                                (filter as any).stem_english_possessive = JSON.parse(
                                    (filter as any).stem_english_possessive,
                                );
                            }
                        }
                    }

                    // Unfortunately, when we read settings ElasticSearch doesn't return
                    // `number_of_routing_shards`. We need to get it from a separate endpoint to
                    // make sure it hasn't changed.
                    // https://github.com/elastic/elasticsearch/issues/33036
                    {
                        const getResponse2 = await fetchWithTracer(
                            tracer,
                            `${this._protocol}://${this._host}/_cluster/state?filter_path=metadata.indices.${index.name}.routing_num_shards`,
                            {spanRoute: "/_cluster/state"},
                        );
                        const numberOfRoutingShards: number = assertExists(
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                            // float-64 size in settings. Ok to use native JSON parser instead of
                            // `json-bigint`.
                            (await getResponse2.json()).metadata.indices[index.name]
                                .routing_num_shards,
                        );

                        (previousIndexConfig.settings as any).index.number_of_routing_shards =
                            numberOfRoutingShards;
                    }

                    const previousIndexStaticConfig =
                        pickOpensearchStaticIndexConfig(previousIndexConfig);

                    const indexStaticConfig = pickOpensearchStaticIndexConfig(index.config);

                    if (!isDeepEqual(previousIndexStaticConfig, indexStaticConfig)) {
                        throw new InternalError(
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                            // float-64 size in settings. Ok to use native JSON stringifier instead of
                            // `json-bigint`.
                            `OpenSearch index static settings changed: ${JSON.stringify(
                                {old: previousIndexStaticConfig, new: indexStaticConfig},
                                null,
                                2,
                            )}`,
                        );
                    }

                    await runAllPromiseThunks(
                        async () => {
                            const putResponse = await fetchWithTracer(
                                tracer,
                                `${this._protocol}://${this._host}/${index.name}/_settings`,
                                {
                                    spanRoute: `/${index.name}/_settings`,
                                    method: "PUT",
                                    headers: {"content-type": "application/json"},
                                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                                    // float-64 size in settings. Ok to use native JSON stringifier instead of
                                    // `json-bigint`.
                                    body: JSON.stringify(
                                        omitOpensearchStaticIndexConfig(index.config).settings,
                                    ),
                                },
                            );

                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                            // float-64 size in settings. Ok to use native JSON parser instead of
                            // `json-bigint`.
                            const putBody = await putResponse.json();

                            if (!putResponse.ok) {
                                throw new InternalError(
                                    // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser
                                    // so it's ok to stringify with native JSON parser.
                                    `Updating OpenSearch index failed: ${JSON.stringify(putBody)}`,
                                );
                            }
                        },
                        async () => {
                            const putResponse = await fetchWithTracer(
                                tracer,
                                `${this._protocol}://${this._host}/${index.name}/_mappings`,
                                {
                                    spanRoute: `/${index.name}/_mappings`,
                                    method: "PUT",
                                    headers: {"content-type": "application/json"},
                                    // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                                    // float-64 size in settings. Ok to use native JSON stringifier instead of
                                    // `json-bigint`.
                                    body: JSON.stringify(index.config.mappings),
                                },
                            );

                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                            // float-64 size in settings. Ok to use native JSON parser instead of
                            // `json-bigint`.
                            const putBody = await putResponse.json();

                            if (!putResponse.ok) {
                                throw new InternalError(
                                    // NOTE(#opensearch-important-json-disclaimer): Parsed by native JSON parser
                                    // so it's ok to stringify with native JSON parser.
                                    `Updating OpenSearch index failed: ${JSON.stringify(putBody)}`,
                                );
                            }
                        },
                    );
                }
            });
        });
    }

    /**
     * Gets a document by the provided ID using the [get document API][1].
     *
     * We do not automatically batch calls to this function. To load multiple
     * documents with one API call see `multiGetDocsIfExist()`.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    public async getDocIfExists<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        id: OpensearchIndexDocIdType<Index>,
        {realtime = true}: {realtime?: boolean} = {},
    ): Promise<OpensearchClientDocWithIdAndVersion<
        OpensearchIndexDocIdType<Index>,
        OpensearchIndexDocType<Index>
    > | null> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const response = await fetchWithTracer(
            tracer,
            `${this._protocol}://${this._host}/${index.name}/_doc/${id}?routing=${routing}&realtime=${realtime}`,
            {spanRoute: `/${index.name}/_doc/:taskId`},
        );

        // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
        // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s
        // to strings to maintain precision. Ok to use native JSON parser since `long`s
        // will be strings and we know how to handle those strings.
        const body: {
            _seq_no: number;
            _primary_term: number;
        } & (
            | {found: false}
            | {
                  found: true;
                  _id: string;
                  _source: JsonValue;
              }
        ) = await response.json();

        if (!body.found) return null;

        const doc = index.type.deserialize(body._source);

        // Add the version number to the doc so we can perform updates.
        return Object.assign(doc, {
            id: body._id,
            version: {
                sequenceNumber: body._seq_no,
                primaryTerm: body._primary_term,
            },
        });
    }

    /**
     * Gets multiple documents in one network request using the [multi-get
     * documents API][1].
     *
     * Documents are returned in the order `DocId`s were provided in.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    public async multiGetDocsIfExist<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        ids: ReadonlyArray<OpensearchIndexDocIdType<Index>>,
    ): Promise<
        Array<OpensearchClientDocWithIdAndVersion<
            OpensearchIndexDocIdType<Index>,
            OpensearchIndexDocType<Index>
        > | null>
    > {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const response = await fetchWithTracer(
            tracer,
            `${this._protocol}://${this._host}/${index.name}/_mget?routing=${routing}`,
            {
                spanRoute: `/${index.name}/_mget`,
                method: "POST",
                headers: {"content-type": "application/json"},
                // NOTE(#opensearch-important-json-disclaimer): We only include IDs which are
                // strings and so JSON safe. Stringify is fine here.
                body: JSON.stringify({
                    docs: ids.map(id => ({_id: id})),
                }),
            },
        );

        // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
        // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s
        // to strings to maintain precision. Ok to use native JSON parser since `long`s
        // will be strings and we know how to handle those strings.
        const body: {
            docs: Array<
                {
                    _id: string;
                    _seq_no: number;
                    _primary_term: number;
                } & (
                    | {found: false}
                    | {
                          found: true;
                          _source: JsonValue;
                      }
                )
            >;
        } = await response.json();

        const docById = new Map<
            string,
            OpensearchClientDocWithIdAndVersion<
                OpensearchIndexDocIdType<Index>,
                OpensearchIndexDocType<Index>
            >
        >();

        for (const bodyDoc of body.docs) {
            if (!bodyDoc.found) continue;
            const doc = index.type.deserialize(bodyDoc._source);

            // Add the version number to the doc so we can perform updates.
            docById.set(
                bodyDoc._id,
                Object.assign(doc, {
                    id: bodyDoc._id,
                    version: {
                        sequenceNumber: bodyDoc._seq_no,
                        primaryTerm: bodyDoc._primary_term,
                    },
                }),
            );
        }

        return ids.map(id => docById.get(id) ?? null);
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
    public async bulkWrite<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        operations: ReadonlyArray<
            OpensearchClientBulkWriteOperation<
                OpensearchIndexDocIdType<Index>,
                OpensearchIndexDocType<Index>
            >
        >,
        {retryVersionConflictError}: OpensearchClientBulkWriteOptions = {},
    ): Promise<void> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        if (operations.length === 0) return;

        const bulkBody: Array<JsonValue> = [];

        for (const operation of operations) {
            if (!operation.doc.version) {
                bulkBody.push({create: {_id: operation.doc.id}});
                bulkBody.push(index.type.serialize(operation.doc));
            } else {
                bulkBody.push({
                    index: {
                        _id: operation.doc.id,
                        if_seq_no: operation.doc.version.sequenceNumber,
                        if_primary_term: operation.doc.version.primaryTerm,
                    },
                });
                bulkBody.push(index.type.serialize(operation.doc));
            }
        }

        const response = await fetchWithTracer(
            tracer,
            `${this._protocol}://${this._host}/${index.name}/_bulk?routing=${routing}`,
            {
                spanRoute: `/${index.name}/_bulk`,
                method: "POST",
                headers: {"content-type": "application/x-ndjson"},
                // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
                // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s
                // to strings to maintain precision. Ok to use native JSON stringifier since
                // `long`s will be strings and we know how to handle those strings.
                body: bulkBody.map(object => `${JSON.stringify(object)}\n`).join(""),
            },
        );

        // NOTE(#opensearch-important-json-disclaimer): This response only contains
        // errors and the error numbers fit in 64-bit floats.
        const body: {
            errors: boolean;
            items: Array<{
                create?: {error?: OpensearchError};
                index?: {error?: OpensearchError};
            }>;
        } = await response.json();

        if (body.errors) {
            const maybeRecoverableErrors = filterMapArray(
                body.items,
                item => item.create?.error ?? item.index?.error ?? null,
            );

            const [versionConflictErrors, errors] = partitionArray(
                maybeRecoverableErrors,
                error => error.type === "version_conflict_engine_exception",
            );

            // If the only errors were version conflicts, allow the caller to retry the
            // error. This implements [optimistic concurrency control][1].
            //
            // [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
            if (errors.length === 0 && versionConflictErrors.length > 0) {
                const error = new FailedPreconditionError(
                    `OpenSearch bulk write version conflicts in ${versionConflictErrors.length} operation(s) out of ${body.items.length} operation(s)`,
                );
                retryVersionConflictError?.(error);
                throw error;
            }

            const error = new UnknownError(
                `OpenSearch bulk write partially failed with ${errors.length} error(s) out of ${
                    body.items.length
                } operation(s)${
                    errors[0]
                        ? `, first error: "${errors[0].root_cause?.[0]?.type ?? errors[0].type}"`
                        : ""
                }`,
            );

            throw error;
        }
    }

    private async _search<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            size,
            query,
            sort = ["_score"],
            searchAfter,
            withoutDocs = false,
        }: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
            withoutDocs?: boolean;
        },
    ): Promise<Array<{_id: string; _score: number; _source?: JsonValue}>> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const url = new URL(`${this._protocol}://${this._host}/${index.name}/_search`);
        url.searchParams.set("routing", routing);
        url.searchParams.set("size", String(size));

        // Important optimization. This means if we've satisfied the search's `size`
        // limit then we can immediately end the query and return instead of scanning
        // the entire index. [Works well with index sorting][1].
        //
        // [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html#early-terminate
        url.searchParams.set("track_total_hits", "false");

        // Don't return partial results in case of error or timeout.
        url.searchParams.set("allow_partial_search_results", "false");

        // If a `TaskRealtimeService` search request takes a long time then it may
        // leave the action history visibility window. Bounding the time a search may
        // take means we leave the rest of the visibility window (9.5min when the
        // visibility window is 10min) for indexing actions.
        url.searchParams.set("timeout", "30s");
        url.searchParams.set("cancel_after_time_interval", "30s");

        const {span, responsePromise} = fetchWithTracerAndReturnSpan(tracer, url, {
            spanRoute: `/${index.name}/_search`,
            method: "POST",
            headers: {"content-type": "application/json"},
            // NOTE(#opensearch-important-json-disclaimer): `searchAfter` may contain
            // bigints we want to stringify as JSON integer literals so we need to use
            // `json-bigint`.
            body: JsonBigInt.stringify({
                query,
                sort,
                search_after: searchAfter,
                _source: !withoutDocs,
            }),
        });

        span.addData({
            opensearch: {
                query: getOpensearchQueryClauseDescription(query),
                sort: JSON.stringify(sort),
            },
        });

        const response = await responsePromise;

        // NOTE(#opensearch-important-json-disclaimer): We only use `_source` which is
        // deserialized with our index object type. `_source`s correctly serialize big
        // integers for JavaScript (they're stringified).
        //
        // However, `sort` values are a problem here! OpenSearch returns sort values in
        // its internal format. So a `long` will be a JSON number and that JSON number
        // may be too big to represent in a JavaScript 64-bit float so we'll get an
        // imprecise value.
        //
        // If we ignore `sort` values we'll be fine. Keep in mind that you can't use
        // `sort` values unless you parse with `json-bigint`.
        const body:
            | {
                  hits: {hits: Array<{_id: string; _score: number; _source?: JsonValue}>};
                  error?: undefined;
              }
            | {error: OpensearchError; hits?: undefined} = await response.json();

        if (body.error) {
            const errorType = body.error.root_cause?.[0]?.type ?? body.error.type;
            throw new UnknownError(`OpenSearch search failed: ${errorType}`);
        }

        return body.hits.hits;
    }

    /**
     * Lets you execute a search against an OpenSearch index with the [search
     * API][1].
     *
     * Returned documents do not include the document version (`sequenceNumber` and
     * `primaryTerm`). This is not returned by default from the OpenSearch search
     * API. It may be expensive to fetch the version because search is operating on
     * potentially stale data until the next refresh.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    public async search<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            size,
            query,
            sort,
            searchAfter,
        }: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
        },
    ): Promise<
        Array<OpensearchIndexDocType<Index> & {readonly id: OpensearchIndexDocIdType<Index>}>
    > {
        const hits = await this._search(tracer, index, routing, {
            size,
            query,
            sort,
            searchAfter,
        });

        const docs = hits.map(hit =>
            Object.assign(index.type.deserialize(hit._source!), {
                id: hit._id,
            }),
        );

        return docs;
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
    public async searchWithoutReturningDocs<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            size,
            query,
            sort,
            searchAfter,
        }: {
            size: number;
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            sort?: OpensearchSortClause<OpensearchIndexFlattenedKeysType<Index>>;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
        },
    ): Promise<
        Array<{
            score: number;
            id: OpensearchIndexDocIdType<Index>;
        }>
    > {
        const hits = await this._search(tracer, index, routing, {
            size,
            query,
            sort,
            searchAfter,
            withoutDocs: true,
        });

        const docIds = hits.map(hit => {
            assert(!hit._source);
            return {
                id: hit._id as OpensearchIndexDocIdType<Index>,
                score: hit._score,
            };
        });

        return docIds;
    }

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    public async refresh<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
    ): Promise<void> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const response = await fetchWithTracer(
            tracer,
            `${this._protocol}://${this._host}/${index.name}/_refresh`,
            {spanRoute: `/${index.name}/_refresh`, method: "POST"},
        );

        if (!response.ok) {
            throw new InternalError("OpenSearch refresh failed");
        }
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
    public async updateByQuery<Index extends OpensearchIndex<any, any, any, any>>(
        tracer: TracerBase,
        index: Index,
        routing: OpensearchIndexRoutingType<Index>,
        {
            query,
            script,
        }: {
            query: OpensearchQueryClause<OpensearchIndexFlattenedKeysType<Index>>;
            script: {
                lang: "painless";
                source: string;
                params?: JsonObjectValue;
            };
        },
    ): Promise<{versionConflictCount: number}> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const url = new URL(`${this._protocol}://${this._host}/${index.name}/_update_by_query`);
        url.searchParams.set("routing", routing);

        // If there's a version conflict, proceed with the update. We'll have the
        // `versionConflictCount` return number to tell us if we had any version
        // conflicts.
        //
        // It's [recommended by the ElasticSearch][1] team to perform your query
        // updates with `conflicts=proceed` on then retry against documents which
        // didn't update if there were conflicts.
        //
        // [1]: https://github.com/elastic/elasticsearch/issues/22723#issuecomment-274156818
        url.searchParams.set("conflicts", "proceed");

        // Bound how long this update may take. `TaskRealtimeService` expects actions
        // to be indexed promptly (currently it's history window is configured to 10min
        // but we need to index in less time to account for refresh interval, search
        // time, and other factors). If it's taking too long we reject the update and
        // should debug what's going on.
        url.searchParams.set("timeout", "1m");

        const {span, responsePromise} = fetchWithTracerAndReturnSpan(tracer, url, {
            spanRoute: `/${index.name}/_update_by_query`,
            method: "POST",
            headers: {"content-type": "application/json"},
            // NOTE(#opensearch-important-json-disclaimer): `long`s in `query` must be
            // stringified since the query clause type only supports JSON values. `script`
            // also is typed as a JSON safe value.
            body: JSON.stringify({query, script}),
        });

        span.addData({
            opensearch: {
                query: getOpensearchQueryClauseDescription(query),
            },
        });

        const response = await responsePromise;

        // NOTE(#opensearch-important-json-disclaimer): All numbers in this response
        // should safely fit into JavaScript float-64 numbers so we don't need to use
        // bigint parsing.
        const body:
            | {
                  timed_out: boolean;
                  version_conflicts: number;
                  failures: Array<unknown>;
                  error?: undefined;
              }
            | {error: OpensearchError} = await response.json();

        if (body.error) {
            const errorType = body.error.root_cause?.[0]?.type ?? body.error.type;
            throw new UnknownError(`OpenSearch update by query failed: ${errorType}`);
        }

        if (body.failures.length > 0) {
            throw new UnknownError(
                `OpenSearch update by query failed with ${body.failures.length} failure(s)`,
            );
        }

        if (body.timed_out) {
            throw new DeadlineExceededError("OpenSearch update by query timed out");
        }

        return {versionConflictCount: body.version_conflicts};
    }
}
