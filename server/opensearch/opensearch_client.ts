import createJsonBigInt from "json-bigint";
import {waitForHttpServer} from "~/server/helpers/wait_for_http_server.js";
import {
    OpensearchIndex,
    OpensearchIndexConfig,
    omitOpensearchStaticIndexConfig,
    pickOpensearchStaticIndexConfig,
} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchQueryClause,
    getOpensearchQueryClauseDescription,
} from "~/server/opensearch/opensearch_query_clause.js";
import {OpensearchSortClause} from "~/server/opensearch/opensearch_sort_clause.js";
import {FailedPreconditionError, InternalError, UnknownError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {partitionArray} from "~/shared/helpers/iterable/partition_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
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
    getDocIfExists<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        id: DocId,
    ): Promise<OpensearchClientDocWithIdAndVersion<DocId, Doc> | null>;

    /**
     * Gets multiple documents in one network request using the [multi-get
     * documents API][1].
     *
     * Documents are returned in the order `DocId`s were provided in.
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/multi-get/
     */
    multiGetDocsIfExist<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        ids: ReadonlyArray<DocId>,
    ): Promise<Array<OpensearchClientDocWithIdAndVersion<DocId, Doc> | null>>;

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
    bulkWrite<Routing extends string, DocId extends string, Doc, FlattenedKeys extends string>(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        operations: ReadonlyArray<OpensearchClientBulkWriteOperation<DocId, Doc>>,
        options?: OpensearchClientBulkWriteOptions,
    ): Promise<void>;

    /**
     * Lets you execute a search against an OpenSearch index with the [search
     * API][1].
     *
     * [1]: https://opensearch.org/docs/latest/api-reference/search/
     */
    search<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        options: {
            query: OpensearchQueryClause<FlattenedKeys>;
            sort: OpensearchSortClause<FlattenedKeys>;
            size: number;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
        },
    ): Promise<Array<Doc & {readonly id: DocId}>>;

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    refresh<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
    ): Promise<void>;
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
    private readonly _host: string;

    constructor({protocol, host}: {protocol: string; host: string}) {
        this._protocol = protocol;
        this._host = host;
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
                await waitForHttpServer(`${this._protocol}://${this._host}`);

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
                            body: JSON.stringify(omitOpensearchStaticIndexConfig(index.config)),
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
    public async getDocIfExists<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        id: DocId,
    ): Promise<OpensearchClientDocWithIdAndVersion<DocId, Doc> | null> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const response = await fetchWithTracer(
            tracer,
            `${this._protocol}://${this._host}/${index.name}/_doc/${id}?routing=${routing}`,
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
            id: body._id as DocId,
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
    public async multiGetDocsIfExist<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        ids: ReadonlyArray<DocId>,
    ): Promise<Array<OpensearchClientDocWithIdAndVersion<DocId, Doc> | null>> {
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

        const docById = new Map<string, OpensearchClientDocWithIdAndVersion<DocId, Doc>>();

        for (const bodyDoc of body.docs) {
            if (!bodyDoc.found) continue;
            const doc = index.type.deserialize(bodyDoc._source);

            // Add the version number to the doc so we can perform updates.
            docById.set(
                bodyDoc._id,
                Object.assign(doc, {
                    id: bodyDoc._id as DocId,
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
    public async bulkWrite<
        Routing extends string,
        DocId extends string,
        Doc,
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        operations: ReadonlyArray<OpensearchClientBulkWriteOperation<DocId, Doc>>,
        {retryVersionConflictError}: OpensearchClientBulkWriteOptions,
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
    public async search<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        tracer: TracerBase,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        {
            query,
            sort,
            size,
            searchAfter,
        }: {
            query: OpensearchQueryClause<FlattenedKeys>;
            sort: OpensearchSortClause<FlattenedKeys>;
            size: number;
            searchAfter?: ReadonlyArray<JsonScalarValue | bigint>;
        },
    ): Promise<Array<OpensearchClientDocWithId<DocId, Doc>>> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(tracer, index);
        }

        const searchUrl = new URL(`${this._protocol}://${this._host}/${index.name}/_search`);
        searchUrl.searchParams.set("routing", routing);
        searchUrl.searchParams.set("size", String(size));

        // Important optimization. This means if we've satisfied the search's `size`
        // limit then we can immediately end the query and return instead of scanning
        // the entire index. [Works well with index sorting][1].
        //
        // [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html#early-terminate
        searchUrl.searchParams.set("track_total_hits", "false");

        // Don't return partial results in case of error or timeout.
        searchUrl.searchParams.set("allow_partial_search_results", "false");

        // If a `TaskRealtimeService` search request takes a long time then it may
        // leave the action history visibility window. Bounding the time a search may
        // take means we leave the rest of the visibility window (4.5min when the
        // visibility window is 5min) for indexing actions.
        searchUrl.searchParams.set("timeout", "30s");
        searchUrl.searchParams.set("cancel_after_time_interval", "30s");

        const {span, responsePromise} = fetchWithTracerAndReturnSpan(tracer, searchUrl, {
            spanRoute: `/${index.name}/_search`,
            method: "POST",
            headers: {"content-type": "application/json"},
            // NOTE(#opensearch-important-json-disclaimer): `searchAfter` may contain
            // bigints we want to stringify as JSON integer literals so we need to use
            // `json-bigint`.
            body: JsonBigInt.stringify({query, sort, search_after: searchAfter}),
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
            | {hits: {hits: Array<{_id: string; _source: JsonValue}>}; error?: undefined}
            | {error: OpensearchError; hits?: undefined} = await response.json();

        if (body.error) {
            const errorType = body.error.root_cause?.[0]?.type ?? body.error.type;
            throw new UnknownError(`OpenSearch search failed: ${errorType}`);
        }

        const docs = body.hits.hits.map(hit =>
            Object.assign(index.type.deserialize(hit._source), {
                id: hit._id as DocId,
            }),
        );

        return docs;
    }

    /**
     * Manually refresh an OpenSearch index using the [refresh API][1].
     *
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html
     */
    public async refresh<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(tracer: TracerBase, index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>) {
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
}
