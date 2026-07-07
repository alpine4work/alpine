import {
    createDatabaseTable,
    updateDatabaseTableAccessPolicy,
} from "~/server/databases/data/database_table_metadata.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/database_tables_rpc_definitions.js";

export default implementRpcs(definitions, {
    createDatabaseTable: {
        visibility: ["AppClient"],
        async execute(context, input) {
            return await createDatabaseTable(context, input);
        },
    },
    updateDatabaseTableAccessPolicy: {
        visibility: ["AppClient"],
        async execute(context, input) {
            return await updateDatabaseTableAccessPolicy(context, input);
        },
    },
});
