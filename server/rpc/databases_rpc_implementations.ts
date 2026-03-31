import {createDatabase} from "~/server/databases/data/create_database.js";
import {
    backfillDatabaseMetadata,
    getDatabaseMetadata,
} from "~/server/databases/data/get_database_metadata.js";
import {getDatabaseRealtimeEvent} from "~/server/databases/data/get_database_realtime_event.js";
import {updateDatabaseName} from "~/server/databases/data/update_database_name.js";
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
    updateDatabaseName: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateDatabaseName(
                context.actor.authorizeSession(),
                input.databaseId,
                input.name,
            );
            const eventTransaction = await getDynamoGeneralRealtimeEventTransaction(context);
            return {eventTransaction};
        },
    },
    getDatabaseRealtimeEvent: {
        visibility: ["DatabaseService"],
        execute: async (context, input) => {
            const eventTransaction = await getDatabaseRealtimeEvent(
                context.actor.authorizeSession(),
                input.databaseId,
                input.eventTransaction,
            );
            return {eventTransaction};
        },
    },
    getDatabaseMetadata: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const databaseResult = await getDatabaseMetadata(context, input.databaseId);
            return {databaseResult};
        },
    },
    backfillDatabaseMetadata: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const backfillDatabaseResult = await backfillDatabaseMetadata(context, {
                databaseId: input.databaseId,
                checkpoint: input.checkpoint,
            });
            return {backfillDatabaseResult};
        },
    },
});
