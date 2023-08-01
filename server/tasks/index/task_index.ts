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
    name: "task_index",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // NOCOMMIT: Test that index sorting is working with the profile API?
    // https://www.elastic.co/guide/en/elasticsearch/reference/8.9/search-profile.html
    sort: [
        {field: "spaceId", order: "asc"},
        {field: "isDeleted", order: "asc"},
        {field: "status.value.type", order: "asc"},
        {field: "createdTime.absoluteTime", order: "asc"},
    ],
    refreshInterval: "30s",
});
