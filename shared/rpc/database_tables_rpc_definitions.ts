import {DatabaseTableId, DatabaseViewId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const createDatabaseTable = defineRpc({
    name: "createDatabaseTable",
    // Creates a new table each time.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        name: LabelStringSchema,
    },
    output: {
        tableId: Schema.id<DatabaseTableId>(),
        viewId: Schema.id<DatabaseViewId>(),
    },
});
