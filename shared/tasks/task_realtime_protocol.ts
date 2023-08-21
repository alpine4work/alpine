import {TaskRealtimeQuerySubscriptionId} from "~/shared/id/types/id_types.js";
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
        subscribeToQuery: {
            input: {
                filters: TaskQueryNormalizedFiltersSchema,
                sorts: Schema.array(TaskQueryNormalizedSortSchema),
                limit: Schema.integer,
            },
            output: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
            },
        },
        unsubscribeFromQuery: {
            input: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
            },
            output: {},
        },
        loadMoreQueryTasks: {
            input: {
                querySubscriptionId: Schema.id<TaskRealtimeQuerySubscriptionId>(),
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
