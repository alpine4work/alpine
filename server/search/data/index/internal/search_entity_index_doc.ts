import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelBaseClass} from "~/server/language_models/core/language_model_base.js";
import {opensearchIndexEnglishWithWordDelimiterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {OpensearchIndexAnalysisCustomFilter} from "~/server/opensearch/opensearch_index_analysis.js";
import {
    OpensearchIndexArrayType,
    OpensearchIndexBooleanType,
    OpensearchIndexByteType,
    OpensearchIndexDateType,
    OpensearchIndexIntegerType,
    OpensearchIndexKeywordType,
    OpensearchIndexKnnVectorType,
    OpensearchIndexObjectType,
    OpensearchIndexSearchAsYouTypeType,
    OpensearchIndexTextType,
    OpensearchIndexTypeBase,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityDependencyId} from "~/server/search/core/search_entity_dependency_id.js";
import {
    SearchEntityMedia,
    SearchEntityMediaSchema,
} from "~/server/search/data/index/internal/search_entity_media.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    IntegerMappingStringType,
    createEnumIntegerMapping,
} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {
    SearchEntityTitleVersion,
    SearchEntityTitleVersionSchema,
} from "~/shared/search/search_entity_title_version.js";

// NOTE(calebmer, 2025-01-14): The fact that this is a constant string
// `"Space"` and not a boolean is a historical artifact based on data written
// to the database. See the comment on the `defaultGrantType` field in
// `SearchEntityIndexAccessPolicyType` for more information.
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

        // NOTE(calebmer, 2025-01-14): When I first designed the `AccessPolicy` type I
        // thought public sharing via URL would be expressed as a union on the grant
        // type. So the type of `defaultGrant` would be
        // `{type: "Space"; level: AccessLevel} | {type: "Internet"; level: AccessLevel}`
        // or something like this. The problem with this design is we want to be able
        // to express an `AccessPolicy` where the public internet has `View` access
        // and internal space accounts have `Edit` access. Using a union makes it
        // more challenging to express this. So we scrapped the union and now
        // `defaultGrant` only refers to space access.
        //
        // However, since we've written this `defaultGrantType` type to OpenSearch, we
        // can't change this to the ideal field (which would be a boolean named
        // something like `hasDefaultGrant`) without a migration. So for now we're
        // leaving the idea of a default grant type in OpenSearch and basically
        // treating it as a boolean.
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

const SearchEntityIndexAccessPolicyStoredType = OpensearchIndexObjectType.new({
    fields: {
        accountGrantAccountIds: new OpensearchIndexArrayType(
            new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
        )
            .store()
            .transform<ReadonlySet<AccountId>>({
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
            .nullable()
            .store(),
    },
});

const SearchEntityMediaType = new OpensearchIndexKeywordType().transform<SearchEntityMedia>({
    serialize: media => JSON.stringify(SearchEntityMediaSchema.serialize(media)),
    deserialize: media => SearchEntityMediaSchema.deserialize(JSON.parse(media)),
});

const SearchEntityTitleVersionType =
    new OpensearchIndexKeywordType().transform<SearchEntityTitleVersion>({
        serialize: titleVersion =>
            JSON.stringify(SearchEntityTitleVersionSchema.serialize(titleVersion)),
        deserialize: titleVersion =>
            SearchEntityTitleVersionSchema.deserialize(JSON.parse(titleVersion)),
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
         * When was this search entity created?
         *
         * The `createdTime` comes from reading the underlying search entity. So
         * whatever we get when we read the search entity is what we use here.
         */
        createdTime: new OpensearchIndexDateType({
            isFilterable: true,
            isSortable: true,
        }).store(),

        /**
         * When was the last time this search entity was updated?
         *
         * We update this whenever processing a job that updates the entity. This value
         * always increases and is always larger than `createdTime`. Since we update
         * this property in a generic way, if the underlying entity is tracking last
         * update time the `lastUpdatedTime` property here may disagree. Because of
         * this, if you show this property to the user show it at a low resolution
         * (e.g. in days vs minutes) to avoid revealing any discrepancy with the
         * underlying entity.
         */
        lastUpdatedTime: new OpensearchIndexDateType({
            isFilterable: true,
            isSortable: true,
        }).store(),

        /**
         * The last time where we started the read that produced this search entity.
         */
        lastReadStartTime: new OpensearchIndexDateType().store(),

        /**
         * Does this search entity have some embedding chunks?
         */
        hasEmbeddingChunks: new OpensearchIndexBooleanType().default(false).store(),

        /**
         * Determines who is allowed to view this search entity. We filter against this
         * property when we search.
         */
        accessPolicy: SearchEntityIndexAccessPolicyStoredType,

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
            //
            // TODO(calebmer, 2025-06-29): I don't think we need offsets for the title?
            // Since we only highlight the body field. Not sure if we can remove this
            // without reindexing.
            indexOptions: "offsets",
        })
            .nullable()
            // Store the title so we can highlight it.
            .store(),

        /**
         * Version information for `title`. Used by the client to pick a winning title
         * when there's a conflict.
         */
        titleVersion: SearchEntityTitleVersionType.nullable().default(null).store(),

        /**
         * Body text for the search entity. Body text is Markdown formatted and can
         * be parsed with `parseSearchContent()`. We strip some formatting from the
         * Markdown that we don't want to be indexed (for example `<table>` HTML).
         *
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

        /**
         * Media we display alongside the search entity if available. For example, if
         * search surfaces a chat message then we show the avatar of the account who
         * sent the chat message.
         */
        media: SearchEntityMediaType.nullable().store(),

        /**
         * The account who created this search entity.
         */
        creatorId: new OpensearchIndexKeywordType({isFilterable: true})
            .validate<AccountId>(isId)
            .nullable()
            .default(null),

        /**
         * Accounts who made major updates to this search entity. Or the creator.
         * The creator is always considered a major contributor in our index even
         * if they made a minority of updates. The main authors of a document, for
         * instance.
         *
         * Will not contain minor contributors.
         */
        majorContributorIds: new OpensearchIndexArrayType(
            new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
        ).default([]),

        /**
         * Accounts who made any update to this search entity, major or minor,
         * including the creator. An account who left a single comment on a document,
         * for instance.
         *
         * To get minor contributors, subtract the major contributor set from this one.
         */
        anyContributorIds: new OpensearchIndexArrayType(
            new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
        ).default([]),
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

export type SearchEntityEmbeddingChunkIndexDoc = OpensearchIndexTypeType<
    typeof SearchEntityEmbeddingChunkIndexDocType
>;

export const SearchEntityEmbeddingChunkIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),

        entity: OpensearchIndexObjectType.new({
            fields: {
                type: new OpensearchIndexKeywordType({
                    isFilterable: true,
                    isSortable: true,
                }),

                id: new OpensearchIndexKeywordType({
                    isFilterable: true,
                })
                    .validate<SearchDynamicEntityId>(
                        (value): value is SearchDynamicEntityId => true,
                    )
                    .store(),

                /**
                 * `accessPolicy` is copied to every nested embedding chunk object so we can
                 * perform [efficient k-NN filtering][1] on the chunks.
                 *
                 * [1]: opensearch.org/docs/latest/search-plugins/knn/filter-search-knn
                 */
                accessPolicy: SearchEntityIndexAccessPolicyType,

                /**
                 * The title of the chunked entity. Copied here in addition to the keyword
                 * index so we can load the title when searching.
                 */
                title: new OpensearchIndexKeywordType().nullable().store(),

                /**
                 * Version information for `title`. Used by the client to pick a winning title
                 * when there's a conflict.
                 */
                titleVersion: SearchEntityTitleVersionType.nullable().default(null).store(),

                /**
                 * Media we display alongside the search entity if available. For example, if
                 * search surfaces a chat message then we show the avatar of the account who
                 * sent the chat message.
                 */
                media: SearchEntityMediaType.nullable().store(),
            },
        }),

        /**
         * The chunk's text. Can be provided to a conversational LLM (like ChatGPT) to
         * implement a chat bot. Can also be used to show the user a preview of the
         * content they searched for.
         */
        text: new OpensearchIndexKeywordType().store(),

        /**
         * A hash of the chunk's text. Uses `murmurhash.v3()` to generate the hash. We
         * use this to detect duplicate chunks.
         */
        textHash: new OpensearchIndexIntegerType().store(),

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
                    return (
                        new OpensearchIndexKnnVectorType({
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

                                // If we're in a development environment on MacOS (or x86_64 Linux) we must use
                                // the Lucene engine for `knn` fields since the Lucene engine is written in
                                // cross-platform Java code. Faiss is a native library which is only available
                                // for arm64 Linux in the OpenSearch distribution we run in development
                                // environments.
                                //
                                // We must use Faiss in production since it's the only engine that's supported
                                // by [OpenSearch serverless][1].
                                //
                                // NOTE(calebmer, 2025-05-13): After migrating off of OpenSearch serverless
                                // we're not forced to use Faiss in production anymore. But if OpenSearch
                                // serverless requires Faiss then that probably means it has the best
                                // performance? So we'll stick with it.
                                //
                                // [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-vector-search.html
                                ...(process.env.NODE_ENV !== "production" &&
                                (process.platform !== "linux" || process.arch !== "arm64")
                                    ? {
                                          engine: "lucene",
                                          parameters: {ef_construction: 100, m: 16},
                                      }
                                    : {
                                          engine: "faiss",

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
                                          // [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/knn-methods-engines/#hnsw-parameters-1
                                          // [2]: https://www.pinecone.io/learn/series/faiss/hnsw/
                                          parameters: {
                                              ef_search: 100,
                                              ef_construction: 100,
                                              m: 16,
                                              // Halve the size of our index by compressing dimensions to 16-bit floats.
                                              // This technique has been shown to provide significant storage savings without
                                              // sacrificing query accuracy.
                                              //
                                              // See a comparison of quantization techniques here:
                                              // https://aws.amazon.com/blogs/big-data/cost-optimized-vector-database-introduction-to-amazon-opensearch-service-quantization-techniques/
                                              //
                                              // See the documentation for fp16 scalar quantization here:
                                              // https://docs.opensearch.org/docs/latest/vector-search/optimizing-storage/faiss-16-bit-quantization/
                                              // https://opensearch.org/blog/optimizing-opensearch-with-fp16-quantization/
                                              encoder: {
                                                  name: "sq",
                                                  parameters: {
                                                      type: "fp16",
                                                      clip: true,
                                                  },
                                              },
                                          },
                                      }),
                            },
                        })
                            .nullable()
                            // Make sure we can access the vectors we generate from our language
                            // model. In case we need to reindex without asking language models
                            // for embeddings again.
                            .store()
                    );
                },
            ),
        }),
    },

    // NOTE(calebmer, 2025-04-14): Originally, embedding chunks were represented
    // with an OpenSearch `nested` field. Nested OpenSearch fields index each
    // object as a separate internal doc under-the-hood. What's really nice about a
    // nested field is we can update all the child docs atomically. The thing is,
    // once we migrated to AWS OpenSearch Serverless we learned their vector search
    // collection type doesn't support insert and update by a custom doc ID. You
    // must use OpenSearch's automatically generated IDs!
    //
    // > For time series and vector search collections, you can't index by custom
    // > document ID or update by upsert requests. This operation is reserved for
    // > search use cases.
    //
    // ([Source][1])
    //
    // Our new approach uses the `/_search` endpoint to find all chunks for a
    // provided `entityId` and inserts/deletes new/old chunks. So we don't need to
    // use the nested field anymore. Which is good, there are performance dangers
    // to OpenSearch nested fields ([good blog post on one company's journey][2]).
    // Since OpenSearch has to perform joins at query time.
    //
    // However, we do see recommendations around the internet for [using nested
    // docs for chunks][3]. Furthermore, it would appear like Lucene understands
    // this is an important use case and is building optimizations for it ([PR
    // optimizing joins with k-NN in Lucene][4] which OpenSearch/ElasticSearch use
    // under-the-hood, [blog post explaining the PR][5]). Though since we have to
    // use the Faiss k-NN engine with OpenSearch Serverless, Lucene optimizations
    // don't matter.
    //
    // [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html
    // [2]: https://www.gojek.io/blog/elasticsearch-the-trouble-with-nested-documents
    // [3]: https://www.elastic.co/search-labs/blog/articles/chunking-via-ingest-pipelines
    // [4]: https://github.com/apache/lucene/pull/12434
    // [5]: https://www.elastic.co/search-labs/blog/articles/adding-passage-vector-search-to-lucene
    //
    // NOTE(calebmer, 2025-05-13): So, OpenSearch Serverless was a bad choice.
    // Crucially, [`GET /<index>/_doc/<id>`][6] with `realtime=true` (the default!)
    // in AWS OpenSearch Serverless does not return the latest indexed document.
    // Instead it returns the document from the last refresh. We depend on
    // `realtime=true` returning the latest document (with the latest version
    // number) for updating OpenSearch documents with optimistic concurrency
    // control in the `tasks`/`task_collections` index
    // (`indexTaskActionTransactionAssumingItsCommitted()`) and the
    // `search_entity_keywords` index (`processIndexSearchEntityJob()`). This is so
    // critical to the design of our system that it's a blocker for using AWS
    // OpenSearch Serverless. So we're migrating back to regular AWS OpenSearch
    // Service.
    //
    // However, we're keeping the new `search_entity_embedding_chunks` index
    // structure. Where instead of one `nested` document per entity we have a
    // separate document per chunk. Initially we made this migration because vector
    // search indexes don't allow custom document IDs. We're sticking with this
    // approach since it has some advantages over our previous approach. For one,
    // the `nested` field has some performance downsides ([source][2]). But mainly,
    // we index embedding chunk changes at a slower rate than we index keyword
    // changes. Indexing embedding chunks is an inherently more expensive operation:
    //
    // 1. The HNSW index is expensive to rebuild. This is manifested in a slow
    //    refresh interval.
    //
    // 2. It costs money to ask our language model for new embeddings. So we
    //    shouldn't ask for new embeddings every time we reindex an entity's
    //    keywords. It's good to wait a bit for all entity updates to occur before
    //    we re-embed.
    //
    // [6]: https://docs.opensearch.org/docs/latest/api-reference/document-apis/get-documents/
});
