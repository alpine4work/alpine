import murmurhash from "murmurhash";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {
    OpensearchClientDocWithIdAndVersion,
    OpensearchGetDocWithoutSourceCommand,
    OpensearchIndexDocIfVersionCommand,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {IndexSearchEntityJobDescription} from "~/server/search/core/index_search_entity_job_description.js";
import {SearchEntityDependencyId} from "~/server/search/core/search_entity_dependency_id.js";
import {getSearchEntityDependencyIdsAffectedByUpdate} from "~/server/search/core/search_entity_update.js";
import {getSearchEntity} from "~/server/search/data/internal/get_search_entity.js";
import {
    SearchEntityIndexDefaultGrantTypeIntegerMapping,
    SearchEntityKeywordIndexDoc,
    SearchEntityKeywordIndexDocType,
    SearchEntitySemanticIndexDoc,
    SearchEntitySemanticIndexDocType,
    SearchEntitySemanticIndexEmbeddingChunk,
} from "~/server/search/data/internal/search_entity_index_doc.js";
import {SearchEntityIndexSystemActionContext} from "~/server/search/data/search_entity_index_system_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {InternalError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    defaultUncertaintyWindowMs,
    isDateDefinitelyLessThanWithUncertaintyWindow,
} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    SearchEntityId,
    parseSearchEntityId,
    printSearchEntityId,
} from "~/shared/search/search_entity_id.js";

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
        lastReadStartTime: Date;
        title: string;
        body: string;
    }
>();

// Double check we've only stored fields we need.
assertEqualTypes<
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntitySemanticIndexDocType>,
    {
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
    context: SearchEntityIndexSystemActionContext,
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
                        {storedFields: ["lastReadStartTime"]},
                    ),
                    new OpensearchGetDocWithoutSourceCommand(
                        SearchEntitySemanticIndex,
                        job.spaceId,
                        entityId,
                        {
                            storedFields: [
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
                !!oldDocForKeywordIndex &&
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
                );

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

            const newDocForKeywordIndex: OpensearchClientDocWithIdAndVersion<
                SearchEntityId,
                SearchEntityKeywordIndexDoc
            > = {
                id: entityId,
                version: oldDocForKeywordIndex?.version ?? null,
                spaceId: job.spaceId,
                type: job.update.type,
                lastReadStartTime: readStartTime,
                accessPolicy: entity.accessPolicy,
                dependencyIds: Array.from(dependencyIds),
                title: entity.title,
                body: entity.body,
            };

            const newDocForSemanticIndex: OpensearchClientDocWithIdAndVersion<
                SearchEntityId,
                SearchEntitySemanticIndexDoc
            > = {
                id: entityId,
                version: oldDocForSemanticIndex?.version ?? null,
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
            const docs = await context.opensearch.searchWithoutSource(
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
                docs.map(async doc => {
                    // Confirm the job was added to the queue before exiting. It's ok to take the
                    // batch delay performance hit when processing jobs.
                    await context.jobs.sendAndWait({
                        type: "IndexSearchEntity",
                        spaceId: job.spaceId,
                        update: {
                            ...parseSearchEntityId(doc.id),
                            // Dependencies didn't update so we can skip reindexing transitive
                            // dependencies.
                            updatedTraits: {type: "None"},
                        },
                        parentJobStartTime: jobStartTime,
                    });
                }),
            );

            searchAfter = docs.length > 0 ? assertExists(docs[docs.length - 1]!.sort) : null;

            // If we did not reach the pagination limit then don't query again for the
            // next page.
            if (docs.length < searchSize) searchAfter = null;
        } while (searchAfter !== null);
    }
}

export type SearchByKeywordResult = {
    readonly entityId: SearchEntityId;
    readonly title: string | null;
    readonly bodyHighlight: string | null;
};

/**
 * Search for entities in a space by keyword. Returns entities that almost
 * exactly match the query text (some typos are tolerated). Entities with the
 * query text in their title or that match an exact phrase rank higher.
 *
 * This function only really works with queries containing complete words. It
 * doesn't support prefix matching of the last word which you'd need to build
 * type-ahead functionality.
 */
export async function searchByKeyword(
    context: ServerSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
    },
): Promise<{
    results: Array<SearchByKeywordResult>;
}> {
    // NOCOMMIT: Tests (include authorization tests)
    await authorizeSpaceAccess(context, spaceId);

    // NOCOMMIT: If in debug mode, add `explain`

    // NOCOMMIT: Allow the client to configure this in debug mode
    const titleBoost = 4;

    const docs = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        size: limit,
        storedFields: ["title"],
        sort: ["_score"],
        query: {
            bool: {
                must: [
                    {
                        multi_match: {
                            query: new OpensearchQueryValue(queryText),
                            // The more fields matched, the better!
                            //
                            // - If you match a shingle it will also implicitly match the main field.
                            //   So we get limited phrase matching.
                            // - Matches in title fields are boosted above matches in body fields.
                            type: "most_fields",
                            fields: [
                                `title^${titleBoost}`,
                                `title._2gram^${titleBoost}`,
                                `title._3gram^${titleBoost}`,
                                "body",
                                "body._2gram",
                                "body._3gram",
                            ],
                            // Still match even if the query text has typos.
                            fuzziness: "AUTO",
                        },
                    },
                ],

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

    const results = docs.map((doc): SearchByKeywordResult => {
        return {
            entityId: doc.id,
            title: doc.fields.title?.[0] ?? null,
            bodyHighlight: doc.highlight?.body?.[0] ?? null,
        };
    });

    return {results};
}
