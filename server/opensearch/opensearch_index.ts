import {
    OpensearchIndexAnalysisCustomAnalyzer,
    OpensearchIndexAnalysisCustomFilter,
} from "~/server/opensearch/opensearch_index_analysis.js";
import {OpensearchIndexObjectType} from "~/server/opensearch/opensearch_index_type.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {JsonObjectValue, JsonValue} from "~/shared/helpers/types/json_value.js";

export type OpensearchIndexConfig<FlattenedKeys extends string> = {
    readonly settings: {
        readonly index: {
            readonly number_of_shards: number;
            readonly number_of_routing_shards: number;
            readonly sort: {
                readonly field: ReadonlyArray<FlattenedKeys>;
                readonly order: ReadonlyArray<"asc" | "desc">;
                readonly missing: ReadonlyArray<"_last" | "_first">;
            };
            readonly refresh_interval: string;
            readonly number_of_replicas: number;
            readonly routing_partition_size: number;
            readonly codec: string;
            // Provided by a plugin. Documentation here:
            // https://opensearch.org/docs/latest/search-plugins/knn/knn-index/#index-settings
            readonly knn: boolean | undefined;
        };
        readonly analysis: {
            readonly filter: JsonObjectValue;
            readonly analyzer: JsonObjectValue;
        };
    };
    readonly mappings: JsonObjectValue;
};

const opensearchIndexStaticSettingsKeys = filterMapArray(
    getObjectEntriesWithKeyofType(
        cast<{
            [K in keyof OpensearchIndexConfig<string>["settings"]["index"]]: boolean;
        }>({
            number_of_shards: true,
            number_of_routing_shards: true,
            sort: true,
            codec: true,
            routing_partition_size: true,
            refresh_interval: false,
            number_of_replicas: false,
            knn: true,
        }),
    ),
    ([key, isStatic]) => (isStatic ? key : undefined),
);

/**
 * Take an OpenSearch index config and extract just the static properties out
 * of it.
 */
export function pickOpensearchStaticIndexConfig(config: OpensearchIndexConfig<string>) {
    return {
        settings: {
            index: pickObject(config.settings.index, opensearchIndexStaticSettingsKeys),
            analysis: config.settings.analysis,
        },
    };
}

/**
 * Take an OpenSearch index config and remove the static properties from it.
 */
export function omitOpensearchStaticIndexConfig(config: OpensearchIndexConfig<string>) {
    return {
        ...config,
        settings: {
            ...omitObject(config.settings, ["index", "analysis"]),
            index: omitObject(config.settings.index, opensearchIndexStaticSettingsKeys),
        },
    };
}

export type OpensearchIndexRoutingType<Index extends OpensearchIndex<any, any, any, any, any>> =
    Index extends OpensearchIndex<infer Routing, any, any, any, any> ? Routing : never;

export type OpensearchIndexDocIdType<Index extends OpensearchIndex<any, any, any, any, any>> =
    Index extends OpensearchIndex<any, infer DocId, any, any, any> ? DocId : never;

export type OpensearchIndexDocType<Index extends OpensearchIndex<any, any, any, any, any>> =
    Index extends OpensearchIndex<any, any, infer Doc, any, any> ? Doc : never;

export type OpensearchIndexFlattenedKeysType<
    Index extends OpensearchIndex<any, any, any, any, any>,
> = Index extends OpensearchIndex<any, any, any, infer FlattenedKeys, any> ? FlattenedKeys : never;

export type OpensearchIndexStoredFieldsType<
    Index extends OpensearchIndex<any, any, any, any, any>,
> = Index extends OpensearchIndex<any, any, any, any, infer StoredFields> ? StoredFields : never;

export type OpensearchIndexConfigBuilder = {
    enableKnn(): void;
    addCustomAnalyzer(analyzer: OpensearchIndexAnalysisCustomAnalyzer): void;
    addCustomFilter(filter: OpensearchIndexAnalysisCustomFilter): void;
};

export class OpensearchIndex<
    Routing extends string,
    DocId extends string,
    Doc,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> {
    public readonly type: OpensearchIndexObjectType<Doc, FlattenedKeys, StoredFields>;
    public readonly name: string;
    public readonly config: OpensearchIndexConfig<FlattenedKeys>;

    // These properties do nothing but make sure the associated generic parameters
    // are used.
    private readonly _routing?: Routing;
    private readonly _docId?: DocId;

    constructor(
        type: OpensearchIndexObjectType<Doc, FlattenedKeys, StoredFields>,
        {
            name,
            numberOfShards,
            numberOfRoutingShards,
            sort,
            refreshInterval,
            disableSourceField = false,
        }: {
            name: string;

            /**
             * The number of physical shards for this index in our cluster. Each shard
             * comes with some overhead. It's recommended to have at least one shard per
             * data node and to avoid over-sharding your cluster.
             *
             * Data nodes are the actual servers that run ElasticSearch. Each data node may
             * have multiple primary shards and/or replica shards. You may add and remove
             * data nodes at will. For optimal performance, data nodes should be a factor
             * of `numberOfShards`. For example, if you have 6 shards then you should have
             * only 1, 2, or 3 data nodes. If you have 4 data nodes then the 6 shards will
             * not be evenly distributed across the data nodes.
             *
             * `numberOfRoutingShards` influences how we can scale `numberOfShards` up.
             * `numberOfRoutingShards` is the logical number of shards, not the physical
             * number of shards. You can scale your index to a multiple of `numberOfShards`
             * and a factor of `numberOfRoutingShards` using the [split index API][1]. For
             * example, if `numberOfShards` is 5 and `numberOfRoutingShards` is 30 then you
             * could perform the following splits:
             *
             * - 5 → 10 (split by 2)
             * - 5 → 15 (split by 3)
             * - 5 → 30 (split by 6)
             *
             * 10, 15, and 30 are multiples of 5 and factors of 30 which make them a valid
             * `numberOfShards` value to set in a split.
             *
             * So when picking values here, it's important you pick a `numberOfShards`
             * value that's not too large and a `numberOfRoutingShards` value with many
             * factors that will let you scale `numberOfShards` in the future.
             *
             * Read AWS's “[choosing the number of shards][2]” article for recommendations
             * on picking a shard count.
             *
             * I (@calebmer) picked the following values to start for the task index:
             *
             * - `numberOfRoutingShards`: 2^5 * 3^3 * 5 (4,320). This lets us scale
             *   `numberOfShards` by 2 three times, by 3 two times, and by five once. We
             *   can't scale by 2 five times and by 3 three times since we start at 12
             *   (2^2 * 3).
             *
             * - `numberOfShards`: 4. The factors of 4 are 1, 2, and 4. So that's the
             *   number of data nodes we could choose.
             *
             *   Let's analyze considering AWS's “[choosing the number of shards][2]”
             *   article:
             *
             *   > (Source data + room to grow) * (1 + indexing overhead) / desired shard
             *   > size = approximate number of primary shards
             *
             *   As of 2025-04-13, we currently have 14.08 MiB between our `tasks`,
             *   `task_collections`, and `search_entity_keywords` indexes. Our
             *   `search_entity_embedding_chunks` index has another 24.25 MiB. This is just
             *   for the internal Alpine workspace, so let's assume 1000x growth. 14.08 MiB
             *   is 0.01375 GiB. Our desired shared size is 10 GiB which is optimized for
             *   search performance.
             *
             *   Running the calculation gives us: (0.01375 * 1000) * 1.1 / 10 = 1.5125. We
             *   pick 4 even though the shards will be a little small so that we can
             *   distribute the shards over 2 or 4 data nodes.
             *
             * [1]: https://opensearch.org/docs/latest/api-reference/index-apis/split/
             * [2]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp-sharding.html
             */
            numberOfShards: number;

            /**
             * We document this on `numberOfShards`.
             */
            numberOfRoutingShards: number;

            /**
             * How should we [sort documents in this index][1]? (Links to ElasticSearch
             * documentation because while [OpenSearch supports it, they don't
             * document it][2].)
             *
             * An important feature for improving search performance for our tasks index
             * given we frequently issue search queries that exclude closed task, for
             * instance.
             *
             * See [this blog post][3] for the motivation behind this feature and some of
             * its applications.
             *
             * - `order` defaults to `asc`
             * - `missing` defaults to `_last`
             *
             * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html
             * [2]: https://github.com/opensearch-project/documentation-website/issues/4650
             * [3]: https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
             */
            sort: ReadonlyArray<{
                field: FlattenedKeys;
                order?: "asc" | "desc";
                missing?: "_last" | "_first";
            }>;

            /**
             * How often to perform a refresh operation. If search results can be delayed a
             * bit, consider increasing this from the default value of 1s.
             */
            refreshInterval: string;

            /**
             * Should we disable the `_source` field on this index?
             *
             * This is a dangerous feature to enable. From the [ElasticSearch
             * documentation][1]:
             *
             * > Though very handy to have around, the source field does incur storage
             * > overhead within the index. For this reason, it can be disabled [...]
             * >
             * > [...]
             * >
             * > Warning: Think before disabling the _source field
             * >
             * > Users often disable the `_source` field without thinking about the
             * > consequences, and then live to regret it. If the `_source` field isn’t
             * > available then a number of features are not supported:
             * >
             * > - The `update`, `update_by_query`, and `reindex` APIs.
             * > - On the fly highlighting.
             * > - The ability to reindex from one Elasticsearch index to another, either
             * >   to change mappings or analysis, or to upgrade an index to a new major
             * >   version.
             * > - The ability to debug queries or aggregations by viewing the original
             * >   document used at index time.
             * > - Potentially in the future, the ability to repair index corruption
             * >   automatically.
             *
             * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-source-field.html#disable-source-field
             */
            disableSourceField?: boolean;
        },
    ) {
        assert(isIdentifier(name));

        this.type = type;
        this.name = name;

        constructedOpensearchIndexCount++;
        if (recording) {
            assert(!recording.indexes.has(this.name), "Index names in recording must be unique");
            recording.indexes.set(this.name, this);
        }

        const customAnalyzerByName = new Map<string, OpensearchIndexAnalysisCustomAnalyzer>();
        const customFilterByName = new Map<string, OpensearchIndexAnalysisCustomFilter>();

        let shouldEnableKnn = false;

        const builder: OpensearchIndexConfigBuilder = {
            enableKnn: () => {
                shouldEnableKnn = true;
            },
            addCustomAnalyzer: analyzer => {
                const existingAnalyzer = getOrSetDefaultMapValue(
                    customAnalyzerByName,
                    analyzer.name,
                    () => analyzer,
                );

                assert(
                    existingAnalyzer === analyzer,
                    "Can’t have two analyzers with the same name in one index",
                );
            },
            addCustomFilter: filter => {
                const existingFilter = getOrSetDefaultMapValue(
                    customFilterByName,
                    filter.name,
                    () => filter,
                );

                assert(
                    existingFilter === filter,
                    "Can’t have two filters with the same name in one index",
                );
            },
        };

        const typeConfig = omitObject(
            type.getConfig(
                builder,
                // Type combinators may modify this to store specific fields but by default no
                // fields are stored.
                {shouldStoreFields: false},
            ),
            ["type"],
        );

        const customAnalyzerDefinitionByName = new Map<string, JsonValue>();
        const customFilterDefinitionByName = new Map<string, JsonValue>();

        while (true) {
            const initialCustomAnalyzerByNameSize = customAnalyzerByName.size;
            const initialCustomFilterByNameSize = customFilterByName.size;

            for (const [name, customAnalyzer] of customAnalyzerByName) {
                if (customAnalyzerDefinitionByName.has(name)) continue;
                customAnalyzerDefinitionByName.set(
                    name,
                    customAnalyzer.getDefinitionConfig(builder),
                );
            }

            for (const [name, customFilter] of customFilterByName) {
                if (customFilterDefinitionByName.has(name)) continue;
                customFilterDefinitionByName.set(name, customFilter.getDefinitionConfig());
            }

            // Break out of our loop once there are no new custom analyzers/filters we need
            // to add to our config.
            //
            // When getting custom analyzer/filter definitions they may recursively add new
            // custom analyzers/filters which is why we need to loop.
            if (
                initialCustomAnalyzerByNameSize === customAnalyzerByName.size &&
                initialCustomFilterByNameSize === customFilterByName.size
            ) {
                break;
            }
        }

        this.config = {
            settings: {
                index: {
                    // When running tests (Jest or Playwright), only use a single shard to speed
                    // things up.
                    number_of_shards: process.env.NODE_ENV === "test" ? 1 : numberOfShards,
                    number_of_routing_shards: numberOfRoutingShards,
                    sort: {
                        field: sort.map(({field}) => field),
                        order: sort.map(({order}) => order ?? "asc"),
                        missing: sort.map(({missing}) => missing ?? "_last"),
                    },
                    // Always manually refresh in tests (Jest or Playwright).
                    refresh_interval: process.env.NODE_ENV === "test" ? "-1" : refreshInterval,
                    // One copy of all indexes to increase availability and avoid data loss.
                    //
                    // When running tests (Jest or Playwright), don't run any replicas to speed
                    // things up.
                    number_of_replicas: process.env.NODE_ENV !== "production" ? 0 : 1,
                    // Docs with the same `routing` value should always go to one shard so we never
                    // need to do a cross network search when searching within a `routing` value.
                    routing_partition_size: 1,
                    codec: "default",
                    // If we have a `knn_vector` field then enable building KNN indexes.
                    knn: shouldEnableKnn ? true : undefined,
                },
                analysis: {
                    filter: Object.fromEntries(customFilterDefinitionByName),
                    analyzer: Object.fromEntries(customAnalyzerDefinitionByName),
                },
            },
            mappings: {
                // Always require a custom routing value. Searches are almost always scoped
                // by space.
                _routing: {
                    required: true,
                },
                _source: {
                    enabled: !disableSourceField,
                },
                ...typeConfig,
            },
        };
    }
}

let constructedOpensearchIndexCount = 0;

/**
 * How many OpenSearch indexes have been created? Can be used with
 * `recordConstructedOpensearchIndexes()` to make sure you've recorded all
 * constructed OpenSearch indexes.
 *
 * We can't add every OpenSearch index ever constructed to an array since the
 * array would grow indefinitely in our Vite dev server which re-evaluates
 * modules whenever they update.
 */
export function getConstructedOpensearchIndexCount() {
    return constructedOpensearchIndexCount;
}

let recording: {
    indexes: Map<string, OpensearchIndex<any, any, any, any, any>>;
} | null = null;

/**
 * Record all OpenSearch indexes constructed during the provided action.
 * Doesn't record any OpenSearch indexes constructed before or after this.
 */
export async function recordConstructedOpensearchIndexes<Value>(
    action: () => Promise<Value>,
): Promise<
    [
        {
            indexes: Map<string, OpensearchIndex<any, any, any, any, any>>;
        },
        Value,
    ]
> {
    assert(recording === null);

    const indexes = new Map<string, OpensearchIndex<any, any, any, any, any>>();

    let value: Value;
    recording = {indexes};
    try {
        value = await action();
    } finally {
        recording = null;
    }

    return [{indexes}, value];
}
