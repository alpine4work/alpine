import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {TaskIndexDocType} from "~/server/tasks/index/task_index_doc.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";

export const TaskIndex = new OpensearchIndex<
    SpaceId,
    TaskId,
    OpensearchIndexTypeType<typeof TaskIndexDocType>,
    OpensearchIndexFlattenedKeysType<typeof TaskIndexDocType>
>(TaskIndexDocType, {
    name: "tasks",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // Our searches are basically always within a specific space and basically
    // always exclude deleted tasks. After that tasks exclude closed tasks most
    // of the time and the default sort order for views is creation time.
    //
    // NOCOMMIT: Test that index sorting is working with the profile API?
    // https://www.elastic.co/guide/en/elasticsearch/reference/8.9/search-profile.html
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "status.value.type"},
        {field: "createdTime.absoluteTime"},
    ],
    refreshInterval: "30s",
});
