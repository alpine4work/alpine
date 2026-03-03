import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {Schema} from "~/shared/schema/schema.js";

export const databaseWorkerMethods = defineWebWorkerRpcMethods({
    executeQuery: {
        input: {sql: Schema.string},
        output: {rows: Schema.array(Schema.unknown())},
    },
});
