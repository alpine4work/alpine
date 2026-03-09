import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import type {
    DatabaseId,
    DatabaseMutationId,
    DatabaseReactiveQueryId,
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
    execute: {
        input: {databaseId: Schema.id<DatabaseId>(), sql: Schema.string},
        output: {rows: Schema.array(Schema.unknown())},
    },
    writePagesFromRealtime: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            pages: Schema.array(pageDiffEntrySchema),
            mutationId: Schema.id<DatabaseMutationId>(),
        },
        output: {},
    },
    registerReactiveQuery: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            queryId: Schema.id<DatabaseReactiveQueryId>(),
            sql: Schema.string,
        },
        output: {rows: Schema.array(Schema.unknown()), error: Schema.string.nullable()},
    },
    unregisterReactiveQuery: {
        input: {
            databaseId: Schema.id<DatabaseId>(),
            queryId: Schema.id<DatabaseReactiveQueryId>(),
        },
        output: {},
    },
});

/** Methods the worker can call on the tab. */
export const workerToTabDatabaseRpcMethods = defineWebWorkerRpcMethods({
    executeServer: {
        input: {
            sql: Schema.string,
            allowWrites: Schema.boolean,
            mutationId: Schema.id<DatabaseMutationId>(),
        },
        output: {
            rows: Schema.array(Schema.unknown()),
            readPages: Schema.map(Schema.integer, pageValueSchema),
        },
    },
    reportError: {
        input: {message: Schema.string},
        output: {},
    },
    reactiveQueryUpdated: {
        input: {
            queryId: Schema.id<DatabaseReactiveQueryId>(),
            rows: Schema.array(Schema.unknown()),
        },
        output: {},
    },
    reactiveQueryError: {
        input: {
            queryId: Schema.id<DatabaseReactiveQueryId>(),
            message: Schema.string,
        },
        output: {},
    },
});

/** Result of a server execute: rows plus any pages needed locally. */
export type ExecuteServerResult = SchemaType<
    (typeof workerToTabDatabaseRpcMethods)["executeServer"]["outputSchema"]
>;
