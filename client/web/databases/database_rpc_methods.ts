import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
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
    executeMutation: {
        input: {sql: Schema.string},
        output: {rows: Schema.array(Schema.unknown())},
    },
    writePagesFromRealtime: {
        input: {pages: Schema.array(pageSchema), mutationId: Schema.id<DatabaseMutationId>()},
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
    mutateServer: {
        input: {sql: Schema.string, mutationId: Schema.id<DatabaseMutationId>()},
        output: {rows: Schema.array(Schema.unknown())},
    },
    reportMutationError: {
        input: {message: Schema.string},
        output: {},
    },
});

/** Result of a server query: rows plus any pages needed locally. */
export type QueryServerResult = SchemaType<
    (typeof workerToTabDatabaseRpcMethods)["queryServer"]["outputSchema"]
>;

/** Result of a server mutation: rows only (pages arrive via broadcast). */
export type MutateServerResult = SchemaType<
    (typeof workerToTabDatabaseRpcMethods)["mutateServer"]["outputSchema"]
>;
