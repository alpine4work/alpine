import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/database_replication_rpc_definitions.js";

export default implementRpcs(definitions, {
    enqueueDatabaseTableReplicationJob: {
        visibility: ["DatabaseGroupService"],
        async execute(context, input) {
            if (input.tableIds.size > 0) {
                await context.jobs.sendAndWait({
                    type: "ReplicateDatabaseTableChanges",
                    ...input,
                });
            }
            return {ok: true as const};
        },
    },
});
