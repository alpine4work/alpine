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

        const readStartTime = new Date();
        const {dependencyIds, entity} = await getSearchEntity(context, job.update);

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
