import {replicateDatabaseTableChanges} from "~/server/databases/data/database_table_replication.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/database_replication_rpc_definitions.js";

export default implementRpcs(definitions, {
    replicateDatabaseTableChanges: {
        visibility: ["DatabaseGroupService"],
        async execute(context, input) {
            await replicateDatabaseTableChanges(context, input);
            return {ok: true as const};
        },
    },
});
