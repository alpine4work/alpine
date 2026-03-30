import {DatabaseModel} from "~/shared/databases/database_model.js";
import {DynamoGeneralRealtimeDatabaseEventSchema} from "~/shared/databases/database_realtime_protocol.js";
import {
    DynamoGeneralRealtimeEventStubSchema,
    createDynamoGeneralRealtimeBackfillResultSchema,
    createDynamoGeneralRealtimeEventSchema,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const createDatabase = defineRpc({
    name: "createDatabase",
    // Creates two databases if called twice.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        databaseId: Schema.id<DatabaseId>().optional(),
        name: Schema.string,
    },
    output: {
        databaseId: Schema.id<DatabaseId>(),
        createdTime: Schema.date,
    },
});

export const updateDatabaseName = defineRpc({
    name: "updateDatabaseName",
    isIdempotent: true,
    input: {
        databaseId: Schema.id<DatabaseId>(),
        name: Schema.string,
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(DatabaseModel.schema()),
        ),
    },
});

export const getDatabaseRealtimeEvent = defineRpc({
    name: "getDatabaseRealtimeEvent",
    isIdempotent: true,
    input: {
        databaseId: Schema.id<DatabaseId>(),
        eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
    },
    output: {
        eventTransaction: Schema.array(DynamoGeneralRealtimeDatabaseEventSchema),
    },
});

export const getDatabaseMetadata = defineRpc({
    name: "getDatabaseMetadata",
    isIdempotent: true,
    input: {
        databaseId: Schema.id<DatabaseId>(),
    },
    output: {
        databaseResult: createDynamoGeneralRealtimeQuerySchema(DatabaseModel.schema()),
    },
});

export const backfillDatabaseMetadata = defineRpc({
    name: "backfillDatabaseMetadata",
    isIdempotent: true,
    input: {
        databaseId: Schema.id<DatabaseId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        backfillDatabaseResult: createDynamoGeneralRealtimeBackfillResultSchema(
            DatabaseModel.schema(),
        ),
    },
});
