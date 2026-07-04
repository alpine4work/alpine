import {
    defineWebWorkerRpcMethods,
    WebWorkerRpcMethodTypes,
} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {
    DatabaseActionObjectSchema,
    DatabaseActionResultSchema,
} from "~/shared/databases/database_actions.js";
import {
    DatabasePageDiffsSchema,
    DatabasePagesSchema,
} from "~/shared/databases/database_protocol_schemas.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/** Methods the tab can call on the worker. */
export const tabToWorkerDatabaseRpcMethods = defineWebWorkerRpcMethods({
    connectDatabaseGroup: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            pages: DatabasePagesSchema,
            webSocketUrl: Schema.string,
        },
        output: {},
    },
    writeInitialPages: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            pages: DatabasePagesSchema,
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
    writePageDiffsFromRealtime: {
        input: {
            databaseGroupId: Schema.id<DatabaseGroupId>(),
            pageDiffs: DatabasePageDiffsSchema,
            mutationId: Schema.id<DatabaseMutationId>(),
        },
        output: {},
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
