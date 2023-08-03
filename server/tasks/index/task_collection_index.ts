import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {TaskCollectionIndexDocType} from "~/server/tasks/index/task_collection_index_doc.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

export const TaskCollectionIndex = new OpensearchIndex<
    SpaceId,
    TaskCollectionId,
    OpensearchIndexTypeType<typeof TaskCollectionIndexDocType>,
    OpensearchIndexFlattenedKeysType<typeof TaskCollectionIndexDocType>
>(TaskCollectionIndexDocType, {
    name: "task_collections",
    numberOfShards: 3,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // Our searches are basically always within a specific space and basically
    // always exclude deleted collections.
    //
    // We need to exclude collections from searches an account doesn't have access
    // to. We can't implement all access rules in OpenSearch but given personal
    // collections are common, as an optimization we include whether a collection
    // is personal or not to efficiently filter them out.
    //
    // Finally sort by `createdTime` since that's generally useful.
    //
    // NOCOMMIT: Test that index sorting is working with the profile API?
    // https://www.elastic.co/guide/en/elasticsearch/reference/8.9/search-profile.html
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "personalAccessPolicyAccountId"},
        {field: "createdTime"},
    ],
    // We want to see new collections in search in near realtime.
    refreshInterval: "1s",
});
