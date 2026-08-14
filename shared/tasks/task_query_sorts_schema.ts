import {Schema} from "~/shared/schema/schema.js";
import {
    TaskQuerySort,
    deserializeTaskQuerySorts,
    serializeTaskQuerySorts,
} from "~/shared/tasks/task_query_sort.js";

/**
 * A `Schema` for a list of task query sorts. Serialized using the compact binary
 * format we also base64 encode for URLs.
 */
export const TaskQuerySortsSchema = Schema.bytes.transform<ReadonlyArray<TaskQuerySort>>({
    serialize: sorts => new Uint8Array(serializeTaskQuerySorts(sorts)),
    deserialize: deserializeTaskQuerySorts,
});
