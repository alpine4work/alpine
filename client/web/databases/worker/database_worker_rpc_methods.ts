import {
    WebWorkerRpcMethodTypes,
    defineWebWorkerRpcMethods,
} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {
    DatabaseActionObjectSchema,
    DatabaseActionResultSchema,
} from "~/shared/databases/database_actions.js";
import type {
    DatabaseGroupId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

/** Methods the tab can call on the worker. */
export const tabToWorkerDatabaseRpcMethods = defineWebWorkerRpcMethods({
    connectDatabaseGroup: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            webSocketUrl: Schema.string,
        },
        output: {},
    },
    executeAction: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            action: DatabaseActionObjectSchema,
        },
        output: {result: DatabaseActionResultSchema},
    },
    registerReactiveAction: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            id: Schema.id<DatabaseReactiveActionId>(),
            action: DatabaseActionObjectSchema,
        },
        output: {result: DatabaseActionResultSchema, error: Schema.string.nullable()},
    },
    unregisterReactiveAction: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            id: Schema.id<DatabaseReactiveActionId>(),
        },
        output: {},
    },
});

export type TabToWorkerDatabaseRpcMethods = WebWorkerRpcMethodTypes<
    typeof tabToWorkerDatabaseRpcMethods
>;

/** Methods the worker can call on the tab. */
export const workerToTabDatabaseRpcMethods = defineWebWorkerRpcMethods({
    reportError: {
        input: {message: Schema.string},
        output: {},
    },
    reactiveActionUpdated: {
        input: {
            id: Schema.id<DatabaseReactiveActionId>(),
            result: DatabaseActionResultSchema,
        },
        output: {},
    },
    reactiveActionError: {
        input: {
            id: Schema.id<DatabaseReactiveActionId>(),
            message: Schema.string,
        },
        output: {},
    },
});

export type WorkerToTabDatabaseRpcMethods = WebWorkerRpcMethodTypes<
    typeof workerToTabDatabaseRpcMethods
>;
