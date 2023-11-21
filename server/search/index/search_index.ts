import {
    OpensearchIndexArrayType,
    OpensearchIndexByteType,
    OpensearchIndexKeywordType,
    OpensearchIndexKnnVectorType,
    OpensearchIndexLongType,
    OpensearchIndexObjectType,
    OpensearchIndexTypeBase,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityId} from "~/server/search/index/internal/search_entity_id.js";
import {
    IntegerMappingStringType,
    createEnumIntegerMapping,
} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {isId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

type SearchIndexDefaultGrantType = IntegerMappingStringType<
    typeof SearchIndexDefaultGrantTypeIntegerMapping
>;

const SearchIndexDefaultGrantTypeIntegerMapping = createEnumIntegerMapping({
    Space: 1,
});

const SearchIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        // NOCOMMIT:
        // - Title
        // - Sub-headings
        // - Body
        // - Type
        //
        // `_source` excludes (exclude most things I think)

        accessPolicy: OpensearchIndexObjectType.new({
            fields: {
                accountGrantAccountIds: new OpensearchIndexArrayType(
                    new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
                ),
                defaultGrantType: new OpensearchIndexByteType({isFilterable: true})
                    .transform<SearchIndexDefaultGrantType>({
                        serialize: type => SearchIndexDefaultGrantTypeIntegerMapping.into(type),
                        deserialize: type =>
                            SearchIndexDefaultGrantTypeIntegerMapping.from(
                                SearchIndexDefaultGrantTypeIntegerMapping.assert(type),
                            ),
                    })
                    .nullable(),
            },
        }),

        dependencies: new OpensearchIndexArrayType(
            OpensearchIndexObjectType.new({
                fields: {
                    entityId: new OpensearchIndexKeywordType({
                        isFilterable: true,
                    }) as OpensearchIndexTypeBase<SearchEntityId, "this">,
                    version: new OpensearchIndexLongType(),
                },
            }),
        ),

        embeddingChunks: OpensearchIndexObjectType.new({
            fields: {
                cohereEnglishLight: new OpensearchIndexArrayType(
                    new OpensearchIndexKnnVectorType({
                        // The Cohere `embed-english-light-v3.0` model has 384 dimensions.
                        // https://docs.cohere.com/reference/embed
                        dimensions: 384,

                        // `byte` provides better performance at scale with a minimal recall sacrifice.
                        // (See documentation on this property for sources.)
                        dataType: "byte",

                        method: {
                            // NOTE(calebmer, 2023-11-21): I'm pretty unhappy that OpenSearch does not
                            // provide a way to partition HNSW graphs per-space. Given we never return
                            // results cross spaces. Pinecone has this capability, they call it
                            // [namespaces][1]. Maybe this is better for memory usage? Unclear. I hope that
                            // when we set a `routing` value only the HNSW for the routing shard is
                            // consulted. That's partitioning from an efficiency standpoint.
                            //
                            // I'm worried there are security vulnerabilities (specifically timing attacks)
                            // that are possible when searching all vectors across all spaces. If you're
                            // searching with some text that's confidential information in another space
                            // and your search takes a while does that reveal the information exists? (e.g.
                            // Searching for "company X acquisition".) Unclear whether this is a real
                            // vulnerability.
                            //
                            // Maybe it's more memory efficient or something to have one big HNSW structure
                            // per data shard. This [ElasticSearch forum thread][2] says it might actually
                            // be more performant to do an exact k-NN search for <10M vectors. Given
                            // `SpaceId` isn't the only thing we need to filter by (we need to test whether
                            // the `AccountId` is in the access policy) we'll probably generally be
                            // searching <10M vectors. Efficient lucene filtering will [fallback to exact
                            // search][3] if the conditions are right for it.
                            //
                            // Going to proceed for now since it might be fine for everything to be in one
                            // big HNSW index. The HNSW index might even be completely unnecessary! Gotta
                            // see how this performs in production.
                            //
                            // [1]: https://docs.pinecone.io/docs/namespaces
                            // [2]: https://discuss.elastic.co/t/partition-hnsw-graph-per-user-elastic-knn/346394
                            // [3]: https://opensearch.org/docs/latest/search-plugins/knn/filter-search-knn/#lucene-k-nn-filter-implementation
                            name: "hnsw",

                            // `l2` stands for Euclidean distance and is OpenSearch's default distance
                            // function. Cohere embeddings support Euclidean distance. (See documentation
                            // on this property for sources.)
                            spaceType: "l2",

                            // Choosing the Lucene engine because it supports important functionality for
                            // performance (byte vectors and efficient filter search).
                            engine: "lucene",

                            // We use the OpenSearch [default values][1] for these parameters. To learn the
                            // performance tradeoff of various configurations, this is a [great blog
                            // post][2]. To summarize:
                            //
                            // - `m` is the number of connections between nodes in the graph at each layer
                            //   and large values have a big impact on memory usage. Larger values can also
                            //   slow down search time. The tradeoff is higher `m` values are better for
                            //   recall.
                            //
                            // - `ef_construction` determines the number of layers in the HNSW structure.
                            //   It has little to no impact on search performance and memory usage but
                            //   higher values do increase indexing time. Higher `ef_construction` values
                            //   improve recall for lower `m` values.
                            //
                            // A combination of high `ef_construction`, low `m`, gives us good search
                            // performance and recall while hurting indexing time. Given we care about
                            // search performance upmost we're happy with this tradeoff and will use the
                            // default OpenSearch values.
                            //
                            // If anything, we should experiment with lowering the `m` value to 8.
                            //
                            // [1]: https://opensearch.org/docs/latest/search-plugins/knn/knn-index#hnsw-parameters-2
                            // [2]: https://www.pinecone.io/learn/series/faiss/hnsw/
                            parameters: {
                                ef_construction: 512,
                                m: 16,
                            },
                        },
                    }),
                ),
            },
        }),
    },
});
