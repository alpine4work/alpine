import {DatabaseGroupId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const replicateDatabaseTableChanges = defineRpc({
    name: "replicateDatabaseTableChanges",
    isIdempotent: true,
    input: {
        databaseGroupId: Schema.id<DatabaseGroupId>(),
        storageVersion: Schema.integer,
        tableIds: Schema.array(Schema.id<DatabaseTableId>()),
    },
    output: {
        ok: Schema.value(true),
    },
});
