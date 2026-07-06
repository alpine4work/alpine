import {DatabaseGroupId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const enqueueDatabaseTableReplicationJob = defineRpc({
    name: "enqueueDatabaseTableReplicationJob",
    isIdempotent: true,
    input: {
        databaseGroupId: Schema.id<DatabaseGroupId>(),
        tableIds: Schema.set(Schema.id<DatabaseTableId>()),
    },
    output: {
        ok: Schema.value(true),
    },
});
