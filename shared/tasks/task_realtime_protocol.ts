import {AccountModel} from "~/shared/accounts/account_model.js";
import {
    TaskCollectionId,
    TaskId,
    TaskRealtimeQuerySubscriptionId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/task_model.js";
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
        Update: Schema.object({
            type: Schema.value("Update"),
            actions: Schema.array(TaskActionSchema),
            backfillAuthorizedTasks: Schema.array(TaskModel.schema),
            backfillUnauthorizedTaskIds: Schema.array(Schema.id<TaskId>()),
            backfillAuthorizedCollections: Schema.array(TaskCollectionModel.schema),
            backfillUnauthorizedCollectionIds: Schema.array(Schema.id<TaskCollectionId>()),
            referencedAccounts: Schema.array(AccountModel.schema()),
        }),
    },
});
