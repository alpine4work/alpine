import {
    createDatabaseTable,
    getDatabaseTableMetadataItem,
    getDatabaseTableMetadataRealtimeEvent,
    updateDatabaseTableAccessPolicy,
} from "~/server/databases/data/database_table_metadata.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpaceIdForDatabaseGroupId} from "~/server/spaces/get_database_group_id_for_space.js";
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
    getDatabaseTableMetadataItem: {
        visibility: ["AppClient"],
        async execute(context, input) {
            return {
                item: await getDatabaseTableMetadataItem(context.actor.authorizeSession(), input),
            };
        },
    },
    getDatabaseTableMetadataRealtimeEvent: {
        visibility: ["DatabaseGroupService"],
        async execute(context, input) {
            return {
                events: await getDatabaseTableMetadataRealtimeEvent(
                    context.actor.authorizeSession(),
                    input.databaseGroupId,
                    input.events,
                ),
            };
        },
    },
    authorizeDatabaseGroupAccess: {
        visibility: ["DatabaseGroupService"],
        async execute(context, input) {
            const spaceId = await getSpaceIdForDatabaseGroupId(context, input.databaseGroupId);
            await authorizeSpaceAccess(context, spaceId);
            return {};
        },
    },
});
