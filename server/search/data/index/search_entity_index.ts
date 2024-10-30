import murmurhash from "murmurhash";
import {authorizeInternalAccess} from "~/server/accounts/accounts_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getChannelIfPossible} from "~/server/forum/data/forum_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {
    OpensearchClient,
    OpensearchClientDocWithIdAndVersion,
    OpensearchGetDocWithoutSourceCommand,
    OpensearchIndexDocIfVersionCommand,
} from "~/server/opensearch/opensearch_client.js";
import {
    OpensearchIndex,
    OpensearchIndexFlattenedKeysType,
} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {
    OpensearchQueryClause,
    OpensearchQueryValue,
} from "~/server/opensearch/opensearch_query_clause.js";
import {IndexSearchEntityJobDescription} from "~/server/search/core/index_search_entity_job_description.js";
import {SearchEntityDependencyId} from "~/server/search/core/search_entity_dependency_id.js";
import {getSearchEntityDependencyIdsAffectedByUpdate} from "~/server/search/core/search_entity_update.js";
import {getSearchEntity} from "~/server/search/data/index/internal/get_search_entity.js";
import {parseSearchContent} from "~/server/search/data/index/internal/parse_search_content.js";
import {parseSearchNaturalLanguageQuery} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {
    SearchEntityIndexDefaultGrantType,
    SearchEntityIndexDefaultGrantTypeIntegerMapping,
    SearchEntityKeywordIndexDoc,
    SearchEntityKeywordIndexDocType,
    SearchEntitySemanticIndexDoc,
    SearchEntitySemanticIndexDocType,
    SearchEntitySemanticIndexEmbeddingChunk,
} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {SearchEntityMedia} from "~/server/search/data/index/internal/search_entity_media.js";
import {
    SearchSessionActionContext,
    SearchSessionActionContextModules,
    SearchSystemActionContextModules,
} from "~/server/search/data/index/search_action_context.js";
import {
    getPossiblyStaleChannelSearchAffinityIds,
    getPossiblyStaleTaskCollectionSearchAffinityIds,
    internalDangerouslyGetSpaceChannelSearchAffinities,
    internalDangerouslyGetSpaceTaskCollectionSearchAffinities,
    internalGetSearchAffinities,
} from "~/server/search/data/table/search_entity_table.js";
import {
    authorizeSpaceAccess,
    getAccount,
    getSpaceAccountNameSearchIndex,
} from "~/server/spaces/spaces_table.js";
import {
    getTaskCollectionSearchResultBodyTextSnippetIfPossible,
    getTaskCollectionSearchResultIfExists,
} from "~/server/tasks/data/task_table.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {
    printContentSingleLineTextSnippet,
    printContentSingleLineTextSnippetPreservingMarks,
} from "~/shared/content/print_content_single_line_text_snippet.js";
import {Context} from "~/shared/context/context.js";
import {formatPrettyRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_relative_date_without_full_time_tooltip.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {
    defaultUncertaintyWindowMs,
    isDateDefinitelyLessThanWithUncertaintyWindow,
} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {
    SearchEntityId,
    parseSearchEntityId,
    printSearchEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchOptions, standardSearchOptions} from "~/shared/search/search_options.js";
import {SearchResult, SearchResultMedia} from "~/shared/search/search_result.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * The search index should be near realtime to serve search requests. However,
 * there's already some delay because entities are indexed in a background job.
 * To improve indexing performance we can afford to slow down the refresh
 * interval a bit.
 */
const searchEntityIndexRefreshIntervalSeconds = 3;

/**
 * Our "search entity index" is actually two OpenSearch indexes.
 * `SearchEntityKeywordIndex` and `SearchEntitySemanticIndex`.
 *
 * - `SearchEntityKeywordIndex` indexes the entity for keyword search. The
 *   entire document body and title is put into a text reverse index so we can
 *   quickly find the documents containing a word.
 *
 * - `SearchEntitySemanticIndex` indexes the entity for semantic search. The
 *   document body is split into chunks and sent to our language model
 *   ([Cohere][1] in production) for embedding. The returned embedding vectors
 *   are stored in an HNSW graph.
 *
 * Why do we keep these two indexes separate? A search entity is represented by
 * a single doc. The reason: isolation. Isolation makes sure the performance of
 * one doesn't affect the other. We want keyword search to be really fast, we
 * don't want embedding data slowing keyword search/indexing down. We're ok
 * with semantic search being a little slower.
 *
 * Even if the data for both keyword search and semantic search were in the
 * same index, we still need to issue two separate queries and merge the
 * results out of OpenSearch. Since OpenSearch provides no means to merge the
 * query results. Even if it did, because keyword search is faster we probably
 * want to execute the queries separately anyway so we can return a response to
 * the user faster. Isolation then feels useful in case semantic search is slow
 * or failing then keyword search will be unaffected.
 *
 * Separating the two indexes also allows us to use [index sorting][2] for the
 * keyword index. (The semantic index uses a `nested` field which doesn't work
 * with index sorting.) Index sorting is an [important optimization][3] for
 * queries that filter to a `SpaceId` since we can skip scanning entire Lucene
 * internal segments that don't match the `SpaceId`.
 *
 * [1]: https://cohere.com
 * [2]: https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html
 * [3]: https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
 */
// IMPORTANT: Don't export this. All access to the index should be exposed
// through functions in this file. Like how we organize DynamoDB tables. By
// putting all the logic around this index in one file it allows developers to
// carefully control how data is written to this index. Instead of updates
// sprawling out around the codebase.
const SearchEntityKeywordIndex = new OpensearchIndex<
    SpaceId,
    SearchEntityId,
    OpensearchIndexTypeType<typeof SearchEntityKeywordIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof SearchEntityKeywordIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityKeywordIndexDocType>
>(SearchEntityKeywordIndexDocType, {
    name: "search_entity_keywords",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: `${searchEntityIndexRefreshIntervalSeconds}s`,

    // Basically every query to this index will filter to a specific `SpaceId`. We
    // may have specialized queries (e.g. account name auto-complete) that filter
    // to a specific entity `type` as well.
    sort: [{field: "spaceId"}, {field: "type"}],

    // Disabling the source field is dangerous! It saves disk space but disables
    // a lot of useful features. From the [ElasticSearch docs][1]:
    //
    // 1. The `update`, `update_by_query`, and `reindex` APIs.
    // 2. On the fly highlighting.
    // 3. The ability to reindex from one ElasticSearch index to another, either
    //    to change mappings or analysis, or to upgrade an index to a new major
    //    version.
    // 4. The ability to debug queries or aggregations by viewing the original
    //    document used at index time.
    // 5. Potentially in the future, the ability to repair index corruption
    //    automatically.
    //
    // For 3 and 5 we can reindex by scanning our source tables for search
    // entities. This is probably safer than reindexing based on what's in
    // OpenSearch.
    //
    // For 1 all we need is some stored fields (like `version`) to perform updates
    // in application code.
    //
    // For 4 we don't have a great alternative. We'll need to find other means of
    // debugging.
    //
    // For 2 we believe highlighting should still work if the field we're
    // highlighting is a stored field. Highlighting is the main feature we must
    // keep.
    //
    // Given how big the search index will be, we believe the space savings of not
    // storing the `_source` field will be important for us.
    //
    // [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-source-field.html#disable-source-field
    disableSourceField: true,
});

// IMPORTANT: Don't export this. All access to the index should be exposed
// through functions in this file. Like how we organize DynamoDB tables. By
// putting all the logic around this index in one file it allows developers to
// carefully control how data is written to this index. Instead of updates
// sprawling out around the codebase.
const SearchEntitySemanticIndex = new OpensearchIndex<
    SpaceId,
    SearchEntityId,
    OpensearchIndexTypeType<typeof SearchEntitySemanticIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof SearchEntitySemanticIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntitySemanticIndexDocType>
>(SearchEntitySemanticIndexDocType, {
    name: "search_entity_semantics",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: `${searchEntityIndexRefreshIntervalSeconds}s`,

    // We use the `nested` mapping type and index sorting at the same time.
    sort: [],

    // We disable the source field here for the same reasoning as
    // `SearchEntityKeywordIndex`. It's particularly important we disable the
    // source field here since we duplicate the `accessPolicy` in every nested
    // document. It would be inefficient to store the full source.
    disableSourceField: true,
});

// Double check we've only stored fields we need.
assertEqualTypes<
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityKeywordIndexDocType>,
    {
        createdTime: Date;
        lastUpdatedTime: Date;
        "accessPolicy.accountGrantAccountIds": AccountId;
        "accessPolicy.defaultGrantType": SearchEntityIndexDefaultGrantType;
        lastReadStartTime: Date;
        title: string;
        body: string;
        media: SearchEntityMedia;
    }
>();

// Double check we've only stored fields we need.
assertEqualTypes<
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntitySemanticIndexDocType>,
    {
        lastReadStartTime: Date;
        title: string;
        media: SearchEntityMedia;
        "embeddingChunks.text": string;
        "embeddingChunks.preambleEndIndex": number;
        "embeddingChunksVectorCache.allMiniLmL6V2": ReadonlyMap<number, ReadonlyArray<number>>;
        "embeddingChunksVectorCache.cohereEmbedEnglishV3": ReadonlyMap<
            number,
            ReadonlyArray<number>
        >;
    }
>();

/**
 * Allow using the search entity indexes directly in Jest unit tests.
 */
export function getSearchEntityIndexesForTest() {
    assert(import.meta.jest);
    return {SearchEntityKeywordIndex, SearchEntitySemanticIndex};
}

/**
 * Deploy our search indexes to production.
 *
 * May only be called in a production environment. Should only be called by our
 * deployment scripts.
 */
export async function deploySearchEntityIndexes(tracer: TracerBase, client: OpensearchClient) {
    assert(process.env.NODE_ENV === "production");

    await runAllPromises([
        client.deployIndex(tracer, SearchEntityKeywordIndex),
        client.deployIndex(tracer, SearchEntitySemanticIndex),
    ]);
}

/**
 * The minimum number of tokens a chunk needs for us to embed it.
 *
 * It's wasteful to embed small messages like "Nice!" or "Ok!". Embeddings of
 * small content can also pollute search results as they may be a closer topic
 * match to a search query but do not include detail the user wants to see.
 * [Cohere's v3 embedding models][1] (which we use in production) defend
 * against this by considering the content's quality, but it's still good for
 * us to throw out chunks without important meaning.
 *
 * Small chunks can still be found with keyword search.
 *
 * How we pick this value: We want embedding chunks to have more than two
 * sentences worth of content. Sentences are usually between 15-20 words
 * ([source][2]) and a word is typically 1-3 tokens ([source][3]). This means
 * two sentences most of the time fall in the range of 15-60 tokens. 35 is a
 * nice round number near the middle of this range.
 *
 * [1]: https://txt.cohere.com/introducing-embed-v3/
 * [2]: https://languagetool.org/insights/post/sentence-length
 * [3]: https://docs.cohere.com/docs/tokens
 */
const minEmbeddingChunkTokenCount = 35;

export const processSearchEntityJobFinishedTestCheckpoint = new TestCheckpoint<SearchEntityId>();

export const processSearchEntityJobUpdateDependentEntitiesTestCounter =
    new TestCounter<SearchEntityDependencyId>();

/**
 * Indexes any entity in our system, making its content available for
 * searching. This function is idempotent, running it multiple times will
 * produce the same result.
 *
 * All searchable objects in our system can be converted to a `SearchEntity`
 * object. Which includes the object's text content, dependencies, and access
 * policy (for evaluating permissions). You also split the object's text
 * content into chunks of reasonable size for our language model to embed to
 * a vector representation. In production we use [Cohere][1] for embeddings. In
 * development we use a small model that's not very good but can run on a
 * personal computer.
 *
 * Our indexing steps are as follows:
 *
 * 1. Convert the object into a `SearchEntity`
 * 2. Embed new chunks from the `SearchEntity` with our language model
 * 3. Save the `SearchEntity` to both our search indexes
 *    (`SearchEntityKeywordIndex` and `SearchEntitySemanticIndex`)
 * 4. Find all other entities that depend on our `SearchEntity`, queue indexing
 *    jobs for all these dependent entities
 *
 * The guarantee provided by this function is: If this function completes
 * successfully, any updates committed before the time the job was queued
 * (`jobSendTime`) will be reflected in the search index.
 *
 * Make sure you only queue an indexing job AFTER you've committed your update.
 * Otherwise it may not be read by the job. Some notes on consistency:
 *
 * - When reading from DynamoDB, we make sure to use strong read consistency to
 *   guarantee we read the latest committed data.
 *
 * - For a system like tasks, we read from `TaskRealtimeService` which
 *   maintains up-to-date task object representations. That means we need to
 *   wait for actions to be applied in `TaskRealtimeService` before we can queue
 *   an indexing job. If we try to queue an indexing job after actions
 *   are committed to `TaskActionTable` and before they're applied in
 *   `TaskRealtimeService` we may miss some updates while indexing since we read
 *   from `TaskRealtimeService`.
 *
 * [1]: https://cohere.com
 */
export async function processIndexSearchEntityJob(
    context: Context<
        SearchSystemActionContextModules & {
            /**
             * A language model is optional in unit tests. But must be provided in
             * production and local developer environments.
             */
            languageModel?: LanguageModelContextModule;
        }
    >,
    job: IndexSearchEntityJobDescription,
    jobStartTime: Date,
) {
    const entityId = printSearchEntityId(job.update);

    await runAllPromises([updateOurEntity(), updateDependentEntities()]);

    await processSearchEntityJobFinishedTestCheckpoint.waitForTest(entityId);

    async function updateOurEntity() {
        await retryWithExponentialBackoff(async retry => {
            const [actualOldDocForKeywordIndex, actualOldDocForSemanticIndex] =
                await context.opensearch.multiGetDocsIfExist([
                    new OpensearchGetDocWithoutSourceCommand(
                        SearchEntityKeywordIndex,
                        job.spaceId,
                        entityId,
                        {storedFields: ["lastUpdatedTime", "lastReadStartTime"]},
                    ),
                    new OpensearchGetDocWithoutSourceCommand(
                        SearchEntitySemanticIndex,
                        job.spaceId,
                        entityId,
                        {
                            storedFields: [
                                "lastReadStartTime",
                                ...(context.languageModel
                                    ? [
                                          `embeddingChunksVectorCache.${context.languageModel.model.statics.key}` as const,
                                      ]
                                    : []),
                            ],
                        },
                    ),
                ]);

            const oldDocForKeywordIndex = actualOldDocForKeywordIndex
                ? {
                      version: actualOldDocForKeywordIndex.version,
                      lastUpdatedTime: assertExists(
                          actualOldDocForKeywordIndex.fields.lastUpdatedTime?.[0],
                      ),
                      lastReadStartTime: assertExists(
                          actualOldDocForKeywordIndex.fields.lastReadStartTime?.[0],
                      ),
                  }
                : null;

            const oldDocForSemanticIndex = actualOldDocForSemanticIndex
                ? {
                      version: actualOldDocForSemanticIndex.version,
                      embeddingChunksVectorCache: context.languageModel
                          ? actualOldDocForSemanticIndex.fields[
                                `embeddingChunksVectorCache.${context.languageModel.model.statics.key}`
                            ]?.[0] ?? null
                          : null,
                      lastReadStartTime:
                          actualOldDocForSemanticIndex.fields.lastReadStartTime?.[0] ?? null,
                  }
                : null;

            // Is the doc currently in the search index sufficient for this indexing job?
            // If true we can end the job without needing to save `newDoc` to the index.
            //
            // It is sufficient if the data in the index was read AFTER the job was sent to
            // our queue. That means `oldDoc` includes the update our job wants to index.
            //
            // Useful optimization when there are multiple updates to the same entity being
            // processed in parallel. Or when jobs updating the same entity are delayed.
            //
            // We only need to check the keyword doc. If the keyword doc is sufficient then
            // the job which indexed it should have also indexed an embedding doc. If it
            // did not index an embedding doc, either an embedding doc doesn't exist or
            // there was an error and the job will be retried.
            const isOldDocSufficient =
                (!!oldDocForKeywordIndex &&
                    isDateDefinitelyLessThanWithUncertaintyWindow(
                        // Optimization: If one of our dependencies updated (and we ourselves were not
                        // updated) then a job will be queued with `parentJobStartTime`.
                        // For these jobs, as long as we've indexed data that was read after our parent
                        // job's start we're happy (since our parent job represents the entity with
                        // updates).
                        //
                        // It should be logically ok to use `jobStartTime` here but we can skip more
                        // reads by using `parentJobStartTime`.
                        job.parentJobStartTime ?? jobStartTime,
                        oldDocForKeywordIndex.lastReadStartTime,
                    )) ||
                (!!oldDocForSemanticIndex &&
                    oldDocForSemanticIndex.lastReadStartTime !== null &&
                    isDateDefinitelyLessThanWithUncertaintyWindow(
                        // See above comment for why we use `job.parentJobStartTime`.
                        job.parentJobStartTime ?? jobStartTime,
                        oldDocForSemanticIndex.lastReadStartTime,
                    ));

            if (isOldDocSufficient) return;

            // We use the Cohere `embed-english-v3.0` model's tokenizer to chunk our
            // content. That's because it's the main model we use in production for
            // embeddings. In development we embed with a smaller model we can run locally
            // (`all-MiniLM-L6-v2`) but we standardize on Cohere's ideal chunk size to make
            // debugging chunk generation easier.
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const readStartTime = new Date();
            const {dependencyIds, entity} = await getSearchEntity(context, job.update, tokenizer);

            // We don't want to embed small messages like "Ok!" so filter out chunks
            // without much content.
            //
            // When seeing if this chunk is too small for embedding, we ignore the preamble
            // added for context. We only want to measure the content's tokens.
            const embeddingChunksWithoutVectors = entity.embeddingChunks.filter(embeddingChunk => {
                return embeddingChunk.tokenCountWithoutPreamble >= minEmbeddingChunkTokenCount;
            });

            let embeddingChunks: Array<SearchEntitySemanticIndexEmbeddingChunk>;
            let embeddingChunksVectorCache: Map<number, ReadonlyArray<number>> | null;

            if (!context.languageModel) {
                // Must provide a language model in the system context everywhere except Jest
                // unit tests. Since the language model can be big, we allow unit tests to
                // exclude the language model from their runfiles.
                if (!import.meta.jest) {
                    throw new InternalError("Missing language model in context");
                }

                embeddingChunks = [];
                embeddingChunksVectorCache = null;
            } else if (embeddingChunksWithoutVectors.length === 0) {
                // Optimization: This entity doesn't have any embedding chunks. Don't do any
                // embedding generation.
                embeddingChunks = [];
                embeddingChunksVectorCache = null;
            } else {
                const embeddingChunkByIndex = new Map<
                    number,
                    SearchEntitySemanticIndexEmbeddingChunk
                >();
                const embeddingChunksNeedingNewVectors = [];

                embeddingChunks = [];
                embeddingChunksVectorCache = new Map();

                for (let index = 0; index < embeddingChunksWithoutVectors.length; index++) {
                    const embeddingChunk = embeddingChunksWithoutVectors[index]!;
                    const embeddingChunkTextHash = murmurhash.v3(embeddingChunk.text);

                    const cachedEmbeddingVector =
                        oldDocForSemanticIndex?.embeddingChunksVectorCache?.get(
                            embeddingChunkTextHash,
                        );

                    if (!cachedEmbeddingVector) {
                        embeddingChunksNeedingNewVectors.push({
                            index,
                            preambleEndIndex: embeddingChunk.preambleEndIndex,
                            text: embeddingChunk.text,
                            textHash: embeddingChunkTextHash,
                        });
                    } else {
                        embeddingChunkByIndex.set(index, {
                            spaceId: job.spaceId,
                            accessPolicy: entity.accessPolicy,
                            preambleEndIndex: embeddingChunk.preambleEndIndex,
                            text: embeddingChunk.text,
                            vector: {
                                allMiniLmL6V2: null,
                                cohereEmbedEnglishV3: null,
                                [context.languageModel.model.statics.key]: cachedEmbeddingVector,
                            },
                        });

                        embeddingChunksVectorCache.set(
                            embeddingChunkTextHash,
                            cachedEmbeddingVector,
                        );
                    }
                }

                const embeddingVectors =
                    embeddingChunksNeedingNewVectors.length > 0
                        ? Array.from(
                              await context.languageModel.model.embed(
                                  context.tracer.getTracer(),
                                  embeddingChunksNeedingNewVectors.map(({text}) => text),
                                  {inputType: "SearchDocument"},
                              ),
                          )
                        : [];

                for (
                    let otherIndex = 0;
                    otherIndex < embeddingChunksNeedingNewVectors.length;
                    otherIndex++
                ) {
                    const embeddingChunk = embeddingChunksNeedingNewVectors[otherIndex]!;
                    const embeddingVector = Array.from(embeddingVectors[otherIndex]!);

                    embeddingChunkByIndex.set(embeddingChunk.index, {
                        spaceId: job.spaceId,
                        accessPolicy: entity.accessPolicy,
                        preambleEndIndex: embeddingChunk.preambleEndIndex,
                        text: embeddingChunk.text,
                        vector: {
                            allMiniLmL6V2: null,
                            cohereEmbedEnglishV3: null,
                            [context.languageModel.model.statics.key]: embeddingVector,
                        },
                    });

                    embeddingChunksVectorCache.set(embeddingChunk.textHash, embeddingVector);
                }

                // Through this process we should have created an embedding chunk object for
                // every item in `embeddingChunksWithoutVectors`. Either:
                //
                // 1. Because we have a cached embedding
                // 2. We requested a new embedding from our language model
                embeddingChunks = createArrayWithLength(
                    embeddingChunksWithoutVectors.length,
                    index => assertExists(embeddingChunkByIndex.get(index)),
                );
            }

            // The new updated time should:
            //
            // - Always be bigger than `createdTime`
            // - Always be bigger than the last `lastUpdatedTime`
            // - Use `jobStartTime` since that more accurately represents when the update
            //   happened rather than the current time (since the job may have been
            //   delayed)
            const newLastUpdatedTime = new Date(
                Math.max(
                    ...[
                        entity.createdTime.getTime(),
                        ...(oldDocForKeywordIndex
                            ? [oldDocForKeywordIndex.lastUpdatedTime.getTime()]
                            : []),
                        // We don't update `lastUpdatedTime` to the latest time if there are no updated
                        // traits. Which happens when creating entities, re-indexing an entity after a
                        // dependency changed, and indexes triggered by a migration.
                        //
                        // If `updatedTraits` is `None` that means the underlying entity didn't
                        // actually update and we're indexing for some other reason.
                        ...(job.update.updatedTraits.type !== "None"
                            ? [jobStartTime.getTime()]
                            : []),
                    ],
                ),
            );

            const majorContributorIds = new Set<AccountId>();
            const anyContributorIds = new Set<AccountId>();

            if (entity.creatorId !== null) {
                majorContributorIds.add(entity.creatorId);
                anyContributorIds.add(entity.creatorId);
            }

            for (const [contributorId, type] of entity.contributorIds) {
                if (type === "Major") {
                    majorContributorIds.add(contributorId);
                    anyContributorIds.add(contributorId);
                } else {
                    anyContributorIds.add(contributorId);
                }
            }

            const newDocForKeywordIndex: OpensearchClientDocWithIdAndVersion<
                SearchEntityId,
                SearchEntityKeywordIndexDoc
            > = {
                id: entityId,
                version: oldDocForKeywordIndex?.version ?? null,
                spaceId: job.spaceId,
                type: job.update.type,
                createdTime: entity.createdTime,
                lastUpdatedTime: newLastUpdatedTime,
                lastReadStartTime: readStartTime,
                accessPolicy: entity.accessPolicy,
                dependencyIds: Array.from(dependencyIds),
                title: entity.title,
                body: entity.body,
                media: entity.media,
                creatorId: entity.creatorId,
                majorContributorIds: Array.from(majorContributorIds),
                anyContributorIds: Array.from(anyContributorIds),
            };

            const newDocForSemanticIndex: OpensearchClientDocWithIdAndVersion<
                SearchEntityId,
                SearchEntitySemanticIndexDoc
            > = {
                id: entityId,
                version: oldDocForSemanticIndex?.version ?? null,
                lastReadStartTime: readStartTime,
                title: entity.title,
                media: entity.media,
                embeddingChunks,
                embeddingChunksVectorCache: {
                    allMiniLmL6V2: null,
                    cohereEmbedEnglishV3: null,
                    ...(context.languageModel
                        ? {[context.languageModel.model.statics.key]: embeddingChunksVectorCache}
                        : {}),
                },
            };

            // If the doc has never had embedding chunks and still doesn't have embedding
            // chunks, we don't write the embedding doc to our index. Once the embedding
            // doc is created the first time we don't delete it, instead updating it to an
            // empty list of embedding chunks.
            //
            // If we get a version conflict then some other concurrent process wrote this
            // search entity before us. We retry and completely re-read the entity. That
            // way we guarantee we aren't overwriting new data (read by the other job) with
            // old data (read by this job).
            if (!oldDocForSemanticIndex && newDocForSemanticIndex.embeddingChunks.length === 0) {
                await context.opensearch.indexDocIfVersion(
                    SearchEntityKeywordIndex,
                    job.spaceId,
                    newDocForKeywordIndex,
                    {retryVersionConflictError: retry},
                );
            } else {
                await context.opensearch.bulk(
                    [
                        new OpensearchIndexDocIfVersionCommand(
                            SearchEntityKeywordIndex,
                            job.spaceId,
                            newDocForKeywordIndex,
                        ),
                        new OpensearchIndexDocIfVersionCommand(
                            SearchEntitySemanticIndex,
                            job.spaceId,
                            newDocForSemanticIndex,
                        ),
                    ],
                    {retryPartialVersionConflictError: retry},
                );
            }
        });
    }

    async function updateDependentEntities() {
        const dependencyIds = getSearchEntityDependencyIdsAffectedByUpdate(job.update);
        if (dependencyIds.length === 0) return;

        for (const dependencyId of dependencyIds) {
            processSearchEntityJobUpdateDependentEntitiesTestCounter.incrementForTest(dependencyId);
        }

        // Wait for the index to refresh before querying dependents. We want to capture
        // ALL dependents created before the job started. There may be some dependents
        // another job saved that won't appear in a query until after the index
        // refreshes.
        //
        // We may capture some dependents that were recently updated and have the
        // latest dependency data. That's ok since this function is idempotent. We may
        // be able to skip re-reading them by checking `lastReadStartTime`.
        if (!import.meta.jest) {
            await wait(searchEntityIndexRefreshIntervalSeconds * 1000 + defaultUncertaintyWindowMs);
        } else {
            // In Jest tests, indexes need to be refreshed manually. Don't refresh manually
            // in production.
            await context.opensearch.refresh(SearchEntityKeywordIndex);
        }

        // Maximum search page size is 10k.
        const searchSize = 10_000;
        let searchAfter: ReadonlyArray<JsonValue> | null = null;

        do {
            const {hits} = await context.opensearch.searchWithoutSource(
                SearchEntityKeywordIndex,
                job.spaceId,
                {
                    size: searchSize,

                    query: {
                        bool: {
                            filter: {
                                bool: {
                                    must: [
                                        {
                                            term: {
                                                spaceId: new OpensearchQueryValue(job.spaceId),
                                            },
                                        },
                                        {
                                            terms: {
                                                dependencyIds: new OpensearchQueryValue(
                                                    dependencyIds,
                                                ),
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    sort: ["_doc"],
                },
            );

            await runAllPromises(
                hits.map(async hit => {
                    // Confirm the job was added to the queue before exiting. It's ok to take the
                    // batch delay performance hit when processing jobs.
                    await context.jobs.sendAndWait({
                        type: "IndexSearchEntity",
                        spaceId: job.spaceId,
                        update: {
                            ...parseSearchEntityId(hit.id),
                            // Dependencies didn't update so we can skip reindexing transitive
                            // dependencies.
                            updatedTraits: {type: "None"},
                        },
                        parentJobStartTime: jobStartTime,
                    });
                }),
            );

            searchAfter = hits.length > 0 ? assertExists(hits[hits.length - 1]!.sort) : null;

            // If we did not reach the pagination limit then don't query again for the
            // next page.
            if (hits.length < searchSize) searchAfter = null;
        } while (searchAfter !== null);
    }
}

/**
 * Limit search query text length to avoid excessive resource usage.
 */
function assertSearchQueryTextLength(queryText: string) {
    if (queryText.length >= 140) {
        throw new InvalidArgumentError("Search query too long", {
            displayMessage: errorDisplayMessage`Your search text is too long. Try removing some words.`,
        });
    }
}

/**
 * Search for entities in a space by keyword. Returns entities that almost
 * exactly match the query text (some typos are tolerated). Entities with the
 * query text in their title or that match an exact phrase rank higher.
 *
 * This function only really works with queries containing complete words. It
 * doesn't support prefix matching of the last word which you'd need to build
 * type-ahead functionality.
 */
export async function searchByKeywords(
    context: SearchSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
        timeZone,
        currentTime,
        debugOptions,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
        timeZone: TimeZone;
        currentTime: Date;
        debugOptions?: SearchOptions;
    },
): Promise<{
    results: Array<SearchResult>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    assertSearchQueryTextLength(queryText);

    // You must have internal access to try different `debugOptions`. Setting
    // `debugOptions` not only lets you change search ranking but also enables
    // search result explanations. Search result explanations may include how
    // frequent a term is across all indexed OpenSearch documents! This is
    // sensitive information and can be used to breach private data. For example
    // "Apple acquires Netflix" might be a 3gram that appears once across all
    // documents telling you this phrase was included in some search entity you
    // can't access.
    if (debugOptions) {
        await authorizeInternalAccess(context);
    }

    const options = debugOptions ?? standardSearchOptions;

    const {queryTexts, controlQueryTexts, filters, isLowConfidence} =
        parseSearchNaturalLanguageQuery(queryText, {
            timeZone,
            currentTime,
            actorAccountId: context.actor.getAccountId(),
            accountNameIndex: await getSpaceAccountNameSearchIndex(context, spaceId),
        });

    type QueryClause = OpensearchQueryClause<
        OpensearchIndexFlattenedKeysType<typeof SearchEntityKeywordIndex>
    >;

    const createQueryTextClause = (
        boost: number,
        queryTexts: ReadonlyArray<string>,
    ): QueryClause | null => {
        const clauses = queryTexts.map(
            (queryText): QueryClause => ({
                bool: {
                    minimum_should_match: 1,

                    // If multiple clauses match then should will add together their scores.
                    //
                    // The more fields matched, the better!
                    //
                    // - If you match a shingle it will also implicitly match the main field.
                    //   So we get limited phrase matching.
                    // - Matches in title fields are boosted above matches in body fields.
                    should: [
                        {
                            multi_match: {
                                query: new OpensearchQueryValue(queryText),
                                type: "most_fields",
                                fields:
                                    boost === 1
                                        ? [`title^${options.titleBoost}`, "body"]
                                        : [`title^${options.titleBoost * boost}`, `body^${boost}`],

                                ...(queryText.length < 100
                                    ? {
                                          // Still match even if the query text has typos.
                                          //
                                          // We only fuzzy match short queries. For longer queries we run into the
                                          // OpenSearch max clause limit error.
                                          //
                                          // We only fuzzy match when searching the individual word index. This is
                                          // because fuzziness works by expanding a query to include valid terms within
                                          // edit distance. This risks running into the max clause count OpenSearch limit
                                          // when used excessively. So only allow exact matches when searching the 2gram
                                          // and 3gram fields. This also has the effect of a 2gram match + 1gram match
                                          // beating a rare typo (which would have a high score due to low document
                                          // frequency).
                                          fuzziness: "AUTO",
                                          // Require the first character to be correct for a fuzzy query to match. This
                                          // reduces the amount of fuzzy searching we need to do and also discards some
                                          // ridiculous fuzzy matches. For example, we see "my documents" get matched to
                                          // the 2gram "30 documents". For a 1gram "my" doesn't match "30" since
                                          // `fuzziness: "AUTO"` requires an exact match for two character strings.
                                          // However the 2gram "my documents" can have two edits which makes
                                          // "30 documents" a valid match. Also "be documents" or "of documents". A prefix
                                          // length of 1 prevents these from being valid matches.
                                          prefix_length: 1,
                                      }
                                    : {}),
                            },
                        },
                        {
                            multi_match: {
                                query: new OpensearchQueryValue(queryText),
                                type: "most_fields",
                                fields:
                                    boost === 1
                                        ? [
                                              `title._2gram^${options.titleBoost}`,
                                              `title._3gram^${options.titleBoost}`,
                                              "body._2gram",
                                              "body._3gram",
                                          ]
                                        : [
                                              `title._2gram^${options.titleBoost * boost}`,
                                              `title._3gram^${options.titleBoost * boost}`,
                                              `body._2gram^${boost}`,
                                              `body._3gram^${boost}`,
                                          ],
                            },
                        },
                    ],
                },
            }),
        );

        if (clauses.length === 0) return null;

        return clauses.length === 1
            ? clauses[0]!
            : // Use a disjunction max when we have multiple `queryText`s. Since the `match`
              // uses an "OR" operator not "AND". We want to use the best score across all
              // `queryText`s instead of adding the scores together.
              {dis_max: {queries: clauses}};
    };

    const queryTextClause = createQueryTextClause(1, queryTexts);

    const must: Array<QueryClause> = [];
    if (queryTextClause) must.push(queryTextClause);

    // Keep track of the fields we're using to filter by time. If we only filter by
    // updated time then let's use updated time to sort as well.
    const timeFilterFields = new Set<"Created" | "LastUpdated">();

    // If we parsed some filters using natural language, then add them to our
    // query. The filters are "OR"d together so we use a disjunction max query.
    if (controlQueryTexts.length > 0 || filters.length > 0) {
        const createTermQueryClause = (
            flattenedKey: OpensearchIndexFlattenedKeysType<typeof SearchEntityKeywordIndex>,
            values: ReadonlyArray<JsonValue>,
        ): QueryClause => {
            if (values.length === 1)
                return {term: {[flattenedKey]: new OpensearchQueryValue(values[0]!)}};

            return {terms: {[flattenedKey]: new OpensearchQueryValue(values)}};
        };

        const filterClauses = filters.map((filter): QueryClause => {
            const filterMust: Array<QueryClause> = [
                createTermQueryClause("type", filter.entityTypes),
            ];

            if (filter.account) {
                switch (filter.account.field) {
                    case "Creator": {
                        filterMust.push(createTermQueryClause("creatorId", filter.account.ids));
                        break;
                    }
                    case "MajorContributor": {
                        filterMust.push(
                            createTermQueryClause("majorContributorIds", filter.account.ids),
                        );
                        break;
                    }
                    case "AnyContributor": {
                        filterMust.push(
                            createTermQueryClause("anyContributorIds", filter.account.ids),
                        );
                        break;
                    }
                    default:
                        throw exhaustive(filter.account.field);
                }
            }

            if (filter.time) {
                timeFilterFields.add(filter.time.field);

                switch (filter.time.field) {
                    case "Created": {
                        filterMust.push({
                            range: {
                                createdTime: {
                                    gte: filter.time.range.inclusiveLowerBoundDate
                                        ? new OpensearchQueryValue(
                                              filter.time.range.inclusiveLowerBoundDate.toISOString(),
                                          )
                                        : undefined,
                                    lte: filter.time.range.inclusiveUpperBoundDate
                                        ? new OpensearchQueryValue(
                                              filter.time.range.inclusiveUpperBoundDate.toISOString(),
                                          )
                                        : undefined,
                                },
                            },
                        });
                        break;
                    }
                    case "LastUpdated": {
                        filterMust.push({
                            range: {
                                lastUpdatedTime: {
                                    gte: filter.time.range.inclusiveLowerBoundDate
                                        ? new OpensearchQueryValue(
                                              filter.time.range.inclusiveLowerBoundDate.toISOString(),
                                          )
                                        : undefined,
                                    lte: filter.time.range.inclusiveUpperBoundDate
                                        ? new OpensearchQueryValue(
                                              filter.time.range.inclusiveUpperBoundDate.toISOString(),
                                          )
                                        : undefined,
                                },
                            },
                        });
                        break;
                    }
                    default:
                        throw exhaustive(filter.time.field);
                }
            }

            return {
                constant_score: {
                    boost: isLowConfidence
                        ? options.naturalLanguage.filterConstantScoreIfLowConfidence
                        : options.naturalLanguage.filterConstantScore,
                    filter: {bool: {filter: filterMust}},
                },
            };
        });

        const controlQueryTextClause = createQueryTextClause(
            isLowConfidence
                ? options.naturalLanguage.controlMatchBoostIfLowConfidence
                : options.naturalLanguage.controlMatchBoost,
            controlQueryTexts,
        );

        must.push({
            dis_max: {
                queries: [
                    ...filterClauses,
                    ...(controlQueryTextClause ? [controlQueryTextClause] : []),
                ],
            },
        });
    }

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        explain: !!debugOptions,
        size: limit,
        storedFields: ["title", "media"],
        sort: [
            "_score",

            // Default to sorting by `createdTime` when scores are tied, but if we parse an
            // update time natural language filter then sort by update time.
            timeFilterFields.size === 0 || timeFilterFields.has("Created")
                ? {createdTime: {order: "desc", missing: "_last"}}
                : {lastUpdatedTime: {order: "desc", missing: "_last"}},

            "_doc",
        ],
        query: {
            bool: {
                must,

                // Use filter context to only match content the user is allowed to see. The
                // content must be in our space and must grant access to the account. Either
                // directly or through a default grant.
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                {
                                    term: {
                                        "accessPolicy.accountGrantAccountIds":
                                            new OpensearchQueryValue(context.actor.getAccountId()),
                                    },
                                },
                                {
                                    term: {
                                        "accessPolicy.defaultGrantType": new OpensearchQueryValue(
                                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                "Space",
                                            ),
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        highlight: {
            type: "unified",
            // Split the text at sentences for highlighting. That way the highlighted
            // previews are complete thoughts for the user to read.
            boundary_scanner: "sentence",
            boundary_scanner_locale: "en-US",
            // Return only the one best fragment. Given we use a sentence boundary this
            // should be a nice readable snippet.
            number_of_fragments: 1,
            order: "score",
            // We want to show two sentences of content for search results. Given fragments
            // are created at sentence boundaries that means we need enough characters to
            // cover at least two sentences. We discovered that p95 sentence length is 260
            // by analyzing ~500,000 sentences in the [GoodWiki dataset][1].
            //
            // [1]: https://huggingface.co/datasets/euirim/goodwiki
            fragment_size: 260 * 2,
            no_match_size: 260 * 2,
            fields: {
                // We only highlight `body`. The entire `title` is generally returned as part
                // of the search entity.
                body: {},
            },
        },
    });

    const results = await runAllPromises(
        hits.map(async (hit): Promise<SearchResult> => {
            // The highlighted body text we get from OpenSearch is markdown formatted with
            // `<em>` tags inserted where we need to highlight. To get this in a format we
            // can render:
            //
            // 1. Parse the Markdown back to a ProseMirror node
            // 2. Print the ProseMirror node to a single line of text
            let rawBodyTextSnippet = hit.highlight?.body?.[0];

            // NOTE(calebmer): I've found sometimes OpenSearch returns text that starts
            // like this: ". Cultural references. The overall plot is a reference...". Note
            // the ". " at the beginning of the string. This seems to me like confused
            // sentence boundary scanning. Since having terminal punctuation at the
            // beginning of our body text snippet is almost never useful, remove it.
            rawBodyTextSnippet = rawBodyTextSnippet?.replace(/^\p{Sentence_Terminal}\s*/u, "");

            const bodySnippet = rawBodyTextSnippet
                ? parseSearchContent(rawBodyTextSnippet, {
                      shouldParseEmphasisHtmlTagAsHighlight: true,
                  })
                : null;

            let bodyTextSnippet = bodySnippet
                ? printContentSingleLineTextSnippetPreservingMarks(
                      {doc: bodySnippet, references: emptyContentReferences},
                      mark => mark.type.name === "highlight",
                  ).map(segment => ({isHighlighted: segment.marks.length > 0, text: segment.text}))
                : emptyArray;

            const docMedia = hit.fields.media?.[0];

            const resultMedia =
                docMedia?.type === "TaskCollectionColor"
                    ? docMedia
                    : docMedia
                    ? await prepareSearchEntityMediaForResult(context, spaceId, hit.id, docMedia)
                    : null;

            // If this hit is for a task collection then we'll include, as the search
            // result body, a summary of how many tasks are in the collection and when the
            // collection was last updated. This is helpful for a user comparing multiple
            // task collections with the same name.
            //
            // We don't have this logic in `searchByAffinity()` since task collections
            // shouldn't appear in affinity search.
            if (hit.id.startsWith("TaskCollection:") && bodyTextSnippet.length === 0) {
                const taskCollectionBodyTextSnippet =
                    await getTaskCollectionSearchResultBodyTextSnippetIfPossible(
                        context,
                        assertId<TaskCollectionId>(hit.id.slice(15)),
                        timeZone,
                        currentTime,
                    );

                if (taskCollectionBodyTextSnippet !== null) {
                    bodyTextSnippet = [{text: taskCollectionBodyTextSnippet, isHighlighted: false}];
                }
            }

            return {
                id: hit.id,
                score: hit.score,
                title: hit.fields.title?.[0] ?? null,
                bodyTextSnippet,
                media: resultMedia,
                explanation: hit.explanation
                    ? enrichOpensearchSearchHitExplanation(hit.explanation)
                    : undefined,
            };
        }),
    );

    return {results};
}

function enrichOpensearchSearchHitExplanation(
    explanation: OpensearchSearchHitExplanation,
): OpensearchSearchHitExplanation {
    // If we have a `ConstantScore` in our explanation the means we parsed a
    // natural language filter from the query text and the natural language filter
    // matched!
    //
    // We only use constant score queries for natural language filters currently.
    if (/ConstantScore/i.test(explanation.description)) {
        return {
            value: explanation.value,
            description: "\u2699\uFE0F natural language filter match:",
            details: [explanation],
        };
    }

    let hasChildExplanationChanged = false;

    const newChildExplanations = explanation.details.map(childExplanation => {
        const newChildExplanation = enrichOpensearchSearchHitExplanation(childExplanation);

        if (childExplanation !== newChildExplanation) {
            hasChildExplanationChanged = true;
        }

        return newChildExplanation;
    });

    if (!hasChildExplanationChanged) return explanation;
    return {...explanation, details: newChildExplanations};
}

/**
 * Search for entities in a space by their semantic meaning. This uses a
 * language model to embed the query and compare it against embeddings of other
 * content throughout the space. So you can search by meaning, not just words.
 *
 * An example is you're looking for a document titled "Marketing Q3 QBR" (QBR
 * standing for "Quarterly Business Review"). You know there's some review doc
 * but you don't know what it's called. So you search "marketing team monthly
 * business review". Language models are capable of figuring out "monthly
 * business review" and "QBR" mean similar things so you find the right
 * matching document.
 */
// TODO(calebmer, #security): I suspect that this function is quite susceptible
// to timing attacks. For example, let's say you work at company X and search
// "company Y acquires company X". If private documents or chat messages exist
// talking about an acquisition your search may take a long time because we
// find these entities, skip over them since they don't match the filters, then
// try the next nearest entity. So from a search taking a long time you can
// infer OpenSearch is doing work to check and throw out chunks.
//
// This can be worse since OpenSearch doesn't appear to partition KNN indexes.
// So when doing a KNN search you're also considering embeddings in other
// spaces! So you may be able to devise a prompt to figure out private
// information in another company's space!
//
// To fix this we could have this function always wait at least 300ms or
// whatever p90 performance is. We show keyword search results to the user
// first so it's ok if semantic search results are a bit slower. Once we have
// some experience with this function in production, evaluate the timing
// attack risk.
export async function searchBySemantics(
    context: Context<
        SearchSessionActionContextModules & {
            languageModel: LanguageModelContextModule;
        }
    >,
    {
        spaceId,
        queryText,
        limit,
        timeZone,
        currentTime,
        debugOptions,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
        timeZone: TimeZone;
        currentTime: Date;
        debugOptions?: SearchOptions;
    },
): Promise<{
    results: Array<SearchResult>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    assertSearchQueryTextLength(queryText);

    // You must have internal access to try different `debugOptions`.
    if (debugOptions) {
        await authorizeInternalAccess(context);
    }

    const options = debugOptions ?? standardSearchOptions;

    const {filters, isLowConfidence} = parseSearchNaturalLanguageQuery(queryText, {
        timeZone,
        currentTime,
        actorAccountId: context.actor.getAccountId(),
        accountNameIndex: await getSpaceAccountNameSearchIndex(context, spaceId),
    });

    // If we have high confidence natural language filters then don't perform
    // semantic search. Since semantic search will invent meaning that disagrees
    // with the meaning we've determined for the user by parsing their query.
    if (filters.length > 0 && !isLowConfidence) return {results: []};

    const [queryEmbeddingVector] = await context.languageModel.model.embed(
        context.tracer.getTracer(),
        [queryText],
        {
            inputType: "SearchQuery",
        },
    );

    assert(queryEmbeddingVector);

    const {hits} = await context.opensearch.searchWithoutSource(
        SearchEntitySemanticIndex,
        spaceId,
        {
            size: limit,
            storedFields: ["title", "media"],
            sort: ["_score"],
            query: {
                nested: {
                    path: "embeddingChunks",
                    inner_hits: {
                        size: 1,
                        _source: false,
                        stored_fields: ["embeddingChunks.text", "embeddingChunks.preambleEndIndex"],
                    },
                    query: {
                        knn: {
                            [`embeddingChunks.vector.${context.languageModel.model.statics.key}`]: {
                                vector: new OpensearchQueryValue(
                                    Array.isArray(queryEmbeddingVector)
                                        ? queryEmbeddingVector
                                        : Array.from(queryEmbeddingVector),
                                ),

                                // A higher `k` value improves recall. Picking an arbitrary value for now.
                                // Really, we should test what provides the best recall. See:
                                // https://www.pinecone.io/learn/k-nearest-neighbor/#How-to-find-k
                                k: Math.max(limit, 30),

                                // We filter chunks here (instead of with a boolean filter) to perform
                                // efficient KNN-filtering which is a hybrid of pre-filtering and
                                // post-filtering.
                                // https://opensearch.org/docs/latest/search-plugins/knn/filter-search-knn
                                filter: {
                                    bool: {
                                        // Use filter context to only match content the user is allowed to see. The
                                        // content must be in our space and must grant access to the account. Either
                                        // directly or through a default grant.
                                        filter: [
                                            {
                                                term: {
                                                    "embeddingChunks.spaceId":
                                                        new OpensearchQueryValue(spaceId),
                                                },
                                            },
                                            {
                                                bool: {
                                                    minimum_should_match: 1,
                                                    should: [
                                                        {
                                                            term: {
                                                                "embeddingChunks.accessPolicy.accountGrantAccountIds":
                                                                    new OpensearchQueryValue(
                                                                        context.actor.getAccountId(),
                                                                    ),
                                                            },
                                                        },
                                                        {
                                                            term: {
                                                                "embeddingChunks.accessPolicy.defaultGrantType":
                                                                    new OpensearchQueryValue(
                                                                        SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                                            "Space",
                                                                        ),
                                                                    ),
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    );

    const queryTokens = new Set(
        mapIterable(
            approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(queryText),
            token => token.text,
        ),
    );

    const results = await runAllPromises(
        hits.map(async (hit): Promise<SearchResult | null> => {
            const score = hit.score * options.semanticScoreScaleFromOpensearch;

            // TODO(calebmer): Instead of filtering out hits that don't meet the minimum
            // score here, I wish I could have OpenSearch stop if it can't find hits better
            // than this score. But I can't seem to find the OpenSearch parameter that will
            // let me do this?
            if (score < options.minSemanticScore) return null;

            // The highlighted body text we get from OpenSearch is markdown formatted with
            // `<em>` tags inserted where we need to highlight. To get this in a format we
            // can render:
            //
            // 1. Parse the Markdown back to a ProseMirror node
            // 2. Print the ProseMirror node to a single line of text
            let rawBodyTextSnippet =
                hit.innerHits?.embeddingChunks?.[0]?.fields["embeddingChunks.text"]?.[0];

            const preambleEndIndex =
                hit.innerHits?.embeddingChunks?.[0]?.fields[
                    "embeddingChunks.preambleEndIndex"
                ]?.[0];

            // Remove the preamble from the chunk text.
            rawBodyTextSnippet =
                typeof preambleEndIndex === "number"
                    ? rawBodyTextSnippet?.slice(preambleEndIndex)
                    : rawBodyTextSnippet;

            // If the chunk text starts with the document header then remove that.
            rawBodyTextSnippet = rawBodyTextSnippet?.replace(/^\s*#\s+[^\n]+\n/, "");

            // Emulate OpenSearch highlighting. So if our semantic search chunk text
            // matches the query words at all the user sees highlighted text as expected.
            //
            // As of 2023-12-18 our in-process highlighter doesn't have full compatibility
            // with OpenSearch's highlighter. For example, we don't support highlighting
            // tokens that would have been split up by the `word_delimiter_graph` filter
            // and we don't support highlighting typos from a fuzzy match.
            if (rawBodyTextSnippet) {
                let offsetIndex = 0;
                const highlightTagStart = "<em>";
                const highlightTagEnd = "</em>";

                for (const token of approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(
                    rawBodyTextSnippet,
                )) {
                    if (!queryTokens.has(token.text)) continue;

                    rawBodyTextSnippet =
                        rawBodyTextSnippet.slice(0, offsetIndex + token.sourceStartIndex) +
                        highlightTagStart +
                        rawBodyTextSnippet.slice(
                            offsetIndex + token.sourceStartIndex,
                            offsetIndex + token.sourceStartIndex + token.sourceLength,
                        ) +
                        highlightTagEnd +
                        rawBodyTextSnippet.slice(
                            offsetIndex + token.sourceStartIndex + token.sourceLength,
                        );

                    offsetIndex += highlightTagStart.length + highlightTagEnd.length;
                }
            }

            const bodySnippet = rawBodyTextSnippet
                ? parseSearchContent(rawBodyTextSnippet, {
                      shouldParseEmphasisHtmlTagAsHighlight: true,
                  })
                : null;

            const bodyTextSnippet = bodySnippet
                ? printContentSingleLineTextSnippetPreservingMarks(
                      {doc: bodySnippet, references: emptyContentReferences},
                      mark => mark.type.name === "highlight",
                  ).map(segment => ({isHighlighted: segment.marks.length > 0, text: segment.text}))
                : [];

            const docMedia = hit.fields.media?.[0];
            const resultMedia = docMedia
                ? await prepareSearchEntityMediaForResult(context, spaceId, hit.id, docMedia)
                : null;

            return {
                id: hit.id,
                score,
                title: hit.fields.title?.[0] ?? null,
                bodyTextSnippet,
                media: resultMedia,
            };
        }),
    );

    return {results: results.filter(isNonNullable)};
}

async function prepareSearchEntityMediaForResult(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    entityId: SearchEntityId,
    media: SearchEntityMedia,
): Promise<SearchResultMedia> {
    switch (media.type) {
        case "Account": {
            const account = await getAccount(context, spaceId, media.accountId);
            return {type: "Account", account};
        }
        case "AccountPile": {
            const stableRandom = new StableRandom("SearchResultAccountPileMedia");

            // Show two accounts that aren't our actor's account. We randomly show two
            // different accounts for every chat to try and help make different chats
            // appear differently.
            const accountIds = stableShuffleArray(
                stableRandom,
                entityId,
                media.accountIds.filter(accountId => accountId !== context.actor.getAccountId()),
            );

            const previewAccounts = await runAllPromises([
                accountIds[0] ? getAccount(context, spaceId, accountIds[0]) : null,
                accountIds[1] ? getAccount(context, spaceId, accountIds[1]) : null,
            ]);

            return {
                type: "AccountPile",
                previewAccounts: previewAccounts.filter(isNonNullable),
                accountCount: accountIds.length,
            };
        }
        case "TaskCollectionColor": {
            return {type: "TaskCollectionColor", color: media.color};
        }
        default:
            throw exhaustive(media);
    }
}

/**
 * Get the titles of the provided search entities if the search entity exists
 * and the account has access to the search entity.
 */
export async function getSearchEntitiesTitleAndMediaIfExist(
    context: SearchSessionActionContext,
    {spaceId, entityIds}: {spaceId: SpaceId; entityIds: ReadonlyArray<SearchEntityId>},
): Promise<
    ReadonlyArray<{
        id: SearchEntityId;
        title: string | null;
        media: SearchEntityMedia | null;
    } | null>
> {
    await authorizeSpaceAccess(context, spaceId);

    const docs = await context.opensearch.multiGetDocsIfExist(
        entityIds.map(
            entityId =>
                new OpensearchGetDocWithoutSourceCommand(
                    SearchEntityKeywordIndex,
                    spaceId,
                    entityId,
                    {
                        storedFields: [
                            "title",
                            "media",
                            "accessPolicy.accountGrantAccountIds",
                            "accessPolicy.defaultGrantType",
                        ],
                    },
                ),
        ),
    );

    return docs.map(doc => {
        if (!doc) return null;
        if (doc.routing !== spaceId) return null;

        const isAccessAuthorized =
            doc.fields["accessPolicy.defaultGrantType"]?.[0] === "Space" ||
            doc.fields["accessPolicy.accountGrantAccountIds"]?.includes(
                context.actor.getAccountId(),
            );

        if (!isAccessAuthorized) return null;

        const title = doc.fields.title?.[0] ?? null;
        const media = doc.fields.media?.[0] ?? null;

        return {id: doc.id, title, media};
    });
}

/**
 * Get a list of search entities that are most meaningful to the actor. When
 * the actor interacts with objects in our system, we boost their affinity
 * score for that object. Affinity scores decay over time so we end up
 * considering objects the actor interacts with a lot recently as the most
 * meaningful.
 *
 * Unlike other search functions this one doesn't provide a `queryText`
 * filter. The actor has the same set of affinitive entities regardless of what
 * they're currently searching for.
 */
export async function searchByAffinity(
    context: SearchSessionActionContext,
    {spaceId, limit, timeZone}: {spaceId: SpaceId; limit: number; timeZone: TimeZone},
): Promise<{results: Array<SearchResult>}> {
    await authorizeSpaceAccess(context, spaceId);

    const currentTime = new Date();

    const affinityIds = await internalGetSearchAffinities(context, {spaceId, limit});

    const entitiesTitleAndMedia = await getSearchEntitiesTitleAndMediaIfExist(context, {
        spaceId,
        entityIds: filterMapArray(affinityIds, ({affinityId}): SearchEntityId | undefined =>
            affinityId !== "TaskNotepad" ? affinityId : undefined,
        ),
    });

    const entityTitleAndMediaById = new Map(
        filterMapIterable(entitiesTitleAndMedia, entityTitleAndMedia =>
            entityTitleAndMedia ? [entityTitleAndMedia.id, entityTitleAndMedia] : undefined,
        ),
    );

    const results = await runAllPromises(
        filterMapArray(
            affinityIds,
            ({affinityId, points, lastViewedTime}): MaybePromise<SearchResult> | undefined => {
                const bodyTextSnippet = [
                    {
                        isHighlighted: false,
                        text: lastViewedTime
                            ? `Last opened ${formatPrettyRelativeDateWithoutFullTimeTooltip(
                                  timeZone,
                                  currentTime,
                                  lastViewedTime,
                                  "Days",
                              )}`
                            : "Never opened",
                    },
                ];

                if (affinityId === "TaskNotepad") {
                    return {
                        id: affinityId,
                        score: points,
                        title: "Task notepad",
                        bodyTextSnippet,
                        media: null,
                    };
                }

                const entityTitleAndMedia = entityTitleAndMediaById.get(affinityId);
                if (!entityTitleAndMedia) return;

                return Promise.resolve(
                    entityTitleAndMedia.media
                        ? prepareSearchEntityMediaForResult(
                              context,
                              spaceId,
                              affinityId,
                              entityTitleAndMedia.media,
                          )
                        : null,
                ).then(media => ({
                    id: affinityId,
                    score: points,
                    title: entityTitleAndMedia.title,
                    bodyTextSnippet,
                    media,
                }));
            },
        ),
    );

    return {results};
}

function getChannelStandaloneSearchResult(channel: ChannelModel): {
    channel: ChannelPreviewModel;
    descriptionTextSnippet: string;
} {
    const descriptionContentSnippet = getContentSnippet(channel.description.doc.resolve(0), 3);

    const descriptionTextSnippet = printContentSingleLineTextSnippet({
        doc: descriptionContentSnippet,
        references: channel.description.references,
    });

    return {
        channel: channel.asPreview(),
        descriptionTextSnippet,
    };
}

/**
 * Search all the channels in our space by name. This search is capable of
 * fuzzy matching when there's a typo and prefix matching the last word.
 *
 * On the client we boost channels an account has an affinity for.
 */
export async function searchChannelsByKeywords(
    context: SearchSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
    },
): Promise<Array<{channel: ChannelPreviewModel; descriptionTextSnippet: string}>> {
    await authorizeSpaceAccess(context, spaceId);

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        size: limit,
        sort: [
            "_score",
            // If score is tied, put the newer collections first.
            {createdTime: {order: "desc", missing: "_last"}},
        ],
        query: {
            bool: {
                minimum_should_match: 1,
                should: [
                    {
                        multi_match: {
                            query: new OpensearchQueryValue(queryText),
                            type: "bool_prefix",
                            fields: ["title", "title._2gram", "title._3gram"],
                            fuzziness: 0,
                        },
                    },
                    // While `bool_prefix` supports fuzzy search the final term will not be fuzzy
                    // matched. So if there's only one term or the last term is the critical term we
                    // won't be able to fix mispellings.
                    //
                    // Also, fuzzy matching on 2gram or 3gram fields can lead to some odd results
                    // where, because we're fuzzy matching two words, we end up matching a two word
                    // pair which means something completely different.
                    {
                        match: {
                            title: {
                                query: new OpensearchQueryValue(queryText),
                                fuzziness: "AUTO",
                                // Reduce the number of fuzzy expansions.
                                prefix_length: 1,
                                // Misspellings should rank lower than proper spellings.
                                boost: 0.5,
                            },
                        },
                    },
                ],

                // Use filter context to only match content the user is allowed to see. The
                // content must be in our space and must grant access to the account. Either
                // directly or through a default grant.
                //
                // Query clauses in a filter context may be cached.
                // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    {term: {type: new OpensearchQueryValue("Channel")}},
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                {
                                    term: {
                                        "accessPolicy.accountGrantAccountIds":
                                            new OpensearchQueryValue(context.actor.getAccountId()),
                                    },
                                },
                                {
                                    term: {
                                        "accessPolicy.defaultGrantType": new OpensearchQueryValue(
                                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                "Space",
                                            ),
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    });

    const channels = await runAllPromises(
        hits.map(async hit => {
            // Could be an assert since we should filter out non-channels in our search.
            if (!hit.id.startsWith("Channel:")) return null;

            const channelId = hit.id.slice(8) as ChannelId;

            // Data in the search index may be stale and the account may have lost access
            // to the channel. Don't return the channel if the user lost access.
            const channelResult = await getChannelIfPossible(context, channelId);
            if (!channelResult) return null;
            if (!channelResult.ok) return null;

            const channel = channelResult.value.model;

            return getChannelStandaloneSearchResult(channel);
        }),
    );

    return channels.filter(isNonNullable);
}

/**
 * Get a list of channels relevant to the session account. First we look at
 * channels the account has interacted with. If the user hasn't personally
 * interacted with enough channels to fill `limit` then we'll return a list of
 * the most popular channels across the entire space.
 *
 * If it's a personal recommendation we return `origin: "Account"`. If it's a
 * space-wide recommendation we return `origin: "Space"`. Only personal
 * recommendations should be used to boost keyword search results.
 */
export async function searchChannelsByAffinity(
    context: SearchSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        channel: ChannelPreviewModel;
        descriptionTextSnippet: string;
        origin: "Account" | "Space";
    }>
> {
    const channelIdsFromAccountAffinities = await getPossiblyStaleChannelSearchAffinityIds(
        context,
        spaceId,
    );

    if (channelIdsFromAccountAffinities.length >= limit) {
        const channels = await runAllPromises(
            channelIdsFromAccountAffinities.slice(0, limit).map(async channelId => {
                const channelResult = await getChannelIfPossible(context, channelId);
                if (!channelResult) return null;
                if (!channelResult.ok) return null;
                return {
                    ...getChannelStandaloneSearchResult(channelResult.value.model),
                    origin: "Account" as const,
                };
            }),
        );
        return channels.filter(isNonNullable);
    }

    const channelIdsFromAccountAffinitiesSet = new Set(channelIdsFromAccountAffinities);

    const channelIdsFromSpaceAffinities = await internalDangerouslyGetSpaceChannelSearchAffinities(
        context,
        {
            spaceId,
            // Load 10 extra channels since some space-level channels might be private. We
            // load a full `limit` worth of items since there may be duplicates with
            // channel IDs from account affinities.
            limit: limit + 10,
        },
    );

    const channels = await runAllPromises(
        [
            ...channelIdsFromAccountAffinities,
            ...channelIdsFromSpaceAffinities.filter(
                channelId => !channelIdsFromAccountAffinitiesSet.has(channelId.item.channelId),
            ),
        ].map(async channelId => {
            const channelResult = await getChannelIfPossible(
                context,
                typeof channelId === "string" ? channelId : channelId.item.channelId,
            );
            if (!channelResult) return null;
            if (!channelResult.ok) return null;
            return {
                ...getChannelStandaloneSearchResult(channelResult.value.model),
                origin: typeof channelId === "string" ? ("Account" as const) : ("Space" as const),
            };
        }),
    );

    return channels.filter(isNonNullable).slice(0, limit);
}

/**
 * Get a list of task collections relevant to the session account. First we
 * look at collections the account has interacted with. If the user hasn't
 * personally interacted with enough collections to fill `limit` then we'll
 * return a list of the most popular collections across the entire space.
 *
 * If it's a personal recommendation we return `origin: "Account"`. If it's a
 * space-wide recommendation we return `origin: "Space"`. Only personal
 * recommendations should be used to boost keyword search results.
 */
export async function searchTaskCollectionsByAffinity(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<
        TaskCollectionModelSearchResult & {
            origin: "Account" | "Space";
        }
    >
> {
    const collectionIdsFromAccountAffinities =
        await getPossiblyStaleTaskCollectionSearchAffinityIds(context, spaceId);

    if (collectionIdsFromAccountAffinities.length >= limit) {
        const collections = await runAllPromises(
            collectionIdsFromAccountAffinities.slice(0, limit).map(async collectionId => {
                const collectionResult = await getTaskCollectionSearchResultIfExists(
                    context,
                    collectionId,
                );
                if (!collectionResult) return null;

                return {
                    ...collectionResult,
                    origin: "Account" as const,
                };
            }),
        );
        return collections.filter(isNonNullable);
    }

    const collectionIdsFromAccountAffinitiesSet = new Set(collectionIdsFromAccountAffinities);

    const collectionIdsFromSpaceAffinities =
        await internalDangerouslyGetSpaceTaskCollectionSearchAffinities(context, {
            spaceId,
            // Load 10 extra collections since some space-level collections might be
            // private. We load a full `limit` worth of items since there may be duplicates
            // with collection IDs from account affinities.
            limit: limit + 10,
        });

    const collections = await runAllPromises(
        [
            ...collectionIdsFromAccountAffinities,
            ...collectionIdsFromSpaceAffinities.filter(
                channelId =>
                    !collectionIdsFromAccountAffinitiesSet.has(channelId.item.collectionId),
            ),
        ].map(async collectionId => {
            const collectionResult = await getTaskCollectionSearchResultIfExists(
                context,
                typeof collectionId === "string" ? collectionId : collectionId.item.collectionId,
            );
            if (!collectionResult) return null;

            return {
                ...collectionResult,
                origin:
                    typeof collectionId === "string" ? ("Account" as const) : ("Space" as const),
            };
        }),
    );

    return collections.filter(isNonNullable).slice(0, limit);
}
