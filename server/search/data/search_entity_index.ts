import {CohereEmbedEnglishV3Tokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_tokenizer.js";
import {OpensearchClientDocWithIdAndVersion} from "~/server/opensearch/opensearch_client.js";
import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {IndexSearchEntityJobDescription} from "~/server/search/core/index_search_entity_job_description.js";
import {SearchEntityId, printSearchEntityId} from "~/server/search/core/search_entity_id.js";
import {getSearchEntity} from "~/server/search/data/internal/get_search_entity.js";
import {
    SearchEntityIndexDoc,
    SearchEntityIndexDocType,
} from "~/server/search/data/internal/search_entity_index_doc.js";
import {SearchEntityIndexSystemActionContext} from "~/server/search/data/search_entity_index_system_action_context.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDateLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// IMPORTANT: Don't export this. All access to the index should be exposed
// through functions in this file. Like how we organize DynamoDB tables. By
// putting all the logic around this index in one file it allows developers to
// carefully control how data is written to this index. Instead of updates
// sprawling out around the codebase.
const SearchEntityIndex = new OpensearchIndex<
    SpaceId,
    `${SearchEntityId}:${number}`,
    OpensearchIndexTypeType<typeof SearchEntityIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof SearchEntityIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityIndexDocType>
>(SearchEntityIndexDocType, {
    name: "search_entities",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,

    // Our searches are always within a specific space and generally for a specific
    // kind of doc (either keyword search or semantic search). Use index sorting to
    // make filtering by `SpaceId` then the doc type more efficient.
    //
    // We then sort by type to make searches for specific kinds of entities more
    // efficient. Such as a type-ahead search.
    sort: [{field: "spaceId"}, {field: "data.type"}, {field: "type"}],

    // The search index should be near realtime to serve search requests. However,
    // there's already some delay because entities are indexed in a background job.
    // To improve indexing performance we can afford to slow down the refresh
    // interval a bit.
    refreshInterval: "5s",

    // Disabling the source field is dangerous! It disables a lot of useful
    // features. From the [ElasticSearch docs][1]:
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
    //
    // NOCOMMIT: Test that we can still highlight with no source
    disableSourceField: true,
});

// Make sure only the fields we expect to be stored are stored and nothing else
// is stored.
assertEqualTypes<
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityIndexDocType>,
    {
        lastReadStartTime: Date;
        "data.title": string;
        "data.body": string;
    }
>();

/**
 * Allow using the `SearchEntityIndex` directly in Jest unit tests.
 */
export function getSearchEntityIndexForTest() {
    assert(import.meta.jest);
    return SearchEntityIndex;
}

// NOCOMMIT: Implement
//
// const affectedDependencyIds = getSearchEntityDependencyIdsAffectedByUpdate(job.update);
//
// // NOCOMMIT: Wait!
// void context.opensearch.client.searchWithoutSource(
//     context.tracer.getTracer(),
//     SearchEntityIndex,
//     job.spaceId,
//     {
//         // NOCOMMIT: Pagination
//         size: 5,
//         query: {
//             bool: {
//                 filter: {
//                     terms: {
//                         "data.dependencyIds": new OpensearchQueryValue(affectedDependencyIds),
//                     },
//                 },
//             },
//         },
//     },
// );

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
 * How we pick 40: We want embedding chunks to have more than two sentences
 * worth of content. Sentences are usually between 15-20 words ([source][2])
 * and a word is typically 1-3 tokens ([source][3]). This means two sentences
 * most of the time fall in the range of 15-60 tokens. 40 is a nice round
 * number near the middle of this range.
 *
 * [1]: https://txt.cohere.com/introducing-embed-v3/
 * [2]: https://languagetool.org/insights/post/sentence-length
 * [3]: https://docs.cohere.com/docs/tokens
 */
const minEmbeddingChunkTokenCount = 40;

// NOCOMMIT: Document how this works!
export async function processIndexSearchEntityJob(
    context: SearchEntityIndexSystemActionContext,
    jobSendTime: Date,
    job: IndexSearchEntityJobDescription,
) {
    const docId: `${SearchEntityId}:${number}` = `${printSearchEntityId(job.update)}:0`;

    await retryWithExponentialBackoff(async retry => {
        const actualOldDoc = await context.opensearch.client.getDocWithoutSourceIfExists(
            context.tracer.getTracer(),
            SearchEntityIndex,
            job.spaceId,
            docId,
            {storedFields: ["lastReadStartTime"]},
        );

        const oldDoc = actualOldDoc
            ? {
                  version: actualOldDoc.version,
                  lastReadStartTime: assertExists(actualOldDoc.fields.lastReadStartTime?.[0]),
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
        const isOldDocSufficient =
            !!oldDoc && isDateLessThanWithUncertaintyWindow(jobSendTime, oldDoc.lastReadStartTime);

        if (isOldDocSufficient) return;

        // We use the Cohere `embed-english-v3.0` model's tokenizer to chunk our
        // content. That's because it's the main model we use in production for
        // embeddings. In development we embed with a smaller model we can run locally
        // (`all-MiniLM-L6-v2`) but we standardize on Cohere's ideal chunk size to make
        // debugging chunk generation easier.
        const tokenizer = await CohereEmbedEnglishV3Tokenizer.get();

        const readStartTime = new Date();
        const {dependencyIds, entity} = await getSearchEntity(context, job.update, tokenizer);

        // We don't want to embed small messages like "Ok!" so filter out chunks
        // without much content.
        //
        // When seeing if this chunk is too small for embedding, we ignore the preamble
        // added for context. We only want to measure the content's tokens.
        const embeddingChunks = entity.embeddingChunks.filter(embeddingChunk => {
            return embeddingChunk.tokenCountWithoutPreamble >= minEmbeddingChunkTokenCount;
        });

        const newDoc: OpensearchClientDocWithIdAndVersion<
            `${SearchEntityId}:${number}`,
            SearchEntityIndexDoc
        > = {
            id: `${printSearchEntityId(job.update)}:0`,
            version: oldDoc?.version ?? null,
            spaceId: job.spaceId,
            type: job.update.type,
            lastReadStartTime: readStartTime,
            accessPolicy: entity.accessPolicy,
            data: {
                type: "Content",
                dependencyIds: Array.from(dependencyIds),
                title: entity.title,
                body: entity.body,
                // NOCOMMIT: Embedding chunks!
                embeddingChunk: null,
            },
        };

        // If we get a version conflict then some other concurrent process wrote this
        // search entity before us. We retry and completely re-read the entity. That
        // way we guarantee we aren't overwriting new data (read by the other job) with
        // old data (read by this job).
        await context.opensearch.client.indexDocIfVersion(
            context.tracer.getTracer(),
            SearchEntityIndex,
            job.spaceId,
            newDoc,
            {retryVersionConflictError: retry},
        );
    });
}
