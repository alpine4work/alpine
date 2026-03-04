import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

const pageSchema = Schema.object({
    pageIndex: Schema.integer,
    timestamp: Schema.integer,
    data: Schema.bytes,
});

/** Methods the tab can call on the worker. */
export const tabToWorkerDatabaseRpcMethods = defineWebWorkerRpcMethods({
    executeQuery: {
        input: {sql: Schema.string},
        output: {rows: Schema.array(Schema.unknown())},
    },
    writePagesFromRealtime: {
        input: {pages: Schema.array(pageSchema)},
        output: {},
    },
});

/** Methods the worker can call on the tab. */
export const workerToTabDatabaseRpcMethods = defineWebWorkerRpcMethods({
    queryServer: {
        input: {sql: Schema.string},
        output: {
            rows: Schema.array(Schema.unknown()),
            pages: Schema.array(pageSchema),
        },
    },
});

/** Result of a server query: rows plus any pages needed locally. */
export type QueryServerResult = SchemaType<
    (typeof workerToTabDatabaseRpcMethods)["queryServer"]["outputSchema"]
>;
