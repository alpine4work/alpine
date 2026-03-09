import {createDatabase} from "~/server/databases/data/create_database.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/databases_rpc_definitions.js";

export default implementRpcs(definitions, {
    createDatabase: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, createdTime} = await createDatabase(context.actor.authorizeSession(), input);
            return {databaseId: id, createdTime};
        },
    },
});
