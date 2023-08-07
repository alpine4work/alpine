import {AppActionContext} from "~/server/dynamo/context/app_action_context.js";
import {waitForHttpServer} from "~/server/helpers/wait_for_http_server.js";
import {
    OpensearchIndex,
    OpensearchIndexConfig,
    omitOpensearchStaticIndexConfig,
    pickOpensearchStaticIndexConfig,
} from "~/server/opensearch/opensearch_index.js";
import {FailedPreconditionError, InternalError, UnknownError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {partitionArray} from "~/shared/helpers/iterable/partition_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export type OpensearchClientDocWithVersion<Doc> = Doc & {
    /**
     * The version of the document used for [optimistic concurrency
     * control][1].
     *
     * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
     */
    readonly version?: {
        readonly sequenceNumber: number;
        readonly primaryTerm: number;
    };
};

export type OpensearchClientBulkWriteOperation<DocId, Doc> = {
    readonly type: "IndexIfVersion";
    readonly id: DocId;
    readonly doc: OpensearchClientDocWithVersion<Doc>;
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
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    getDocIfExists<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        context: AppActionContext,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        id: DocId,
    ): Promise<OpensearchClientDocWithVersion<Doc> | null>;

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
        context: AppActionContext,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        operations: ReadonlyArray<OpensearchClientBulkWriteOperation<DocId, Doc>>,
        options?: OpensearchClientBulkWriteOptions,
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
    >(context: AppActionContext, index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>) {
        assert(process.env.NODE_ENV !== "production");

        return getOrSetDefaultMapValue(this._ensureLocalIndexPromiseByIndex, index, () => {
            return context.tracer.withSpan("Ensure local OpenSearch index", async context => {
                // We don't wait for OpenSearch to start before executing code in our dev
                // server and tests. That's because OpenSearch takes ~7s to start. That means
                // we need to wait for it here before we can use it.
                await waitForHttpServer(`${this._protocol}://${this._host}`);

                const getResponse = await fetchWithTracer(
                    context.tracer.getTracer(),
                    `${this._protocol}://${this._host}/${index.name}/_settings`,
                    {
                        spanRoute: `/${index.name}`,
                        method: "GET",
                    },
                );

                // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                // float-64 size in settings. Ok to use native JSON parser instead of
                // `json-bigint`.
                const getBody = await getResponse.json<
                    | {error: {type: string}}
                    | {
                          error: undefined;
                          [key: string]: OpensearchIndexConfig<string> | undefined;
                      }
                >();

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
                        context.tracer.getTracer(),
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
                            context.tracer.getTracer(),
                            `${this._protocol}://${this._host}/_cluster/state?filter_path=metadata.indices.${index.name}.routing_num_shards`,
                            {spanRoute: "/_cluster/state"},
                        );
                        const numberOfRoutingShards: number = assertExists(
                            // NOTE(#opensearch-important-json-disclaimer): No integers grow beyond
                            // float-64 size in settings. Ok to use native JSON parser instead of
                            // `json-bigint`.
                            (await getResponse2.json<any>()).metadata.indices[index.name]
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
                        context.tracer.getTracer(),
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
     * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/get-documents/
     */
    public async getDocIfExists<
        Routing extends string,
        DocId extends string,
        Doc extends {},
        FlattenedKeys extends string,
    >(
        context: AppActionContext,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        id: DocId,
    ): Promise<OpensearchClientDocWithVersion<Doc> | null> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(context, index);
        }

        const response = await fetchWithTracer(
            context.tracer.getTracer(),
            `${this._protocol}://${this._host}/${index.name}/_doc/${id}?routing=${routing}`,
            {spanRoute: `/${index.name}/_doc/:taskId`},
        );

        // NOTE(#opensearch-important-json-disclaimer): `long`s in `_source` are
        // serialized/deserialized by `OpensearchIndexLongType` which converts `long`s
        // to strings to maintain precision. Ok to use native JSON parser since `long`s
        // will be strings and we know how to handle those strings.
        const body = await response.json<
            {
                _seq_no: number;
                _primary_term: number;
            } & (
                | {found: false}
                | {
                      found: true;
                      _source: JsonValue;
                  }
            )
        >();

        if (!body.found) return null;

        const doc = index.type.deserialize(body._source);

        // Add the version number to the doc so we can perform updates.
        return Object.assign(doc, {
            version: {
                sequenceNumber: body._seq_no,
                primaryTerm: body._primary_term,
            },
        });
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
        context: AppActionContext,
        index: OpensearchIndex<Routing, DocId, Doc, FlattenedKeys>,
        routing: Routing,
        operations: ReadonlyArray<OpensearchClientBulkWriteOperation<DocId, Doc>>,
        {retryVersionConflictError}: OpensearchClientBulkWriteOptions,
    ): Promise<void> {
        if (process.env.NODE_ENV !== "production") {
            await this._ensureLocalIndex(context, index);
        }

        if (operations.length === 0) return;

        const bulkBody: Array<JsonValue> = [];

        for (const operation of operations) {
            if (operation.doc.version === undefined) {
                bulkBody.push({create: {_id: operation.id}});
                bulkBody.push(index.type.serialize(operation.doc));
            } else {
                bulkBody.push({
                    index: {
                        _id: operation.id,
                        if_seq_no: operation.doc.version.sequenceNumber,
                        if_primary_term: operation.doc.version.primaryTerm,
                    },
                });
                bulkBody.push(index.type.serialize(operation.doc));
            }
        }

        const response = await fetchWithTracer(
            context.tracer.getTracer(),
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
        const body = await response.json<{
            errors: boolean;
            items: Array<{
                create?: {error?: {type: string; reason: string}};
                index?: {error?: {type: string; reason: string}};
            }>;
        }>();

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
                } operation(s)${errors[0] ? `, first error: ${errors[0].type}` : ""}`,
            );

            throw error;
        }
    }
}
