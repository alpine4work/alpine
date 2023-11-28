import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityId} from "~/server/search/data/internal/search_entity_id.js";
import {SearchEntityIndexDocType} from "~/server/search/data/internal/search_entity_index_doc.js";
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
    OpensearchIndexTypeFlattenedKeysType<typeof SearchEntityIndexDocType>
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
    // 3. The ability to reindex from one Elasticsearch index to another, either
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
