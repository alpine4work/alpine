import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getSpaceIdForDatabaseGroupId} from "~/server/spaces/get_database_group_id_for_space.js";
import * as definitions from "~/shared/rpc/database_replication_rpc_definitions.js";

export default implementRpcs(definitions, {
    enqueueDatabaseTableReplicationJob: {
        visibility: ["DatabaseGroupService"],
        async execute(context, input) {
            if (input.tableIds.size > 0) {
                const spaceId = await getSpaceIdForDatabaseGroupId(context, input.databaseGroupId);
                await context.jobs.sendAndWait({
                    type: "ReplicateDatabaseTableChanges",
                    spaceId,
                    ...input,
                });
            }
            return {ok: true as const};
        },
    },
});
