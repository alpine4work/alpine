import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelBaseClass} from "~/server/language_models/core/language_model_base.js";
import {opensearchIndexEnglishWithWordDelimiterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {OpensearchIndexAnalysisCustomFilter} from "~/server/opensearch/opensearch_index_analysis.js";
import {
    OpensearchIndexArrayType,
    OpensearchIndexBinaryType,
    OpensearchIndexByteType,
    OpensearchIndexDateType,
    OpensearchIndexIntegerType,
    OpensearchIndexKeywordType,
    OpensearchIndexKnnVectorType,
    OpensearchIndexNestedType,
    OpensearchIndexObjectType,
    OpensearchIndexSearchAsYouTypeType,
    OpensearchIndexTextType,
    OpensearchIndexTypeBase,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityDependencyId} from "~/server/search/core/search_entity_dependency_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    IntegerMappingStringType,
    createEnumIntegerMapping,
} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Participating accounts list
// NOCOMMIT: Created time and updated time

export type SearchEntityIndexDefaultGrantType = IntegerMappingStringType<
    typeof SearchEntityIndexDefaultGrantTypeIntegerMapping
>;

export const SearchEntityIndexDefaultGrantTypeIntegerMapping = createEnumIntegerMapping({
    Space: 1,
});

export type SearchEntityIndexAccessPolicy = OpensearchIndexTypeType<
    typeof SearchEntityIndexAccessPolicyType
>;

const SearchEntityIndexAccessPolicyType = OpensearchIndexObjectType.new({
    fields: {
        accountGrantAccountIds: new OpensearchIndexArrayType(
            new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
        ).transform<ReadonlySet<AccountId>>({
            serialize: accountIds => Array.from(accountIds),
            deserialize: accountIds => new Set(accountIds),
        }),
        defaultGrantType: new OpensearchIndexByteType({isFilterable: true})
            .transform<SearchEntityIndexDefaultGrantType>({
                serialize: type => SearchEntityIndexDefaultGrantTypeIntegerMapping.into(type),
                deserialize: type =>
                    SearchEntityIndexDefaultGrantTypeIntegerMapping.from(
                        SearchEntityIndexDefaultGrantTypeIntegerMapping.assert(type),
                    ),
            })
            .nullable(),
    },
});

export type SearchEntityKeywordIndexDoc = OpensearchIndexTypeType<
    typeof SearchEntityKeywordIndexDocType
>;

export const SearchEntityKeywordIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),

        type: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }),

        /**
         * The last time where we started the read that produced this search entity.
         */
        lastReadStartTime: new OpensearchIndexDateType().store(),

        /**
         * Determines who is allowed to view this search entity. We filter against this
         * property when we search.
         */
        accessPolicy: SearchEntityIndexAccessPolicyType,

        /**
         * Other entities that this search entity depends on.
         * `SearchEntityDependencyId`s are `SearchEntityId`s plus some extra
         * information about what specific attribute we depend on.
         */
        dependencyIds: new OpensearchIndexArrayType(
            new OpensearchIndexKeywordType({
                isFilterable: true,
            }) as OpensearchIndexTypeBase<SearchEntityDependencyId, "this", {}>,
        ),

        /**
         * Titles use the OpenSearch [`search_as_you_type` field][1] which includes an
         * optimization for prefix matching. Which is important for building
         * autocomplete experiences.
         *
         * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/search-as-you-type/
         */
        title: new OpensearchIndexSearchAsYouTypeType({
            analyzer: opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
            // For efficient highlighting we need to include term offsets in the index.
            // Otherwise the text needs to be reanalyzed at search time which increases the
            // time a search takes.
            //
            // See: https://opensearch.org/docs/latest/search-plugins/searching-data/highlight/#methods-of-obtaining-offsets
            indexOptions: "offsets",
        })
            .nullable()
            // Store the title so we can highlight it.
            .store(),

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
            // For efficient highlighting we need to include term offsets in the index.
            // Otherwise the text needs to be reanalyzed at search time which increases the
            // time a search takes.
            //
            // See: https://opensearch.org/docs/latest/search-plugins/searching-data/highlight/#methods-of-obtaining-offsets
            indexOptions: "offsets",
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
        })
            .nullable()
            // Store the body so we can highlight it.
            .store(),
    },
});

/**
 * Language models we embed search entity content with.
 *
 * - We use `AllMiniLmL6V2Model` (free) locally in development
 * - We use `CohereEmbedEnglishV3Model` (paid) in production
 */
const searchEntitySemanticIndexEmbeddingChunkLanguageModels = {
    allMiniLmL6V2: AllMiniLmL6V2LanguageModel,
    cohereEmbedEnglishV3: CohereEmbedEnglishV3LanguageModel,
} satisfies {
    [key: string]: LanguageModelBaseClass;
};

for (const [key, languageModelClass] of Object.entries(
    searchEntitySemanticIndexEmbeddingChunkLanguageModels,
)) {
    assert(key === languageModelClass.key);
}

export type SearchEntitySemanticIndexEmbeddingChunk = OpensearchIndexTypeType<
    typeof SearchEntitySemanticIndexEmbeddingChunkType
>;

const SearchEntitySemanticIndexEmbeddingChunkType = OpensearchIndexObjectType.new({
    fields: {
        spaceId: new OpensearchIndexKeywordType({isFilterable: true}).validate<SpaceId>(isId),

        /**
         * `spaceId` and `accessPolicy` are copied to every nested embedding chunk
         * object. They are the same across all objects. Why is this? It's quite
         * inefficient from a JSON point of view. Why not store the `accessPolicy` at
         * the root document level if it doesn't change across chunks? Instead of
         * copying the `accessPolicy` (which can get big) across all chunks.
         *
         * The reason we add the `accessPolicy` to every chunk is to make searching
         * chunks more efficient. Otherwise if we were searching nested chunks that
         * match an `accessPolicy` on the root doc, OpenSearch would need to do a bunch
         * of expensive joins.
         *
         * Furthermore, [efficient k-NN filtering][1] structurally MUST be on the
         * nested doc. There's no syntax for filtering on a parent property with k-NN
         * efficient filtering. (See the `filter` property on
         * `OpensearchKnnQueryClause`.)
         *
         * [1]: opensearch.org/docs/latest/search-plugins/knn/filter-search-knn
         */
        accessPolicy: SearchEntityIndexAccessPolicyType,

        /**
         * The chunk's text. Can be provided to a conversational LLM (like ChatGPT) to
         * implement a chat bot. Can also be used to show the user a preview of the
         * content they searched for.
         */
        text: new OpensearchIndexKeywordType().store(),

        /**
         * Index at which the preamble ends in `text`. The preamble contains context we
         * send to an LLM to help it interpret the chunk that a user doesn't need to
         * see. The preamble typically includes the document title and section title.
         */
        preambleEndIndex: new OpensearchIndexIntegerType().store(),

        /**
         * The embedding vector returned by our language model. We may embed the same
         * content with different models which is why this is an object.
         */
        vector: OpensearchIndexObjectType.new({
            fields: mapObjectValues(
                searchEntitySemanticIndexEmbeddingChunkLanguageModels,
                languageModelClass => {
                    return new OpensearchIndexKnnVectorType({
                        dimensions: languageModelClass.dimensionCount,
                        dataType: languageModelClass.dimensionDataType,

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

                            spaceType: languageModelClass.opensearchSpaceType,

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
                    }).nullable();
                },
            ),
        }),
    },
});

export type SearchEntitySemanticIndexDoc = OpensearchIndexTypeType<
    typeof SearchEntitySemanticIndexDocType
>;

export const SearchEntitySemanticIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        /**
         * The title of the chunked entity. Copied here in addition to the keyword
         * index so we can load the title when searching.
         */
        title: new OpensearchIndexKeywordType().nullable().store(),

        /**
         * Embedding chunks are represented as a nested OpenSearch fields. Nested
         * OpenSearch fields index each object as a separate internal doc
         * under-the-hood. What's really nice about a nested field is we can update all
         * the child docs atomically.
         *
         * There are certainly performance dangers to OpenSearch nested fields ([good
         * blog post on one company's journey][1]). Since OpenSearch has to perform
         * joins at query time.
         *
         * However, state-of-the-art vector search chunking strategies on
         * OpenSearch/ElasticSearch appear to [recommend using nested docs][2].
         * Furthermore, it would appear like Lucene understands this is an important
         * use case and is building optimizations for it ([PR optimizing joins with
         * k-NN in Lucene][3] which OpenSearch/ElasticSearch use under-the-hood, [blog
         * post explaining the PR][4]).
         *
         * [1]: https://www.gojek.io/blog/elasticsearch-the-trouble-with-nested-documents
         * [2]: https://www.elastic.co/search-labs/blog/articles/chunking-via-ingest-pipelines
         * [3]: https://github.com/apache/lucene/pull/12434
         * [4]: https://www.elastic.co/search-labs/blog/articles/adding-passage-vector-search-to-lucene
         */
        embeddingChunks: new OpensearchIndexNestedType(SearchEntitySemanticIndexEmbeddingChunkType),

        /**
         * A cache of embedding chunk vectors. Cohere, and other API language model
         * providers, charge by the token. To avoid getting charged for content we've
         * previously embedded we have this vector cache.
         *
         * The cache is keyed by a hash of an embedding chunk's text content and the
         * value is the embedding vector for that content. We serialize the cache map
         * to binary for OpenSearch to save space. Since the hash is a 32-bit unsigned
         * integer (generated by murmurhash) and the embedding is an n-dimensional
         * vector of bytes (we quantize the vector dimensions from float32 to uint8 for
         * space efficiency with minimal recall loss).
         *
         * As with any hash, murmurhash has a chance of collision. In case of collision
         * we'll use an embedding vector that doesn't match the text. This will impact
         * recall (since we won't embed the actual text's meaning) but doesn't impact
         * permissions or anything else critical. Since you have access to everything
         * in the search entity. We're ok with a very very rare recall loss on hash
         * collision.
         */
        embeddingChunksVectorCache: OpensearchIndexObjectType.new({
            fields: mapObjectValues(
                searchEntitySemanticIndexEmbeddingChunkLanguageModels,
                languageModelClass => {
                    const isByteDimensionDataType = languageModelClass.dimensionDataType;

                    return new OpensearchIndexBinaryType()
                        .transform<ReadonlyMap<number, ReadonlyArray<number>>>({
                            serialize: vectorCache => {
                                const buffer = new ArrayBuffer(
                                    vectorCache.size *
                                        (4 +
                                            languageModelClass.dimensionCount *
                                                (isByteDimensionDataType ? 1 : 4)),
                                );

                                const view = new DataView(buffer);
                                let byteOffset = 0;

                                for (const [textHash, vector] of vectorCache) {
                                    view.setUint32(byteOffset, textHash);
                                    byteOffset += 4;

                                    for (let i = 0; i < languageModelClass.dimensionCount; i++) {
                                        const dimension = vector[i]!;

                                        if (isByteDimensionDataType) {
                                            view.setUint8(byteOffset, dimension);
                                            byteOffset += 1;
                                        } else {
                                            view.setFloat32(byteOffset, dimension);
                                            byteOffset += 4;
                                        }
                                    }
                                }

                                return new Uint8Array(buffer);
                            },
                            deserialize: bytes => {
                                const vectorCache = new Map<number, Array<number>>();

                                const view = new DataView(
                                    bytes.buffer,
                                    bytes.byteOffset,
                                    bytes.byteLength,
                                );
                                let byteOffset = 0;

                                while (byteOffset < bytes.byteLength) {
                                    const textHash = view.getUint32(byteOffset);
                                    byteOffset += 4;

                                    const vector = [];
                                    for (let i = 0; i < languageModelClass.dimensionCount; i++) {
                                        if (isByteDimensionDataType) {
                                            const dimension = view.getUint8(byteOffset);
                                            byteOffset += 1;

                                            vector.push(dimension);
                                        } else {
                                            const dimension = view.getFloat32(byteOffset);
                                            byteOffset += 4;

                                            vector.push(dimension);
                                        }
                                    }

                                    vectorCache.set(textHash, vector);
                                }

                                return vectorCache;
                            },
                        })
                        .nullable()
                        .store();
                },
            ),
        }),
    },
});
