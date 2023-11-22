import {opensearchIndexEnglishWithWordDelimiterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {OpensearchIndexAnalysisCustomFilter} from "~/server/opensearch/opensearch_index_analysis.js";
import {
    OpensearchIndexArrayType,
    OpensearchIndexByteType,
    OpensearchIndexKeywordType,
    OpensearchIndexKnnVectorType,
    OpensearchIndexLongType,
    OpensearchIndexObjectType,
    OpensearchIndexSearchAsYouTypeType,
    OpensearchIndexTextType,
    OpensearchIndexTypeBase,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityId} from "~/server/search/index/internal/search_entity_id.js";
import {
    IntegerMappingStringType,
    createEnumIntegerMapping,
} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Participating accounts list

type SearchEntityIndexDefaultGrantType = IntegerMappingStringType<
    typeof SearchEntityIndexDefaultGrantTypeIntegerMapping
>;

const SearchEntityIndexDefaultGrantTypeIntegerMapping = createEnumIntegerMapping({
    Space: 1,
});

export type SearchEntityIndexDoc = OpensearchIndexTypeType<typeof SearchEntityIndexDocType>;

export const SearchEntityIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        // The space this entity is in. We also use the `SpaceId` as the routing value
        // for `SearchIndex`. Why do we also need it here? For index sorting. We want to
        // sort the OpenSearch index by space. So it's efficient to filter for entities
        // in a space. The documentation is unclear on whether the routing field is
        // included in index sorting so we manually have an identical `spaceId` field
        // that's part of index sorting.
        //
        // We recommend filtering on both `spaceId` and the routing field to make sure
        // index sorting optimizations kick in.
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),

        type: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }),

        version: new OpensearchIndexLongType(),

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

        accessPolicy: OpensearchIndexObjectType.new({
            fields: {
                accountGrantAccountIds: new OpensearchIndexArrayType(
                    new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
                ),
                defaultGrantType: new OpensearchIndexByteType({isFilterable: true})
                    .transform<SearchEntityIndexDefaultGrantType>({
                        serialize: type =>
                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(type),
                        deserialize: type =>
                            SearchEntityIndexDefaultGrantTypeIntegerMapping.from(
                                SearchEntityIndexDefaultGrantTypeIntegerMapping.assert(type),
                            ),
                    })
                    .nullable(),
            },
        }),

        /**
         * Titles use the OpenSearch [`search_as_you_type` field][1] which includes an
         * optimization for prefix matching. Which is important for building
         * autocomplete experiences.
         *
         * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/search-as-you-type/
         */
        title: new OpensearchIndexSearchAsYouTypeType({
            analyzer: opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
        }).nullable(),

        /**
         * For body text analysis we manually recreate the [OpenSearch
         * `search_as_you_type` field][1] but without the `_index_prefix` field since
         * we don't care about prefix matching for body text and don't want to pay the
         * storage price for indexed data we don't use.
         *
         * We do still want 2gram and 3gram shingles, though. This gives us [basic
         * phrase matching][2] at query time to improve result relevance.
         *
         * Our analyzer includes the `word_delimiter_graph` filter to better interpret
         * identifiers commonly used in business like `FY2024Q3`.
         *
         * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/search-as-you-type/
         * [2]: https://www.elastic.co/blog/searching-with-shingles
         */
        body: new OpensearchIndexTextType({
            analyzer: opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
            fields: {
                _2gram: new OpensearchIndexTextType({
                    analyzer: opensearchIndexEnglishWithWordDelimiterGraphAnalyzer.extend(
                        "and_2gram_shingle",
                        {
                            filter: [
                                new OpensearchIndexAnalysisCustomFilter("2gram_shingle", {
                                    type: "shingle",
                                    min_shingle_size: 2,
                                    max_shingle_size: 2,
                                    output_unigrams: false,
                                    // Same configuration as OpenSearch's `search_as_you_type` field.
                                    // https://github.com/opensearch-project/OpenSearch/blob/a0b016bf154cf765483f38c4c7f135ae972004c2/modules/mapper-extras/src/main/java/org/opensearch/index/mapper/SearchAsYouTypeFieldMapper.java#L738
                                    token_separator: " ",
                                    filler_token: "",
                                }),
                            ],
                        },
                    ),
                }),
                _3gram: new OpensearchIndexTextType({
                    analyzer: opensearchIndexEnglishWithWordDelimiterGraphAnalyzer.extend(
                        "and_3gram_shingle",
                        {
                            filter: [
                                new OpensearchIndexAnalysisCustomFilter("3gram_shingle", {
                                    type: "shingle",
                                    min_shingle_size: 3,
                                    max_shingle_size: 3,
                                    output_unigrams: false,
                                    // Same configuration as OpenSearch's `search_as_you_type` field.
                                    // https://github.com/opensearch-project/OpenSearch/blob/a0b016bf154cf765483f38c4c7f135ae972004c2/modules/mapper-extras/src/main/java/org/opensearch/index/mapper/SearchAsYouTypeFieldMapper.java#L738
                                    token_separator: " ",
                                    filler_token: "",
                                }),
                            ],
                        },
                    ),
                }),
            },
        }).nullable(),

        /**
         * The first embedding chunk is included in the entity doc in our search index
         * to save on space. If we have more than one chunk, we create new OpenSearch
         * docs.
         */
        embeddingChunks: new OpensearchIndexArrayType(
            OpensearchIndexObjectType.new({
                fields: {
                    /**
                     * A preview of this chunk's text to be displayed to the user when their search
                     * matches this chunk. Doesn't include context we send to the LLM.
                     */
                    previewText: new OpensearchIndexKeywordType(),

                    /**
                     * The embedding vector returned by our LLM (Cohere).
                     */
                    vector: new OpensearchIndexArrayType(
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
        ),
    },
});
