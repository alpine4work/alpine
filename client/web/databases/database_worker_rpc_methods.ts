import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {
    DatabaseActionObjectSchema,
    DatabaseActionResultSchema,
} from "~/shared/databases/database_actions.js";
import {ensureCacheIsUpToDateResultConfig} from "~/shared/databases/database_realtime_protocol.js";
import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import type {
    DatabaseId,
    DatabaseMutationId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

const pageValueSchema = Schema.object({
    timestamp: Schema.integer,
    data: Schema.bytes,
});

const pageDiffEntrySchema = Schema.object({
    pageIndex: Schema.integer,
    timestamp: Schema.integer,
    diff: pageDiffSchema,
});

/** Methods the tab can call on the worker. */
export const tabToWorkerDatabaseRpcMethods = defineWebWorkerRpcMethods({
    executeAction: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            action: DatabaseActionObjectSchema,
        },
        output: {result: DatabaseActionResultSchema},
    },
    writePagesFromRealtime: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            pages: Schema.array(pageDiffEntrySchema),
            mutationId: Schema.id<DatabaseMutationId>(),
        },
        output: {},
    },
    registerReactiveAction: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            id: Schema.id<DatabaseReactiveActionId>(),
            action: DatabaseActionObjectSchema,
        },
        output: {result: DatabaseActionResultSchema, error: Schema.string.nullable()},
    },
    unregisterReactiveAction: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            id: Schema.id<DatabaseReactiveActionId>(),
        },
        output: {},
    },
});

/** Methods the worker can call on the tab. */
export const workerToTabDatabaseRpcMethods = defineWebWorkerRpcMethods({
    executeActionServer: {
        input: {
            action: DatabaseActionObjectSchema,
            mutationId: Schema.id<DatabaseMutationId>(),
        },
        output: {
            result: DatabaseActionResultSchema,
            readPages: Schema.map(Schema.integer, pageValueSchema),
        },
    },
    ensureCacheIsUpToDate: {
        input: {
            pageTimestampsByIndex: Schema.map(Schema.integer, Schema.integer),
        },
        output: ensureCacheIsUpToDateResultConfig,
    },
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

/** Result of a server executeAction: result plus any pages needed locally. */
export type ExecuteActionServerResult = SchemaType<
    (typeof workerToTabDatabaseRpcMethods)["executeActionServer"]["outputSchema"]
>;
