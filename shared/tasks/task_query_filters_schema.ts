import {Schema} from "~/shared/schema/schema.js";
import {
    TaskQueryFilter,
    deserializeTaskQueryFilters,
    serializeTaskQueryFilters,
} from "~/shared/tasks/task_query_filter.js";

/**
 * A `Schema` for a list of task query filters. Serialized using the compact binary
 * format we also base64 encode for URLs.
 */
export const TaskQueryFiltersSchema = Schema.bytes.transform<ReadonlyArray<TaskQueryFilter>>({
    serialize: filters => new Uint8Array(serializeTaskQueryFilters(filters)),
    deserialize: deserializeTaskQueryFilters,
});
