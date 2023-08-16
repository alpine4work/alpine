import {Schema} from "~/shared/schema/schema.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type TaskRealtimeEvent = WebSocketProtocolEventType<typeof TaskRealtimeProtocol>;

export const TaskRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        loadQuery: {
            input: {
                filters: TaskQueryNormalizedFiltersSchema,
                sorts: Schema.array(TaskQueryNormalizedSortSchema),
                limit: Schema.integer,
            },
            output: {},
        },
    },
    events: {
        Echo: Schema.object({
            type: Schema.value("Echo"),
            string: Schema.string,
        }),
    },
});
