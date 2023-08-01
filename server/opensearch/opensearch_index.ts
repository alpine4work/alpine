import {OpensearchIndexObjectType} from "~/server/opensearch/opensearch_index_type.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";

export type OpensearchIndexConfig<FlattenedKeys extends string> = {
    readonly settings: {
        readonly index: {
            readonly number_of_shards: number;
            readonly number_of_routing_shards: number;
            readonly sort: {
                readonly field: ReadonlyArray<FlattenedKeys>;
                readonly order: ReadonlyArray<"asc" | "desc">;
            };
            readonly refresh_interval: string;
            readonly number_of_replicas: number;
            readonly routing_partition_size: number;
            readonly codec: string;
        };
    };
    readonly mappings: JsonObjectValue;
};

const opensearchIndexStaticSettingsKeys = filterMapArray(
    Object.entries(
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
        }),
    ),
    ([key, isStatic]) =>
        isStatic ? (key as keyof OpensearchIndexConfig<string>["settings"]["index"]) : null,
);

/**
 * Take an OpenSearch index config and extract just the static properties out
 * of it.
 */
export function pickOpensearchStaticIndexConfig(config: OpensearchIndexConfig<string>) {
    return {
        settings: {
            index: pickObject(config.settings.index, opensearchIndexStaticSettingsKeys),
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
            ...config.settings,
            index: omitObject(config.settings.index, opensearchIndexStaticSettingsKeys),
        },
    };
}

export class OpensearchIndex<
    Routing extends string,
    DocId extends string,
    Doc,
    FlattenedKeys extends string,
> {
    public readonly type: OpensearchIndexObjectType<Doc, FlattenedKeys>;
    public readonly name: string;
    public readonly config: OpensearchIndexConfig<FlattenedKeys>;

    // These properties do nothing but make sure the associated generic parameters
    // are used.
    private readonly _routing?: Routing;
    private readonly _docId?: DocId;

    constructor(
        type: OpensearchIndexObjectType<Doc, FlattenedKeys>,
        {
            name,
            numberOfShards,
            numberOfRoutingShards,
            sort,
            refreshInterval,
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
             * I (@calebmer) picked the following values to start for the task index:
             *
             * - `numberOfShards`: 12. The factors of 12 are 1, 2, 3, 4, 6, and 12. So
             *   that's the number of data nodes we could choose.
             *
             * - `numberOfRoutingShards`: 2^5 * 3^3 * 5 (4,320). This lets us scale
             *   `numberOfShards` by 2 three times, by 3 two times, and by five once. We
             *   can't scale by 2 five times and by 3 three times since we start at 12
             *   (2^2 * 3).
             *
             * [1]: https://opensearch.org/docs/latest/api-reference/index-apis/split/
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
             * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html
             * [2]: https://github.com/opensearch-project/documentation-website/issues/4650
             * [3]: https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
             */
            sort: ReadonlyArray<{field: FlattenedKeys; order: "asc" | "desc"}>;

            /**
             * How often to perform a refresh operation. If search results can be delayed a
             * bit, consider increasing this from the default value of 1s.
             */
            refreshInterval: string;
        },
    ) {
        this.type = type;
        this.name = name;

        this.config = {
            settings: {
                index: {
                    // When running tests in Jest, only use a single shard to speed things up.
                    number_of_shards: import.meta.jest ? 1 : numberOfShards,
                    number_of_routing_shards: numberOfRoutingShards,
                    sort: {
                        field: sort.map(({field}) => field),
                        order: sort.map(({order}) => order),
                    },
                    refresh_interval: refreshInterval,
                    // One copy of all indexes to increase availability and avoid data loss.
                    //
                    // When running tests in Jest, don't run any replicas to speed things up.
                    number_of_replicas: import.meta.jest ? 0 : 1,
                    // Docs with the same `routing` value should always go to one shard so we never
                    // need to do a cross network search when searching within a `routing` value.
                    routing_partition_size: 1,
                    // Benchmarks show `zstd_no_dict` provides better compression ratio than
                    // `default` for the same read performance. Seems like a better default.
                    codec: "zstd_no_dict",
                },
            },
            mappings: {
                // Always require a custom routing value. Searches are almost always scoped
                // by space.
                _routing: {
                    required: true,
                },
                ...omitObject(type.getConfig(), ["type"]),
            },
        };
    }
}
